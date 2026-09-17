#include "config_loader.h"
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
std::string string(const JsonValue& v, const std::string& at, bool empty = false) {
    if (!v.isString() || (!empty && v.asString().empty()) || v.asString().size() > 128) {
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
        object(row, at, {"level", "next_level", "cost", "conditions", "amount", "interval_ms", "range"});
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
            "pickup_item", "repair", "manager", "cat_ai", "manager_ai"});
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
        if (d.appearance != "wood" && d.appearance != "iron") {
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
                                                        {"door_attack_delay", ItemBehavior::DoorAttackDelay}};
    for (const auto& row : array(root["items"], "items")) {
        object(row, "items",
               {"id", "name", "category", "behavior", "appearance", "currency", "buildable", "unique", "levels"});
        ItemConfig item;
        item.id = id(row["id"], "items.id");
        item.name = string(row["name"], item.id + ".name");
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
        const std::set<std::string> appearances{"shelf",  "crate",     "launcher",   "pantry",
                                                "repair", "fish_rack", "mini_fridge"};
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
        const auto& levels = array(row["levels"], item.id + ".levels", 1, terrain ? 1 : 64);
        for (const auto& data : levels) {
            const int ordinal = static_cast<int>(item.levels.size()) + 1;
            auto l = level(data, *cfg, item.id + ".levels[" + std::to_string(ordinal) + "]", ordinal, levels.size(),
                           nests.size());
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
    for (const auto& row : array(root["initial_items"], "initial_items", 1, 128)) {
        const auto key = id(row, "initial_items");
        if (!cfg->items.contains(key) || !cfg->item(key).buildable ||
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

std::shared_ptr<const GameConfig> ConfigLoader::load(const std::filesystem::path& directory) {
    if (!std::filesystem::is_directory(directory)) {
        fail(directory.string(), "expected configuration directory");
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
    const std::array<const char*, 11> names{"manifest", "currencies", "match",     "doors",  "nests",     "items",
                                            "manager",  "repair",     "map_items", "cat_ai", "manager_ai"};
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
    auto result = tables.at("manifest");
    object(result, "manifest.json", {"schema_version", "version"});
    for (const auto* name :
         {"currencies", "match", "doors", "nests", "items", "manager", "repair", "cat_ai", "manager_ai"}) {
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
