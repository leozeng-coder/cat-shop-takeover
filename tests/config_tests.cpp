#include "game/game.h"
#include "game/logic_economy.h"
#include "item/logic_item.h"
#include "test_config.h"
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <json/json.h>
#include <stdexcept>
using namespace snackshop;
namespace {
int checks = 0;
void check(bool condition, const char* message) {
    ++checks;
    if (!condition) {
        throw std::runtime_error(message);
    }
}

Json::Value document() {
    const std::filesystem::path directory(GAME_CONFIG_PATH);
    auto read = [&](const std::string& name) {
        std::ifstream file(directory / (name + ".json"));
        Json::Value data;
        file >> data;
        return data;
    };
    auto data = read("manifest");
    for (const auto* name : {"currencies", "match", "doors", "nests", "items", "manager", "repair", "cat_ai",
                             "manager_ai", "map_generation"}) {
        data[name] = read(name);
    }
    const auto map = read("map_items");
    data["initial_items"] = map["initial_items"];
    data["pickup_item"] = map["pickup_item"];
    return data;
}
void saveTables(const std::filesystem::path& directory, const Json::Value& data) {
    auto save = [&](const std::string& name, const Json::Value& row) {
        std::ofstream file(directory / (name + ".json"));
        file << Json::writeString(Json::StreamWriterBuilder{}, row);
    };
    Json::Value manifest, map;
    manifest["schema_version"] = data["schema_version"];
    manifest["version"] = data["version"];
    map["initial_items"] = data["initial_items"];
    map["pickup_item"] = data["pickup_item"];
    save("manifest", manifest);
    save("map_items", map);
    for (const auto* name : {"currencies", "match", "doors", "nests", "items", "manager", "repair", "cat_ai",
                             "manager_ai", "map_generation"}) {
        save(name, data[name]);
    }
}
std::shared_ptr<const GameConfig> parse(const Json::Value& value) {
    return ConfigLoader::parse(Json::writeString(Json::StreamWriterBuilder{}, value));
}
void rejects(const std::function<void(Json::Value&)>& mutate, const char* message) {
    auto data = document();
    mutate(data);
    bool rejected = false;
    try {
        parse(data);
    } catch (const std::exception&) {
        rejected = true;
    }
    check(rejected, message);
}
Game claimed(std::shared_ptr<const GameConfig> config = testConfig()) {
    Game game("CFG", 1, 42, std::move(config));
    game.addHuman("Test");
    game.start(0);
    for (auto& p : game.players) {
        p.decisionAt = 10000;
    }
    auto& cat = game.players[0];
    cat.room = 0;
    cat.sleeping = true;
    game.dorms[0].owner = 0;
    game.dorms[0].props.clear();
    cat.position = GridMap::center(game.dorms[0].nest);
    return game;
}
int build(Game& game, const std::string& item, int player = 0) {
    for (int cell : game.dorms[game.players[player].room].floor) {
        if (!game.propAt(cell) && game.command(player, GameAction::Build, -1, cell, item).empty()) {
            return cell;
        }
    }
    throw std::runtime_error("No valid build cell");
}
void validation() {
    auto cfg = testConfig();
    check(cfg->door(1).displayName() == "木门 1级" && cfg->door(2).displayName() == "木门 2级" &&
              cfg->door(3).displayName() == "铁门 1级",
          "door names preserve monotonic internal stage");
    check(cfg->nest(2).requirements.doorStage == 2 && cfg->nest(3).requirements.doorStage == 3,
          "stable door IDs resolve prerequisites");
    check(cfg->currency("dried_fish").initial == 0, "second currency starts empty");
    const auto& launcher = cfg->item("launcher");
    check(launcher.levels[0].name == launcher.name && launcher.levels[0].appearance == launcher.appearance,
          "item levels inherit base presentation when no override is configured");
    check(launcher.levels[2].name == "双发毛线机" && launcher.levels[2].appearance == "launcher_dual" &&
              launcher.levels[4].name == "喵喵毛线炮" && launcher.levels[4].appearance == "launcher_cannon",
          "configured evolution changes item presentation without changing its behavior");
    rejects([](auto& d) { d["items"][0]["levels"][2]["appearance"] = "missing_skin"; },
            "unknown level appearance rejected");
    rejects([](auto& d) { d["items"][0]["levels"][2]["name"] = ""; }, "empty level name rejected");
    rejects([](auto& d) { d["map_generation"]["min_rooms"] = 5; }, "map must offer at least one room per cat");
    rejects([](auto& d) { d["map_generation"]["max_rooms"] = 11; }, "room count respects the map tile encoding");
    rejects([](auto& d) { d["map_generation"]["max_rooms"] = 7; }, "room count range cannot be inverted");
    rejects([](auto& d) { d["map_generation"]["min_room_width"] = 9; }, "minimum room width must fit dense blocks");
    rejects([](auto& d) { d["schema_version"] = 2; }, "unsupported schema rejected");
    rejects([](auto& d) { d["extra"] = 1; }, "unknown fields rejected");
    rejects([](auto& d) { d["currencies"].append(d["currencies"][0]); }, "duplicate currencies rejected");
    rejects([](auto& d) { d["currencies"][0]["initial"] = -1; }, "negative wallet rejected");
    rejects([](auto& d) { d["doors"][1]["health"] = 0; }, "zero door health rejected");
    rejects([](auto& d) { d["doors"][1]["appearance"] = "unknown"; }, "unknown door appearance rejected");
    rejects([](auto& d) { d["doors"][1]["health"] = 299; }, "decreasing door health rejected");
    rejects([](auto& d) { d["doors"][1]["stage"] = 3; }, "missing stage rejected");
    rejects([](auto& d) { d["doors"][1]["id"] = "wood_1"; }, "duplicate door ID rejected");
    rejects([](auto& d) { d["doors"][2]["next_stage"] = 1; }, "cyclic upgrade path rejected");
    rejects([](auto& d) { d["nests"][1]["conditions"][0]["id"] = "missing"; }, "missing prerequisite rejected");
    rejects(
        [](auto& d) {
            Json::Value c;
            c["type"] = "nest_level";
            c["level"] = 2;
            d["doors"][1]["conditions"].append(c);
        },
        "cyclic door/nest dependency rejected");
    rejects([](auto& d) { d["items"][0]["behavior"] = "execute_script"; }, "unknown code behavior rejected");
    rejects([](auto& d) { d["items"][0]["category"] = "currency"; }, "category mismatch rejected");
    rejects([](auto& d) { d["items"][0]["levels"][0]["interval_ms"] = 0; }, "zero interval rejected");
    rejects([](auto& d) { d["items"][0]["levels"][0]["amount"] = -1; }, "negative damage rejected");
    rejects([](auto& d) { d["items"][0]["levels"][0]["range"] = 0; }, "missing attack range rejected");
    rejects([](auto& d) { d["items"][1]["currency"] = "unknown"; }, "unknown output currency rejected");
    rejects([](auto& d) { d["items"][0]["levels"][0]["cost"][0]["amount"] = -5; }, "negative cost rejected");
    rejects([](auto& d) { d["items"][0]["levels"][0]["cost"][0]["amount"] = 0.5; }, "fractional cost rejected");
    rejects(
        [](auto& d) {
            auto& c = d["items"][0]["levels"][0]["cost"];
            c.append(c[0]);
        },
        "duplicate cost currency rejected");
    rejects([](auto& d) { d["items"][0]["levels"][0]["cost"][0]["currency"] = "unknown"; },
            "unknown payment currency rejected");
    rejects([](auto& d) { d["items"][0]["levels"][0]["cost"] = Json::Value(Json::arrayValue); },
            "free purchase rejected");
    rejects([](auto& d) { d["items"].append(d["items"][0]); }, "duplicate item rejected");
    rejects([](auto& d) { d["items"][0]["unique"] = "true"; }, "unique flag must be boolean");
    rejects(
        [](auto& d) {
            d["items"][0]["unique"] = true;
            d["items"][0]["buildable"] = false;
        },
        "uniqueness is only defined for installable items");
    auto fridgeRow = [](auto& data) -> Json::Value& {
        for (auto& item : data["items"]) {
            if (item["id"] == "mini_fridge") {
                return item;
            }
        }
        throw std::runtime_error("Missing fridge fixture");
    };
    rejects([&](auto& d) { fridgeRow(d)["levels"][0]["amount"] = 0; }, "zero attack delay rejected");
    rejects([&](auto& d) { fridgeRow(d)["levels"][0]["amount"] = 2000; },
            "attack delay cannot permanently stall attacks at every pulse");
    rejects([&](auto& d) { fridgeRow(d)["levels"][0]["range"] = 32; }, "door defense affects its own room");
    rejects([&](auto& d) { fridgeRow(d)["category"] = "attack"; }, "door delay uses utility behavior");
    rejects([](auto& d) { d["initial_items"][0] = "missing"; }, "invalid spawn item rejected");
    rejects([](auto& d) { d["pickup_item"] = "launcher"; }, "pickup behavior checked");
    check(cfg->enemy.damageRageMultiplier == document()["manager"]["damage_rage_multiplier"].asDouble() &&
              cfg->enemy.levelUpHealRatio == .25 && cfg->enemy.levels[1].levelUpAnnouncement == "店长生气了！",
          "manager rage, healing and per-level announcements load from the split table");
    rejects([](auto& d) { d["manager"]["levels"][9]["next_rage"] = 100; }, "max-level rage terminates");
    rejects([](auto& d) { d["manager"]["levels"][0]["next_rage"] = 0; }, "nonfinal levels need positive rage");
    rejects([](auto& d) { d["manager"]["damage_rage_multiplier"] = -1; }, "negative incoming-hit rage rejected");
    rejects([](auto& d) { d["manager"]["damage_rage_multiplier"] = 10001; }, "damage rage multiplier is bounded");
    rejects([](auto& d) { d["manager"]["damage_rage_multiplier"] = "0.5"; }, "damage rage multiplier must be numeric");
    auto fractionalManager = document();
    fractionalManager["manager"]["damage_rage_multiplier"] = 0.5;
    check(parse(fractionalManager)->enemy.damageRageMultiplier == .5,
          "fractional damage rage multipliers are supported");
    rejects([](auto& d) { d["manager"]["level_up_heal_percent"] = 101; }, "upgrade healing percent bounded");
    rejects([](auto& d) { d["manager"]["level_up_heal_percent"] = -1; }, "negative upgrade healing rejected");
    rejects([](auto& d) { d["manager"].removeMember("damage_rage_multiplier"); }, "incoming-hit rage is required");
    rejects([](auto& d) { d["manager"]["levels"][1]["level_up_announcement"] = ""; },
            "every upgrade level requires a nonempty announcement");
    rejects([](auto& d) { d["manager"]["levels"][1]["level_up_announcement"] = std::string(129, 'a'); },
            "announcement payload is bounded");
    auto customManager = document();
    customManager["manager"]["damage_rage_multiplier"] = 0;
    customManager["manager"]["level_up_heal_percent"] = 0;
    customManager["manager"]["levels"][1]["level_up_announcement"] = "罐头呢？！";
    auto custom = parse(customManager);
    check(custom->enemy.damageRageMultiplier == 0 && custom->enemy.levelUpHealRatio == 0 &&
              custom->enemy.levels[1].levelUpAnnouncement == "罐头呢？！",
          "manager numeric rules can be disabled and announcement copy is editable");
    rejects([](auto& d) { d["repair"]["cooldown_ms"] = 0; }, "zero repair cooldown rejected");
    rejects([](auto& d) { d["cat_ai"]["danger_interval_ms"] = 0; }, "AI interval cannot busy-loop");
    rejects([](auto& d) { d["cat_ai"]["escape_candidates"] = 1000; }, "AI path search has a bounded budget");
    rejects([](auto& d) { d["cat_ai"]["profiles"][0]["preference"] = "unknown"; }, "AI preference is registered");
    rejects([](auto& d) { d["cat_ai"]["profiles"].append(d["cat_ai"]["profiles"][0]); }, "AI profile IDs are unique");
    rejects([](auto& d) { d["cat_ai"]["profiles"][0]["producers"][0]["currency"] = "unknown"; },
            "AI production targets reference real currencies");
    rejects([](auto& d) { d["cat_ai"]["profiles"][0]["producers"].append(d["cat_ai"]["profiles"][0]["producers"][0]); },
            "AI production targets cannot be duplicated");
    rejects([](auto& d) { d["cat_ai"]["profiles"][0]["reserve"][0]["amount"] = -1; }, "AI reserves are positive");
    rejects([](auto& d) { d["manager_ai"]["target_interval_ms"] = 0; }, "manager targeting cannot busy-loop");
    rejects([](auto& d) { d["manager_ai"]["door_health_weight"] = -1; }, "manager weights cannot invert priority");
    rejects([](auto& d) { d["manager_ai"]["resume_health_percent"] = 20; }, "manager retreat has recovery hysteresis");
    rejects([](auto& d) { d["manager_ai"]["out_of_combat_delay_ms"] = -1; }, "manager combat delay is nonnegative");
    rejects([](auto& d) { d["manager_ai"]["out_of_combat_heal_percent_per_second"] = 101; },
            "manager healing rate is bounded");
    bool malformed = false;
    try {
        ConfigLoader::parse("{");
    } catch (const std::exception&) {
        malformed = true;
    }
    check(malformed, "invalid JSON rejected");
    bool duplicate = false;
    try {
        ConfigLoader::parse("{\"version\":1,\"version\":2}");
    } catch (const std::exception&) {
        duplicate = true;
    }
    check(duplicate, "duplicate JSON keys rejected");
}
void progressionAndMoney() {
    auto game = claimed();
    auto& p = game.players[0];
    p.wallet["cans"] = 1000;
    const auto saved = p.wallet;
    check(!game.nestUpgradeError(0).empty(), "UI offer enforces prerequisite");
    check(!game.command(0, GameAction::UpgradeNest).empty() && p.wallet == saved && p.bed == 1,
          "failed nest condition leaves money and level untouched");
    check(game.command(0, GameAction::UpgradeBarricade).empty(), "wood two purchase");
    check(game.command(0, GameAction::UpgradeBarricade).empty(), "iron one purchase");
    check(game.nestUpgradeError(0).empty(), "higher material stage satisfies wood prerequisite");
    check(game.command(0, GameAction::UpgradeNest).empty() && game.command(0, GameAction::UpgradeNest).empty(),
          "nest upgrades through configured conditions");
    check(p.bed == 3 && game.dorms[0].level == 3 && p.wallet["cans"] == 420, "all costs applied once");
    check(!game.command(0, GameAction::UpgradeNest).empty(), "next nest requires its configured door");
    game.dorms[0].hp = 0;
    check(!game.command(0, GameAction::Repair, 0).empty(), "repair cannot resurrect broken door");
    check(!game.command(0, GameAction::UpgradeBarricade).empty(), "upgrade cannot resurrect broken door");
    const Cost mixed{{"cans", 50}, {"dried_fish", 2}};
    const int cans = p.wallet["cans"];
    p.wallet["dried_fish"] = 1;
    check(!LogicEconomy::pay(p, mixed) && p.wallet["cans"] == cans && p.wallet["dried_fish"] == 1,
          "mixed payment is atomic");
    p.wallet["dried_fish"] = 2;
    check(LogicEconomy::pay(p, mixed) && p.wallet["cans"] == cans - 50 && p.wallet["dried_fish"] == 0,
          "mixed payment succeeds once");
    LogicEconomy::credit(p, game.config(), "cans", 1000000);
    check(p.wallet["cans"] == game.config().currency("cans").limit, "wallet cap prevents overflow");
    game.phase = "won";
    check(game.rematch(0).empty() && game.players[0].wallet["cans"] == 120 && game.players[0].wallet["dried_fish"] == 0,
          "new match resets both currencies");
}
void extendedProgression() {
    auto game = claimed();
    auto& cat = game.players[0];
    auto& room = game.dorms[0];
    cat.wallet["cans"] = 100000;
    cat.wallet["dried_fish"] = 100000;
    while (game.config().nest(cat.bed).nextLevel) {
        const auto& nextNest = game.config().nest(cat.bed + 1);
        while (room.level < nextNest.requirements.doorStage) {
            check(game.command(0, GameAction::UpgradeBarricade).empty(), "next door unlocked by previous nest");
        }
        check(game.command(0, GameAction::UpgradeNest).empty(), "all configured nest tiers are reachable");
    }
    check(cat.bed == static_cast<int>(game.config().nests.size()) && !game.command(0, GameAction::UpgradeNest).empty(),
          "highest configured nest is capped without charging");
    const auto& weapon = game.config().item("launcher");
    const int cell = build(game, weapon.id);
    bool checkedFish = false;
    for (const auto& level : weapon.levels) {
        if (level.level == 1) {
            continue;
        }
        for (const auto& price : level.cost) {
            if (price.currency != "dried_fish") {
                continue;
            }
            cat.wallet["dried_fish"] = price.amount - 1;
            const auto wallet = cat.wallet;
            check(!game.command(0, GameAction::Build, -1, cell, weapon.id).empty() && cat.wallet == wallet &&
                      game.propAt(cell)->level == level.level - 1,
                  "late weapon cannot spend cans when one fish is missing");
            cat.wallet["dried_fish"] = price.amount;
            checkedFish = true;
        }
        const auto wallet = cat.wallet;
        check(game.command(0, GameAction::Build, -1, cell, weapon.id).empty() &&
                  game.propAt(cell)->level == level.level,
              "late weapon upgrades after both currencies are available");
        for (const auto& price : level.cost) {
            check(cat.wallet[price.currency] == wallet.at(price.currency) - price.amount,
                  "configured upgrade charges each currency exactly once");
        }
    }
    check(checkedFish && !game.command(0, GameAction::Build, -1, cell, weapon.id).empty(),
          "late weapon uses fish and rejects upgrades at its configured cap");
}
void steelDoorProgression() {
    auto game = claimed();
    auto& cat = game.players[0];
    auto& room = game.dorms[0];
    const auto& steel = game.config().door(7);
    check(steel.id == "steel_1" && steel.appearance == "steel" && steel.displayName() == "钢门 1级" &&
              steel.requirements.nestLevel == 6 && steel.nextStage == 0,
          "steel follows iron and requires the final nest");
    cat.wallet["cans"] = 100000;
    cat.wallet["dried_fish"] = 100000;
    cat.bed = 5;
    room.level = 6;
    room.hp = game.config().door(6).health - 321;
    const auto walletBefore = cat.wallet;
    const double damagedHealth = room.hp;
    check(!game.command(0, GameAction::UpgradeBarricade).empty() && cat.wallet == walletBefore && room.level == 6 &&
              room.hp == damagedHealth,
          "steel prerequisite rejection leaves the wallet and damaged door intact");
    check(game.command(0, GameAction::UpgradeNest).empty() && cat.bed == 6,
          "final iron door unlocks the nest needed for steel");
    cat.wallet["cans"] = steel.cost.front().amount - 1;
    const auto insufficientWallet = cat.wallet;
    check(!game.command(0, GameAction::UpgradeBarricade).empty() && cat.wallet == insufficientWallet &&
              room.level == 6 && room.hp == damagedHealth,
          "steel cannot be purchased with insufficient cans");
    for (const auto& price : steel.cost) {
        cat.wallet[price.currency] = price.amount;
    }
    --cat.wallet["dried_fish"];
    const auto insufficientFish = cat.wallet;
    check(!game.command(0, GameAction::UpgradeBarricade).empty() && cat.wallet == insufficientFish && room.level == 6 &&
              room.hp == damagedHealth,
          "steel rejects insufficient fish without charging cans");
    ++cat.wallet["dried_fish"];
    room.hp = 0;
    const auto brokenWallet = cat.wallet;
    check(!game.command(0, GameAction::UpgradeBarricade).empty() && cat.wallet == brokenWallet && room.level == 6 &&
              room.hp == 0,
          "steel upgrade cannot resurrect a broken door");
    room.hp = damagedHealth;
    check(game.command(0, GameAction::UpgradeBarricade).empty() && room.level == 7 && room.hp == steel.health - 321 &&
              cat.wallet["cans"] == 0 && cat.wallet["dried_fish"] == 0,
          "steel upgrade spends both configured currencies and preserves existing damage");
    const auto finalWallet = cat.wallet;
    check(!game.command(0, GameAction::UpgradeBarricade).empty() && cat.wallet == finalWallet && room.level == 7 &&
              room.hp == steel.health - 321,
          "maximum steel tier rejects repeated purchases without changing state");
}
void newItemsAndLevels() {
    auto data = document();
    auto fish = data["items"][1];
    fish["id"] = "fish_basket";
    fish["name"] = "小鱼干篮";
    fish["currency"] = "dried_fish";
    fish["levels"].resize(1);
    auto& level = fish["levels"][0];
    level["next_level"] = 0;
    level["amount"] = 3;
    level["interval_ms"] = 500;
    level["cost"][0]["amount"] = 50;
    Json::Value currency;
    currency["currency"] = "dried_fish";
    currency["amount"] = 2;
    level["cost"].append(currency);
    data["items"].append(fish);
    const int last = static_cast<int>(data["doors"].size()) - 1;
    auto newDoor = data["doors"][last];
    newDoor["id"] = "test_extra_door";
    newDoor["stage"] = last + 2;
    newDoor["display_level"] = newDoor["display_level"].asInt() + 1;
    newDoor["health"] = newDoor["health"].asInt() + 1000;
    newDoor["next_stage"] = 0;
    data["doors"][last]["next_stage"] = last + 2;
    data["doors"].append(newDoor);
    auto cfg = parse(data);
    auto game = claimed(cfg);
    auto& p = game.players[0];
    p.wallet["cans"] = 1000;
    const auto saved = p.wallet;
    check(!game.purchaseError(0, cfg->item("fish_basket").levels[0].cost).empty(), "new item uses secondary cost");
    bool rejected = true;
    for (int cell : game.dorms[0].floor) {
        if (game.command(0, GameAction::Build, -1, cell, "fish_basket").empty()) {
            rejected = false;
        }
    }
    check(rejected && p.wallet == saved && game.dorms[0].props.empty(),
          "insufficient second currency cannot partially build");
    p.wallet["dried_fish"] = 2;
    const int built = build(game, "fish_basket");
    check(game.propAt(built)->kind == "fish_basket" && p.wallet["dried_fish"] == 0 && p.wallet["cans"] == 950,
          "new ID dispatches existing behavior without code changes");
    p.sleeping = false;
    for (int i = 0; i < 40; ++i) {
        game.step(.05);
    }
    check(p.wallet["dried_fish"] == 12 && p.wallet["cans"] == 962,
          "configured intervals produce distinct currencies while awake");
    check(game.income(p, "dried_fish") == 6, "income rate matches configured period");
    p.alive = false;
    for (int i = 0; i < 20; ++i) {
        game.step(.05);
    }
    check(p.wallet["dried_fish"] == 12, "capture stops new currency production");
    p.alive = true;
    p.wallet["cans"] = 100000;
    p.wallet["dried_fish"] = 100000;
    while (game.config().door(game.dorms[0].level).nextStage) {
        const auto& next = game.config().door(game.dorms[0].level + 1);
        while (p.bed < next.requirements.nestLevel) {
            check(game.command(0, GameAction::UpgradeNest).empty(), "extended door nest prerequisite reachable");
        }
        check(game.command(0, GameAction::UpgradeBarricade).empty(), "extended door stage reachable");
    }
    check(game.dorms[0].level == last + 2 && game.config().door(last + 2).id == "test_extra_door",
          "level cap follows configuration");
    check(!game.command(0, GameAction::UpgradeBarricade).empty(), "configured maximum door cannot upgrade");
    auto attack = data["items"][0];
    attack["id"] = "heavy_launcher";
    attack["levels"][0]["amount"] = 77;
    attack["levels"][0]["range"] = 1000;
    data["items"].append(attack);
    // Isolate generic item damage from manager level-up recovery.
    data["manager"]["damage_rage_multiplier"] = 0;
    auto battle = claimed(parse(data));
    battle.players[0].wallet["cans"] = 500;
    const int cell = build(battle, "heavy_launcher");
    battle.monster.position = GridMap::center(cell);
    const double hp = battle.monster.hp;
    LogicItem::updateAttack(battle, .05);
    check(battle.monster.hp == hp - 77, "attack dispatch uses item level amount");
    LogicItem::updateAttack(battle, .05);
    check(battle.monster.hp == hp - 77, "configured attack cooldown prevents repeated hit");
    const int repair = build(battle, "repair");
    check(repair != cell, "multiple behaviors coexist");
    battle.dorms[0].hp = 100;
    for (int i = 0; i < 20; ++i) {
        LogicItem::updatePassive(battle, .05);
    }
    check(battle.dorms[0].hp == 100 + battle.config().item("repair").levels[0].amount,
          "utility dispatch restores configured durability");
}

void uniqueFridgePurchases() {
    auto game = claimed();
    auto& cat = game.players[0];
    cat.wallet["cans"] = 10000;
    cat.wallet["dried_fish"] = 10000;
    const auto& fridge = game.config().item("mini_fridge");
    check(fridge.unique && fridge.behavior == ItemBehavior::DoorAttackDelay && fridge.levels.size() == 5,
          "fridge is configured as a unique five-level utility");
    for (int i = 0; i < 5; ++i) {
        check(fridge.levels[i].amount == (i + 1) * 200 && fridge.levels[i].intervalMs == 2000,
              "fridge delay scales from 200 to 1000 ms at a 2 second pulse interval");
    }
    check(game.itemPurchaseError(0, fridge, 1).empty(), "first unique purchase is offered");
    const int cell = build(game, fridge.id);
    check(cat.wallet["cans"] == 10000 - fridge.levels[0].cost[0].amount, "initial unique purchase charges once");
    int other = -1;
    for (int candidate : game.dorms[0].floor) {
        if (!game.propAt(candidate) && candidate != game.dorms[0].nest && candidate != game.dorms[0].door) {
            other = candidate;
            break;
        }
    }
    check(other >= 0, "duplicate purchase fixture has a free tile");
    const auto wallet = cat.wallet;
    const auto count = game.dorms[0].props.size();
    check(!game.itemPurchaseError(0, fridge, 1).empty() &&
              !game.command(0, GameAction::Build, -1, other, fridge.id).empty() && cat.wallet == wallet &&
              game.dorms[0].props.size() == count,
          "unique duplicate is rejected before charging or placing another prop");
    for (int level = 2; level <= 5; ++level) {
        const int requiredDoor = fridge.levels[level - 1].requirements.doorStage;
        while (game.dorms[0].level < requiredDoor) {
            const auto& next = game.config().door(game.dorms[0].level + 1);
            while (cat.bed < next.requirements.nestLevel) {
                check(game.command(0, GameAction::UpgradeNest).empty(), "nest unlocks fridge prerequisite door");
            }
            check(game.command(0, GameAction::UpgradeBarricade).empty(), "door unlocks fridge upgrade");
        }
        check(game.itemPurchaseError(0, fridge, level).empty() &&
                  game.command(0, GameAction::Build, -1, cell, fridge.id).empty() && game.propAt(cell)->level == level,
              "existing unique item can upgrade in place");
    }
    check(!game.command(0, GameAction::Build, -1, cell, fridge.id).empty(), "max-level unique item remains capped");
    game.setConnected(0, false);
    game.setConnected(0, true);
    check(!game.itemPurchaseError(0, fridge, 1).empty(), "reconnect cannot reset uniqueness");
    game.players[1].room = 1;
    game.players[1].position = GridMap::center(game.dorms[1].nest);
    game.players[1].wallet["cans"] = 10000;
    game.dorms[1].owner = 1;
    game.dorms[1].props.clear();
    check(game.itemPurchaseError(1, fridge, 1).empty() && build(game, fridge.id, 1) >= 0,
          "uniqueness is per player, not shared across the match");
    auto data = document();
    auto unique = data["items"][1];
    unique["id"] = "unique_pantry";
    unique["unique"] = true;
    data["items"].append(unique);
    auto generic = claimed(parse(data));
    generic.players[0].wallet["cans"] = 10000;
    build(generic, "unique_pantry");
    check(!generic.itemPurchaseError(0, generic.config().item("unique_pantry"), 1).empty(),
          "unique purchases use item configuration rather than fridge IDs");
    const int first = build(generic, "pantry"), second = build(generic, "pantry");
    check(first != second, "ordinary items without a unique flag can still be installed multiple times");
    game.phase = "won";
    check(game.rematch(0).empty(), "unique item match can restart");
    for (const auto& room : game.dorms) {
        check(room.doorDefenseReadyAt == 0 && room.attackDelayUntil == 0,
              "rematch clears all door defense cooldowns and delayed attacks");
    }
}
void fishRackProduction() {
    auto game = claimed();
    auto& p = game.players[0];
    const auto& rack = game.config().item("fish_rack");
    const auto& first = rack.levels.front();
    p.wallet["cans"] = 2000;
    const int cell = build(game, rack.id);
    check(p.wallet["cans"] == 2000 - first.cost.front().amount && p.wallet["dried_fish"] == 0,
          "rack construction charges cans without granting fish early");
    auto tick = [&](int count) {
        for (int i = 0; i < count; ++i) {
            game.step(.05);
        }
    };
    int earned = 0;
    for (const auto& level : rack.levels) {
        if (level.level > 1) {
            int fishCost = 0;
            for (const auto& price : level.cost) {
                if (price.currency == "dried_fish") {
                    fishCost = price.amount;
                }
            }
            while (earned < fishCost) {
                const auto& previous = rack.levels[level.level - 2];
                tick(previous.intervalMs / 50);
                earned += previous.amount;
            }
            const auto wallet = p.wallet;
            check(game.command(0, GameAction::Build, -1, cell, rack.id).empty(),
                  "rack can fund its own upgrades through production");
            for (const auto& price : level.cost) {
                check(p.wallet[price.currency] == wallet.at(price.currency) - price.amount,
                      "rack upgrade pays each configured currency");
            }
            earned -= fishCost;
        }
        p.sleeping = level.level == 1;
        const int ticks = level.intervalMs / 50;
        tick(ticks - 1);
        check(p.wallet["dried_fish"] == earned, "rack waits for the entire production interval");
        tick(1);
        earned += level.amount;
        check(p.wallet["dried_fish"] == earned &&
                  game.income(p, "dried_fish") == level.amount * 1000.0 / level.intervalMs,
              "rack level controls secondary-currency payout and displayed rate");
        check(game.players[1].wallet["dried_fish"] == 0, "rack only pays its room owner");
    }
    const auto wallet = p.wallet;
    check(!game.command(0, GameAction::Build, -1, cell, rack.id).empty() && p.wallet == wallet,
          "max-level rack rejects another purchase without charging");
    p.alive = false;
    tick(rack.levels.back().intervalMs / 50);
    check(p.wallet == wallet, "captured owner receives no further income");
}

void snapshots() {
    const auto filename =
        std::filesystem::temp_directory_path() /
        ("cat-shop-config-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directory(filename);
    struct Cleanup {
        std::filesystem::path path;
        ~Cleanup() {
            std::error_code error;
            for (const auto* name : {"manifest", "currencies", "match", "doors", "nests", "items", "manager", "repair",
                                     "map_items", "cat_ai", "manager_ai", "map_generation"}) {
                std::filesystem::remove(path / (std::string(name) + ".json"), error);
            }
            std::filesystem::remove(path, error);
        }
    } cleanup{filename};
    auto data = document();
    auto save = [&] { saveTables(filename, data); };
    save();
    ConfigStore store(filename);
    const auto before = store.current();
    auto oldGame = claimed(before);
    data["nests"][0]["amount"] = 9;
    data["cat_ai"]["repair_threshold_percent"] = 50;
    data["manager_ai"]["out_of_combat_delay_ms"] = 8000;
    save();
    std::string error;
    check(store.reload(error) && error.empty(), "complete valid reload accepted");
    const auto after = store.current();
    check(before->version != after->version, "content edits change snapshot identity without manual version bump");
    auto newGame = claimed(after);
    check(oldGame.income(oldGame.players[0]) == 6 && newGame.income(newGame.players[0]) == 9,
          "existing and new games retain independent config snapshots");
    check(oldGame.config().catAi.repairThreshold == .65 && newGame.config().catAi.repairThreshold == .5,
          "old AI keeps its configuration while new matches use updated strategy");
    check(oldGame.config().managerAi.outOfCombatDelay == before->managerAi.outOfCombatDelay &&
              newGame.config().managerAi.outOfCombatDelay == 8,
          "manager strategy is frozen per match and reloaded for new matches");
    data["nests"][0]["amount"] = -1;
    save();
    check(!store.reload(error) && !error.empty() && store.current() == after,
          "bad reload preserves entire last good config");
    bool startupRejected = false;
    try {
        ConfigStore invalid(filename);
    } catch (const std::exception&) {
        startupRejected = true;
    }
    check(startupRejected, "invalid first load fails instead of silently using defaults");
    oldGame.phase = "won";
    check(oldGame.rematch(0, after).empty() && oldGame.config().version == after->version,
          "rematch can bind latest valid snapshot");
}
} // namespace
int main() {
    try {
        validation();
        progressionAndMoney();
        extendedProgression();
        steelDoorProgression();
        newItemsAndLevels();
        fishRackProduction();
        uniqueFridgePurchases();
        snapshots();
        std::cout << "PASS " << checks << " configuration/economy checks\n";
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n';
        return 1;
    }
}
