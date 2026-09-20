#include "config_loader.h"
#include "map/map_layout.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <json/json.h>
#include <set>
#include <sstream>
#include <stdexcept>
namespace snackshop {
namespace {
using JsonValue = Json::Value;
[[noreturn]] void fail(const std::string& at, const std::string& reason) {
    throw std::runtime_error(at + ": " + reason);
}
void object(const JsonValue& v, const std::string& at, std::initializer_list<const char*> keys) {
    if (!v.isObject()) {
        fail(at, "expected object");
    }
    for (const auto& key : v.getMemberNames()) {
        if (std::find(keys.begin(), keys.end(), key) == keys.end()) {
            fail(at + "." + key, "unknown field");
        }
    }
}
const JsonValue& array(const JsonValue& v, const std::string& at, int min = 1, int max = 128) {
    if (!v.isArray() || v.size() < static_cast<unsigned>(min) || v.size() > static_cast<unsigned>(max)) {
        fail(at, "array size out of range");
    }
    return v;
}
int integer(const JsonValue& v, const std::string& at, int min = 0, int max = 1000000) {
    if (!v.isInt() || v.asInt() < min || v.asInt() > max) {
        fail(at, "integer out of range");
    }
    return v.asInt();
}
double number(const JsonValue& v, const std::string& at, double min = 0, double max = 10000) {
    if (!v.isNumeric() || !std::isfinite(v.asDouble()) || v.asDouble() < min || v.asDouble() > max) {
        fail(at, "number out of range");
    }
    return v.asDouble();
}
int rewardWeight(const JsonValue& v, const std::string& at) {
    if (!v.isNumeric() || !std::isfinite(v.asDouble()) || v.asDouble() < 0 || v.asDouble() > 1000000000 ||
        std::floor(v.asDouble()) != v.asDouble()) {
        fail(at, "权重须为 0～1000000000 的整数");
    }
    return static_cast<int>(v.asDouble());
}
// Compatibility for existing drafts/releases. New edits use integer weights.
std::vector<int> legacyProbabilities(const std::vector<double>& weights) {
    double total = 0;
    for (const auto weight : weights) {
        total += weight;
    }
    std::vector<int> result(weights.size());
    int remaining = 10000;
    std::vector<double> fractions(weights.size());
    for (std::size_t i = 0; i < weights.size(); ++i) {
        const double exact = weights[i] / total * 10000;
        result[i] = static_cast<int>(std::floor(exact));
        fractions[i] = exact - result[i];
        remaining -= result[i];
    }
    while (remaining-- > 0) {
        const auto best = std::max_element(fractions.begin(), fractions.end());
        ++result[static_cast<std::size_t>(best - fractions.begin())];
        *best = -1;
    }
    return result;
}
std::string string(const JsonValue& v, const std::string& at, bool empty = false, std::size_t maxLength = 128) {
    if (!v.isString() || (!empty && v.asString().empty()) || v.asString().size() > maxLength) {
        fail(at, "invalid string");
    }
    return v.asString();
}
std::string id(const JsonValue& v, const std::string& at) {
    auto result = string(v, at);
    if (result.size() > 48 || !std::all_of(result.begin(), result.end(), [](unsigned char c) {
            return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
        })) {
        fail(at, "ID must use lowercase ASCII letters, digits, '_' or '-'");
    }
    return result;
}
bool boolean(const JsonValue& v, const std::string& at) {
    if (!v.isBool()) {
        fail(at, "expected boolean");
    }
    return v.asBool();
}
bool hasCurrency(const GameConfig& cfg, const std::string& name) {
    return std::any_of(cfg.currencies.begin(), cfg.currencies.end(), [&](const auto& c) { return c.id == name; });
}
Cost cost(const JsonValue& v, const GameConfig& cfg, const std::string& at) {
    Cost result;
    std::set<std::string> seen;
    for (const auto& row : array(v, at, 0, 16)) {
        object(row, at, {"currency", "amount"});
        const auto currency = id(row["currency"], at + ".currency");
        if (!hasCurrency(cfg, currency) || !seen.insert(currency).second) {
            fail(at, "unknown or duplicate currency");
        }
        result.push_back({currency, integer(row["amount"], at + ".amount", 1, cfg.currency(currency).limit)});
    }
    return result;
}
Requirements requirements(const JsonValue& v, const GameConfig& cfg, const std::string& at, int nestCount) {
    Requirements result;
    std::set<std::string> seen;
    for (const auto& row : array(v, at, 0, 2)) {
        object(row, at, {"type", "id", "level"});
        const auto type = string(row["type"], at + ".type");
        if (!seen.insert(type).second) {
            fail(at, "duplicate condition");
        }
        if (type == "door_stage") {
            if (row.isMember("level")) {
                fail(at, "door condition uses an ID");
            }
            const auto key = id(row["id"], at + ".id");
            const auto found =
                std::find_if(cfg.doors.begin(), cfg.doors.end(), [&](const auto& d) { return d.id == key; });
            if (found == cfg.doors.end()) {
                fail(at, "unknown door ID " + key);
            }
            result.doorStage = found->stage;
        } else if (type == "nest_level") {
            if (row.isMember("id")) {
                fail(at, "nest condition uses a level");
            }
            result.nestLevel = integer(row["level"], at + ".level", 1, nestCount);
        } else {
            fail(at, "unknown condition type " + type);
        }
    }
    return result;
}
LevelConfig level(const JsonValue& row, const GameConfig& cfg, const std::string& at, int ordinal, int count,
                  int nestCount, bool isNest = false) {
    if (isNest) {
        object(row, at, {"level", "next_level", "cost", "conditions", "amount", "interval_ms", "range", "currency"});
    } else {
        object(row, at,
               {"level", "next_level", "cost", "conditions", "amount", "interval_ms", "range", "name", "appearance"});
    }
    LevelConfig result;
    result.level = integer(row["level"], at + ".level", ordinal, ordinal);
    result.nextLevel = integer(row["next_level"], at + ".next_level", 0, count);
    if (result.nextLevel != (ordinal < count ? ordinal + 1 : 0)) {
        fail(at, "invalid next level");
    }
    result.cost = cost(row["cost"], cfg, at + ".cost");
    result.requirements = requirements(row["conditions"], cfg, at + ".conditions", nestCount);
    result.amount = integer(row["amount"], at + ".amount");
    result.intervalMs = integer(row["interval_ms"], at + ".interval_ms", 50, 3600000);
    result.range = number(row["range"], at + ".range");
    return result;
}
void checkReachable(const GameConfig& cfg) {
    int door = 1, nest = 1;
    auto meets = [&](const Requirements& r) { return r.doorStage <= door && r.nestLevel <= nest; };
    bool changed;
    do {
        changed = false;
        if (door < static_cast<int>(cfg.doors.size()) && meets(cfg.door(door + 1).requirements)) {
            ++door;
            changed = true;
        }
        if (nest < static_cast<int>(cfg.nests.size()) && meets(cfg.nest(nest + 1).requirements)) {
            ++nest;
            changed = true;
        }
    } while (changed);
    if (door != static_cast<int>(cfg.doors.size()) || nest != static_cast<int>(cfg.nests.size())) {
        fail("conditions", "door/nest upgrade chain is unreachable or cyclic");
    }
}
} // namespace
std::shared_ptr<const GameConfig> ConfigLoader::parse(const std::string& text) {
    if (text.size() > 1024 * 1024) {
        fail("config", "bundle exceeds 1 MiB");
    }
    Json::CharReaderBuilder reader;
    reader["collectComments"] = false;
    reader["allowComments"] = false;
    reader["rejectDupKeys"] = true;
    reader["failIfExtra"] = true;
    reader["stackLimit"] = 64;
    JsonValue root;
    std::string errors;
    const auto parser = std::unique_ptr<Json::CharReader>(reader.newCharReader());
    if (!parser->parse(text.data(), text.data() + text.size(), &root, &errors)) {
        fail("JSON", errors);
    }
    object(root, "config",
           {"schema_version", "version", "currencies", "match", "doors", "nests", "items", "initial_items",
            "pickup_item", "repair", "manager", "cat_ai", "manager_ai", "map_generation", "characters",
            "random_items"});
    integer(root["schema_version"], "schema_version", 1, 1);
    auto cfg = std::make_shared<GameConfig>();
    // Content identity distinguishes edits even when the author forgets to bump the display version.
    std::uint64_t hash = 14695981039346656037ULL;
    for (unsigned char c : text) {
        hash = (hash ^ c) * 1099511628211ULL;
    }
    std::ostringstream revision;
    revision << string(root["version"], "version") << '-' << std::hex << std::setw(16) << std::setfill('0') << hash;
    cfg->version = revision.str();
    std::set<std::string> ids;
    for (const auto& row : array(root["characters"], "characters", 1, 32)) {
        object(row, "characters", {"id", "skins"});
        CharacterConfig character;
        character.id = id(row["id"], "characters.id");
        if (!ids.insert(character.id).second) {
            fail("characters", "duplicate character ID");
        }
        std::set<std::string> skins;
        for (const auto& value : array(row["skins"], "characters.skins", 1, 32)) {
            auto skin = id(value, "characters.skin");
            if (!skins.insert(skin).second) {
                fail("characters", "duplicate skin ID");
            }
            character.skins.push_back(std::move(skin));
        }
        cfg->characters.push_back(std::move(character));
    }
    ids.clear();
    for (const auto& row : array(root["currencies"], "currencies", 1, 16)) {
        object(row, "currencies", {"id", "name", "symbol", "initial", "limit"});
        CurrencyConfig c;
        c.id = id(row["id"], "currencies.id");
        if (!ids.insert(c.id).second) {
            fail("currencies", "duplicate ID " + c.id);
        }
        c.name = string(row["name"], c.id + ".name");
        c.symbol = string(row["symbol"], c.id + ".symbol");
        c.limit = integer(row["limit"], c.id + ".limit", 1);
        c.initial = integer(row["initial"], c.id + ".initial", 0, c.limit);
        cfg->currencies.push_back(c);
    }
    if (!hasCurrency(*cfg, "cans")) {
        fail("currencies", "missing primary currency cans");
    }
    const auto& map = root["map_generation"];
    object(map, "map_generation", {"profiles"});
    ids.clear();
    int mapWeight = 0;
    for (const auto& row : array(map["profiles"], "map_generation.profiles", 1, 32)) {
        const auto at = "map_generation." + id(row["id"], "map_generation.id");
        object(row, at,
               {"id", "name", "theme", "weight", "width", "height", "min_rooms", "max_rooms", "min_room_width",
                "max_room_width", "min_room_height", "max_room_height", "min_room_area", "max_room_area",
                "corridor_width", "bands", "layout_complexity"});
        MapProfileConfig layout;
        layout.id = id(row["id"], at + ".id");
        if (!ids.insert(layout.id).second) {
            fail(at, "duplicate map ID");
        }
        layout.name = string(row["name"], at + ".name");
        layout.theme = id(row["theme"], at + ".theme");
        layout.weight = integer(row["weight"], at + ".weight", 0, 1000);
        mapWeight += layout.weight;
        layout.width = integer(row["width"], at + ".width", 24, 96);
        layout.height = integer(row["height"], at + ".height", 24, 96);
        layout.minRooms = integer(row["min_rooms"], at + ".min_rooms", Seats, MaxRooms);
        layout.maxRooms = integer(row["max_rooms"], at + ".max_rooms", layout.minRooms, MaxRooms);
        layout.minRoomWidth = integer(row["min_room_width"], at + ".min_room_width", 7, 24);
        layout.maxRoomWidth = integer(row["max_room_width"], at + ".max_room_width", layout.minRoomWidth, 24);
        layout.minRoomHeight = integer(row["min_room_height"], at + ".min_room_height", 7, 24);
        layout.maxRoomHeight = integer(row["max_room_height"], at + ".max_room_height", layout.minRoomHeight, 24);
        layout.minRoomArea = integer(row["min_room_area"], at + ".min_room_area", 12, 484);
        layout.maxRoomArea = integer(row["max_room_area"], at + ".max_room_area", layout.minRoomArea, 484);
        layout.corridorWidth = integer(row["corridor_width"], at + ".corridor_width", 2, 8);
        layout.bands = integer(row["bands"], at + ".bands", 2, 4);
        layout.complexity = integer(row["layout_complexity"], at + ".layout_complexity", 0, 3);
        const int columns = (layout.maxRooms + layout.bands - 1) / layout.bands;
        const int plotWidth = (layout.width - 2 - (columns + 1) * layout.corridorWidth) / columns;
        const int plotHeight = (layout.height - 2 - (layout.bands + 1) * layout.corridorWidth) / layout.bands;
        if (roomFootprints(layout, plotWidth, plotHeight).empty()) {
            fail(at, "map size, room bounds/area and corridors cannot fit the maximum room count");
        }
        cfg->mapGeneration.profiles.push_back(std::move(layout));
    }
    if (mapWeight == 0) {
        fail("map_generation", "at least one map must have a positive weight");
    }
    const auto& match = root["match"];
    object(match, "match", {"preparation_ms", "duration_ms", "reconnect_grace_ms", "cat_speed"});
    cfg->balance.preparation = integer(match["preparation_ms"], "match.preparation_ms", 0, 3600000) / 1000.0;
    cfg->balance.duration = integer(match["duration_ms"], "match.duration_ms", 1000, 3600000) / 1000.0;
    cfg->balance.reconnectGrace = integer(match["reconnect_grace_ms"], "match.reconnect_grace_ms", 0, 60000) / 1000.0;
    cfg->catSpeed = number(match["cat_speed"], "match.cat_speed", 1, 1000);
    const auto& doors = array(root["doors"], "doors", 1, 64);
    const auto& nests = array(root["nests"], "nests", 1, 64);
    ids.clear();
    for (const auto& row : doors) {
        object(row, "doors",
               {"id", "stage", "name", "display_level", "appearance", "health", "cost", "next_stage", "conditions"});
        DoorConfig d;
        d.id = id(row["id"], "doors.id");
        if (!ids.insert(d.id).second) {
            fail("doors", "duplicate ID " + d.id);
        }
        const int ordinal = static_cast<int>(cfg->doors.size()) + 1;
        d.stage = integer(row["stage"], d.id + ".stage", ordinal, ordinal);
        d.name = string(row["name"], d.id + ".name");
        d.displayLevel = integer(row["display_level"], d.id + ".display_level", 1, 100);
        d.appearance = string(row["appearance"], d.id + ".appearance");
        if (d.appearance != "wood" && d.appearance != "iron" && d.appearance != "steel") {
            fail(d.id, "unknown door appearance");
        }
        d.health = integer(row["health"], d.id + ".health", 1);
        if (!cfg->doors.empty() && d.health < cfg->doors.back().health) {
            fail(d.id, "door health must not decrease");
        }
        d.cost = cost(row["cost"], *cfg, d.id + ".cost");
        if ((ordinal == 1) != d.cost.empty()) {
            fail(d.id, "only the initial door has no price");
        }
        d.nextStage = integer(row["next_stage"], d.id + ".next_stage", 0, static_cast<int>(doors.size()));
        if (d.nextStage != (ordinal < static_cast<int>(doors.size()) ? ordinal + 1 : 0)) {
            fail(d.id, "invalid next stage");
        }
        cfg->doors.push_back(d);
    }
    for (unsigned i = 0; i < doors.size(); ++i) {
        cfg->doors[i].requirements =
            requirements(doors[i]["conditions"], *cfg, cfg->doors[i].id + ".conditions", nests.size());
    }
    for (const auto& row : nests) {
        NestConfig n;
        const int ordinal = static_cast<int>(cfg->nests.size()) + 1;
        static_cast<LevelConfig&>(n) =
            level(row, *cfg, "nests[" + std::to_string(ordinal) + "]", ordinal, nests.size(), nests.size(), true);
        n.currency = id(row["currency"], "nests.currency");
        if (!hasCurrency(*cfg, n.currency) || n.amount <= 0 || n.range != 0) {
            fail("nests", "invalid income fields");
        }
        if ((ordinal == 1) != n.cost.empty()) {
            fail("nests", "only initial nest has no price");
        }
        cfg->nests.push_back(n);
    }
    if (cfg->doors[0].requirements.doorStage || cfg->doors[0].requirements.nestLevel ||
        cfg->nests[0].requirements.doorStage || cfg->nests[0].requirements.nestLevel) {
        fail("conditions", "initial door and nest cannot have prerequisites");
    }
    checkReachable(*cfg);
    const std::map<std::string, ItemBehavior> behaviors{{"obstacle", ItemBehavior::Obstacle},
                                                        {"pickup", ItemBehavior::Pickup},
                                                        {"currency_producer", ItemBehavior::CurrencyProducer},
                                                        {"single_attack", ItemBehavior::SingleAttack},
                                                        {"door_repair", ItemBehavior::DoorRepair},
                                                        {"door_attack_delay", ItemBehavior::DoorAttackDelay},
                                                        {"random_item", ItemBehavior::RandomItem}};
    for (const auto& row : array(root["items"], "items")) {
        object(row, "items",
               {"id", "name", "description", "category", "behavior", "appearance", "currency", "buildable", "unique",
                "levels"});
        ItemConfig item;
        item.id = id(row["id"], "items.id");
        item.name = string(row["name"], item.id + ".name");
        item.description = string(row["description"], item.id + ".description", false, 512);
        item.category = string(row["category"], item.id + ".category");
        const auto behavior = string(row["behavior"], item.id + ".behavior");
        if (!behaviors.contains(behavior)) {
            fail(item.id, "unregistered behavior " + behavior);
        }
        item.behavior = behaviors.at(behavior);
        const std::string expected = item.behavior == ItemBehavior::CurrencyProducer ? "currency"
                                     : item.behavior == ItemBehavior::SingleAttack   ? "attack"
                                                                                     : "utility";
        if (item.category != expected) {
            fail(item.id, "category disagrees with behavior");
        }
        item.appearance = string(row["appearance"], item.id + ".appearance");
        const std::set<std::string> appearances{"shelf",           "crate",          "launcher",    "pantry",
                                                "repair",          "fish_rack",      "mini_fridge", "launcher_dual",
                                                "launcher_cannon", "magic_trash_bin"};
        if (!appearances.contains(item.appearance)) {
            fail(item.id, "unknown appearance");
        }
        item.currency = string(row["currency"], item.id + ".currency", true);
        const bool produces = item.behavior == ItemBehavior::CurrencyProducer || item.behavior == ItemBehavior::Pickup;
        if ((produces && !hasCurrency(*cfg, item.currency)) || (!produces && !item.currency.empty())) {
            fail(item.id, "invalid currency for behavior");
        }
        item.buildable = boolean(row["buildable"], item.id + ".buildable");
        item.unique = row.isMember("unique") && boolean(row["unique"], item.id + ".unique");
        if (item.unique && !item.buildable) {
            fail(item.id, "only buildable items can be unique");
        }
        const bool terrain = item.behavior == ItemBehavior::Obstacle || item.behavior == ItemBehavior::Pickup;
        if (terrain && item.buildable) {
            fail(item.id, "terrain item cannot be purchased");
        }
        const bool randomItem = item.behavior == ItemBehavior::RandomItem;
        if (randomItem && (!item.buildable || item.unique)) {
            fail(item.id, "random items must be purchasable consumables without a unique flag");
        }
        const auto& levels = array(row["levels"], item.id + ".levels", randomItem ? 0 : 1,
                                   randomItem ? 0
                                   : terrain  ? 1
                                              : 64);
        for (const auto& data : levels) {
            const int ordinal = static_cast<int>(item.levels.size()) + 1;
            const auto at = item.id + ".levels[" + std::to_string(ordinal) + "]";
            ItemLevelConfig l;
            static_cast<LevelConfig&>(l) = level(data, *cfg, at, ordinal, levels.size(), nests.size());
            l.name = data.isMember("name") ? string(data["name"], at + ".name") : item.name;
            l.appearance =
                data.isMember("appearance") ? string(data["appearance"], at + ".appearance") : item.appearance;
            if (!appearances.contains(l.appearance)) {
                fail(at, "unknown level appearance");
            }
            if (item.buildable && l.cost.empty()) {
                fail(item.id, "purchasable levels require a price");
            }
            if (item.behavior == ItemBehavior::Obstacle ? l.amount != 0 : l.amount <= 0) {
                fail(item.id, "invalid effect amount");
            }
            if (item.behavior == ItemBehavior::SingleAttack ? l.range <= 0 : l.range != 0) {
                fail(item.id, "invalid effect range");
            }
            // Delay amount is milliseconds; a pulse must be shorter than its interval.
            if (item.behavior == ItemBehavior::DoorAttackDelay && l.amount >= l.intervalMs) {
                fail(item.id, "door attack delay must be shorter than its trigger interval");
            }
            item.levels.push_back(l);
        }
        if (!cfg->items.emplace(item.id, item).second) {
            fail("items", "duplicate ID " + item.id);
        }
    }
    for (const auto& row : array(root["random_items"], "random_items", 0, 128)) {
        object(row, "random_items", {"item", "purchase_costs", "level_weight_decay", "reveal_duration_ms", "rewards"});
        const auto key = id(row["item"], "random_items.item");
        if (!cfg->items.contains(key) || cfg->item(key).behavior != ItemBehavior::RandomItem) {
            fail(key, "random item rule must reference a random_item consumable");
        }
        RandomItemConfig rules;
        if (row.isMember("rewards")) {
            if (row.isMember("level_weight_decay")) {
                fail(key, "配置奖池后请移除旧的 level_weight_decay 字段");
            }
            std::set<std::string> seenItems;
            std::int64_t total = 0;
            for (const auto& entry : array(row["rewards"], key + ".rewards", 1, 128)) {
                const auto at = key + ".rewards[" + std::to_string(rules.rewards.size()) + "]";
                object(entry, at, {"item", "weight", "min_level", "max_level", "level_weights"});
                RandomItemReward reward;
                reward.item = id(entry["item"], at + ".item");
                const auto found = cfg->items.find(reward.item);
                if (found == cfg->items.end() || !found->second.buildable ||
                    found->second.behavior == ItemBehavior::RandomItem || found->second.levels.empty()) {
                    fail(at, "奖池道具不存在或不可抽取：" + reward.item);
                }
                if (!seenItems.insert(reward.item).second) {
                    fail(at, "奖池中有重复道具：" + reward.item);
                }
                reward.weight = rewardWeight(entry["weight"], at + ".weight");
                total += reward.weight;
                const auto count = static_cast<int>(found->second.levels.size());
                const int min = integer(entry["min_level"], at + ".min_level", 1, count);
                const int max = integer(entry["max_level"], at + ".max_level", min, count);
                std::set<int> seenLevels;
                std::int64_t levelTotal = 0;
                for (const auto& value :
                     array(entry["level_weights"], at + ".level_weights", max - min + 1, max - min + 1)) {
                    object(value, at + ".level_weights", {"level", "weight"});
                    const int level = integer(value["level"], at + ".level", min, max);
                    if (!seenLevels.insert(level).second) {
                        fail(at, "等级权重中有重复等级");
                    }
                    const int weight = rewardWeight(value["weight"], at + ".level[" + std::to_string(level) + "]");
                    levelTotal += weight;
                    reward.levels.push_back({level, weight});
                }
                if (levelTotal == 0) {
                    fail(at, "至少一个等级的权重须大于 0");
                }
                rules.rewards.push_back(std::move(reward));
            }
            if (total == 0) {
                fail(key, "奖池中至少一个道具的权重须大于 0");
            }
        } else {
            const double decay = number(row["level_weight_decay"], key + ".level_weight_decay", 0.01, 0.99);
            for (const auto& [id, item] : cfg->items) {
                if (!item.buildable || item.behavior == ItemBehavior::RandomItem || item.levels.empty()) {
                    continue;
                }
                RandomItemReward reward;
                reward.item = id;
                std::vector<double> weights;
                double weight = 1;
                for (std::size_t i = 0; i < item.levels.size(); ++i) {
                    weights.push_back(weight);
                    weight *= decay;
                }
                const auto chances = legacyProbabilities(weights);
                for (std::size_t i = 0; i < item.levels.size(); ++i) {
                    reward.levels.push_back({item.levels[i].level, chances[i]});
                }
                rules.rewards.push_back(std::move(reward));
            }
            if (rules.rewards.empty()) {
                fail(key, "奖池没有可抽取的道具");
            }
            for (auto& reward : rules.rewards) {
                reward.weight = 1;
            }
        }
        rules.revealDuration = integer(row["reveal_duration_ms"], key + ".reveal_duration_ms", 200, 10000) / 1000.0;
        for (const auto& entry : array(row["purchase_costs"], key + ".purchase_costs", 1, 32)) {
            auto price = cost(entry, *cfg, key + ".purchase_costs");
            if (price.empty()) {
                fail(key, "each purchase must have a price");
            }
            if (!rules.purchaseCosts.empty()) {
                bool increased = false;
                for (const auto& currency : cfg->currencies) {
                    auto amount = [&](const Cost& costs) {
                        const auto found = std::find_if(costs.begin(), costs.end(),
                                                        [&](const auto& c) { return c.currency == currency.id; });
                        return found == costs.end() ? 0 : found->amount;
                    };
                    if (amount(price) < amount(rules.purchaseCosts.back())) {
                        fail(key, "purchase prices must not decrease");
                    }
                    increased = increased || amount(price) > amount(rules.purchaseCosts.back());
                }
                if (!increased) {
                    fail(key, "each purchase must cost more than the previous one");
                }
            }
            rules.purchaseCosts.push_back(std::move(price));
        }
        if (!cfg->randomItems.emplace(key, std::move(rules)).second) {
            fail(key, "duplicate random item rule");
        }
    }
    for (const auto& [key, item] : cfg->items) {
        if (item.behavior == ItemBehavior::RandomItem && !cfg->randomItems.contains(key)) {
            fail(key, "missing random item rule");
        }
    }
    if (!cfg->randomItems.empty() && std::none_of(cfg->items.begin(), cfg->items.end(), [](const auto& entry) {
            return entry.second.buildable && entry.second.behavior != ItemBehavior::RandomItem;
        })) {
        fail("random_items", "no installable reward items");
    }
    for (const auto& row : array(root["initial_items"], "initial_items", 1, 128)) {
        const auto key = id(row, "initial_items");
        if (!cfg->items.contains(key) || !cfg->item(key).buildable ||
            cfg->item(key).behavior == ItemBehavior::RandomItem ||
            std::find(cfg->initialItems.begin(), cfg->initialItems.end(), key) != cfg->initialItems.end()) {
            fail("initial_items", "unknown, unbuildable or duplicate item");
        }
        cfg->initialItems.push_back(key);
    }
    cfg->pickupItem = id(root["pickup_item"], "pickup_item");
    if (!cfg->items.contains(cfg->pickupItem) || cfg->item(cfg->pickupItem).behavior != ItemBehavior::Pickup) {
        fail("pickup_item", "must reference a pickup behavior");
    }
    const auto& repair = root["repair"];
    object(repair, "repair", {"cost", "amount", "cooldown_ms"});
    cfg->repair.cost = cost(repair["cost"], *cfg, "repair.cost");
    if (cfg->repair.cost.empty()) {
        fail("repair.cost", "repair requires a price");
    }
    cfg->repair.amount = integer(repair["amount"], "repair.amount", 1);
    cfg->repair.cooldown = integer(repair["cooldown_ms"], "repair.cooldown_ms", 50, 3600000) / 1000.0;
    const auto& manager = root["manager"];
    object(manager, "manager",
           {"time_rage", "door_rage", "damage_rage_multiplier", "level_up_heal_percent", "attack_interval_ms",
            "capture_range", "rest_duration_ms", "recovery_duration_ms", "retreat_reward", "levels"});
    auto& m = cfg->enemy;
    m.timeRage = integer(manager["time_rage"], "manager.time_rage", 0, 1000);
    m.doorRage = integer(manager["door_rage"], "manager.door_rage", 0, 10000);
    m.damageRageMultiplier = number(manager["damage_rage_multiplier"], "manager.damage_rage_multiplier", 0, 10000);
    m.levelUpHealRatio = number(manager["level_up_heal_percent"], "manager.level_up_heal_percent", 0, 100) / 100.0;
    m.attackInterval = integer(manager["attack_interval_ms"], "manager.attack_interval_ms", 50, 60000) / 1000.0;
    m.captureRange = number(manager["capture_range"], "manager.capture_range", 1, TileSize);
    m.restDuration = integer(manager["rest_duration_ms"], "manager.rest_duration_ms", 50, 3600000) / 1000.0;
    m.recoveryDuration = integer(manager["recovery_duration_ms"], "manager.recovery_duration_ms", 50, 3600000) / 1000.0;
    m.retreatReward = cost(manager["retreat_reward"], *cfg, "manager.retreat_reward");
    const auto& enemyLevels = array(manager["levels"], "manager.levels", 1, 100);
    for (const auto& row : enemyLevels) {
        object(row, "manager.levels",
               {"level", "max_hp", "door_damage", "speed", "next_rage", "level_up_announcement"});
        const int ordinal = static_cast<int>(m.levels.size()) + 1;
        integer(row["level"], "manager.level", ordinal, ordinal);
        EnemyLevelStats l;
        l.levelUpAnnouncement = string(row["level_up_announcement"], "manager.level_up_announcement", ordinal == 1);
        l.maxHp = integer(row["max_hp"], "manager.max_hp", 1);
        l.doorDamage = integer(row["door_damage"], "manager.door_damage", 1);
        l.speed = number(row["speed"], "manager.speed", 1, 1000);
        l.nextRage =
            integer(row["next_rage"], "manager.next_rage", ordinal < static_cast<int>(enemyLevels.size()) ? 1 : 0);
        if (ordinal == static_cast<int>(enemyLevels.size()) && l.nextRage != 0) {
            fail("manager", "max level must have zero next rage");
        }
        m.levels.push_back(l);
    }
    const auto& ai = root["cat_ai"];
    object(ai, "cat_ai",
           {"decision_interval_ms", "decision_jitter_ms", "danger_interval_ms", "start_delay_ms", "seat_delay_ms",
            "move_timeout_ms", "escape_repath_ms", "repair_threshold_percent", "danger_radius", "escape_candidates",
            "build_attempts", "profiles"});
    auto& a = cfg->catAi;
    a.decisionInterval = integer(ai["decision_interval_ms"], "cat_ai.decision_interval_ms", 50, 10000) / 1000.0;
    a.decisionJitter = integer(ai["decision_jitter_ms"], "cat_ai.decision_jitter_ms", 0, 10000) / 1000.0;
    a.dangerInterval = integer(ai["danger_interval_ms"], "cat_ai.danger_interval_ms", 50, 1000) / 1000.0;
    a.startDelay = integer(ai["start_delay_ms"], "cat_ai.start_delay_ms", 0, 10000) / 1000.0;
    a.seatDelay = integer(ai["seat_delay_ms"], "cat_ai.seat_delay_ms", 0, 2000) / 1000.0;
    a.moveTimeout = integer(ai["move_timeout_ms"], "cat_ai.move_timeout_ms", 1000, 60000) / 1000.0;
    a.escapeRepath = integer(ai["escape_repath_ms"], "cat_ai.escape_repath_ms", 50, 5000) / 1000.0;
    a.repairThreshold = integer(ai["repair_threshold_percent"], "cat_ai.repair_threshold_percent", 1, 99) / 100.0;
    a.dangerRadius = number(ai["danger_radius"], "cat_ai.danger_radius", TileSize, 1024);
    a.escapeCandidates = integer(ai["escape_candidates"], "cat_ai.escape_candidates", 1, 16);
    a.buildAttempts = integer(ai["build_attempts"], "cat_ai.build_attempts", 1, 16);
    if (a.dangerInterval > a.decisionInterval || a.escapeRepath < a.dangerInterval) {
        fail("cat_ai", "invalid decision/repath interval ordering");
    }
    ids.clear();
    for (const auto& row : array(ai["profiles"], "cat_ai.profiles", 1, 8)) {
        object(row, "cat_ai.profile", {"id", "preference", "reserve", "attack_count", "repair_count", "producers"});
        AiProfile profile;
        profile.id = id(row["id"], "cat_ai.profile.id");
        if (!ids.insert(profile.id).second) {
            fail("cat_ai.profiles", "duplicate profile ID");
        }
        const auto preference = string(row["preference"], "cat_ai.profile.preference");
        if (preference == "economy") {
            profile.preference = AiPreference::Economy;
        } else if (preference == "defense") {
            profile.preference = AiPreference::Defense;
        } else if (preference == "attack") {
            profile.preference = AiPreference::Attack;
        } else {
            fail("cat_ai.profile.preference", "unknown preference");
        }
        profile.reserve = cost(row["reserve"], *cfg, "cat_ai.profile.reserve");
        profile.attackCount = integer(row["attack_count"], "cat_ai.profile.attack_count", 0, 12);
        profile.repairCount = integer(row["repair_count"], "cat_ai.profile.repair_count", 0, 4);
        std::set<std::string> outputs;
        for (const auto& target : array(row["producers"], "cat_ai.profile.producers", 0, 16)) {
            object(target, "cat_ai.producer", {"currency", "count"});
            AiProductionTarget t;
            t.currency = id(target["currency"], "cat_ai.producer.currency");
            t.count = integer(target["count"], "cat_ai.producer.count", 0, 4);
            if (!hasCurrency(*cfg, t.currency) || !outputs.insert(t.currency).second) {
                fail("cat_ai.producer", "unknown or duplicate currency");
            }
            if (t.count > 0 && std::none_of(cfg->items.begin(), cfg->items.end(), [&](const auto& pair) {
                    const auto& item = pair.second;
                    return item.buildable && item.behavior == ItemBehavior::CurrencyProducer &&
                           item.currency == t.currency;
                })) {
                fail("cat_ai.producer", "no buildable producer for currency");
            }
            profile.producers.push_back(t);
        }
        a.profiles.push_back(std::move(profile));
    }
    const auto& strategy = root["manager_ai"];
    object(strategy, "manager_ai",
           {"target_interval_ms", "minimum_target_hold_ms", "target_switch_margin", "attack_prop_weight",
            "door_health_weight", "distance_weight", "random_weight", "retreat_health_percent", "resume_health_percent",
            "out_of_combat_delay_ms", "out_of_combat_heal_percent_per_second", "retreat_speed_multiplier",
            "repath_interval_ms"});
    auto& strategyOut = cfg->managerAi;
    strategyOut.targetInterval =
        integer(strategy["target_interval_ms"], "manager_ai.target_interval_ms", 100, 30000) / 1000.0;
    strategyOut.targetHold =
        integer(strategy["minimum_target_hold_ms"], "manager_ai.minimum_target_hold_ms", 0, 60000) / 1000.0;
    strategyOut.switchMargin = number(strategy["target_switch_margin"], "manager_ai.target_switch_margin", 0, 10000);
    strategyOut.attackWeight = number(strategy["attack_prop_weight"], "manager_ai.attack_prop_weight");
    strategyOut.doorHealthWeight = number(strategy["door_health_weight"], "manager_ai.door_health_weight");
    strategyOut.distanceWeight = number(strategy["distance_weight"], "manager_ai.distance_weight");
    strategyOut.randomWeight = number(strategy["random_weight"], "manager_ai.random_weight");
    strategyOut.retreatHealth =
        integer(strategy["retreat_health_percent"], "manager_ai.retreat_health_percent", 0, 95) / 100.0;
    strategyOut.resumeHealth =
        integer(strategy["resume_health_percent"], "manager_ai.resume_health_percent", 1, 100) / 100.0;
    if (strategyOut.resumeHealth <= strategyOut.retreatHealth) {
        fail("manager_ai", "resume health must exceed retreat health");
    }
    strategyOut.outOfCombatDelay =
        integer(strategy["out_of_combat_delay_ms"], "manager_ai.out_of_combat_delay_ms", 0, 600000) / 1000.0;
    strategyOut.outOfCombatHealing = number(strategy["out_of_combat_heal_percent_per_second"],
                                            "manager_ai.out_of_combat_heal_percent_per_second", 0, 100) /
                                     100.0;
    strategyOut.retreatSpeed =
        number(strategy["retreat_speed_multiplier"], "manager_ai.retreat_speed_multiplier", 1, 3);
    strategyOut.repathInterval =
        integer(strategy["repath_interval_ms"], "manager_ai.repath_interval_ms", 50, 5000) / 1000.0;
    return cfg;
}

std::shared_ptr<const GameConfig> ConfigLoader::load(const std::filesystem::path& base) {
    const auto directory = std::filesystem::canonical(base);
    const auto publishing = directory / ".publishing.json";
    if (std::filesystem::exists(publishing)) {
        fail(directory.string(), "configuration publication is incomplete; retry after admin recovery");
    }
    auto read = [](const std::filesystem::path& path) {
        std::ifstream file(path, std::ios::binary | std::ios::ate);
        if (!file) {
            fail(path.string(), "cannot open table");
        }
        const auto length = file.tellg();
        if (length < 0 || length > 1024 * 1024) {
            fail(path.string(), "invalid table size");
        }
        file.seekg(0);
        std::string text(static_cast<std::size_t>(length), '\0');
        if (!file.read(text.data(), length)) {
            fail(path.string(), "cannot read complete table");
        }
        return text;
    };
    const std::array<const char*, 14> names{"manifest",   "currencies",     "match",      "doors",       "nests",
                                            "items",      "manager",        "repair",     "map_items",   "cat_ai",
                                            "manager_ai", "map_generation", "characters", "random_items"};
    std::map<std::string, std::string> sources;
    std::map<std::string, JsonValue> tables;
    std::size_t bytes = 0;
    for (const auto* name : names) {
        const auto path = directory / (std::string(name) + ".json");
        auto text = read(path);
        bytes += text.size();
        if (bytes > 1024 * 1024) {
            fail(directory.string(), "tables exceed 1 MiB");
        }
        Json::CharReaderBuilder reader;
        reader["collectComments"] = false;
        reader["allowComments"] = false;
        reader["rejectDupKeys"] = true;
        reader["failIfExtra"] = true;
        reader["stackLimit"] = 64;
        std::string error;
        const auto parser = std::unique_ptr<Json::CharReader>(reader.newCharReader());
        if (!parser->parse(text.data(), text.data() + text.size(), &tables[name], &error)) {
            fail(path.string(), error);
        }
        sources.emplace(name, std::move(text));
    }
    // Reject a bundle being written during loading. Publish only after all tables and cross references validate.
    for (const auto& [name, text] : sources) {
        if (read(directory / (name + ".json")) != text) {
            fail(name, "table changed during loading; retry after saving");
        }
    }
    // The publisher writes manifest last. Check it again after the second table pass,
    // so a whole publication between our marker checks cannot produce a mixed bundle.
    if (std::filesystem::exists(publishing) || read(directory / "manifest.json") != sources.at("manifest")) {
        fail(directory.string(), "configuration changed during loading; retry");
    }
    auto result = tables.at("manifest");
    object(result, "manifest.json", {"schema_version", "version"});
    for (const auto* name : {"currencies", "match", "doors", "nests", "items", "manager", "repair", "cat_ai",
                             "manager_ai", "map_generation", "characters", "random_items"}) {
        result[name] = tables.at(name);
    }
    const auto& map = tables.at("map_items");
    object(map, "map_items.json", {"initial_items", "pickup_item"});
    result["initial_items"] = map["initial_items"];
    result["pickup_item"] = map["pickup_item"];
    return parse(Json::writeString(Json::StreamWriterBuilder{}, result));
}
ConfigStore::ConfigStore(std::filesystem::path path) : m_path(std::move(path)), m_current(ConfigLoader::load(m_path)) {
}
std::shared_ptr<const GameConfig> ConfigStore::current() const {
    std::lock_guard lock(m_mutex);
    return m_current;
}
bool ConfigStore::reload(std::string& error) {
    std::lock_guard lock(m_mutex);
    try {
        auto candidate = ConfigLoader::load(m_path);
        if (candidate->version != m_current->version) {
            m_current = std::move(candidate);
        }
        error.clear();
        return true;
    } catch (const std::exception& e) {
        error = e.what();
        return false;
    }
}
} // namespace snackshop
