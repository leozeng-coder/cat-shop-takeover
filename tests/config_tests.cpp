#include "game/game.h"
#include "game/logic_economy.h"
#include "item/logic_item.h"
#include "item/logic_random_item.h"
#include "test_config.h"
#include <algorithm>
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
                             "manager_ai", "map_generation", "characters", "random_items"}) {
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
                             "manager_ai", "map_generation", "characters", "random_items"}) {
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
    cat.position = game.map.center(game.dorms[0].nest);
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
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["min_rooms"] = 5; },
            "map must offer at least one room per cat");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["max_rooms"] = MaxRooms + 1; },
            "room count respects the map tile encoding");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["max_rooms"] = 7; },
            "room count range cannot be inverted");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["min_room_width"] = 9; },
            "minimum room width must fit dense blocks");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["width"] = 24; },
            "map must fit its rooms and public lanes");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["corridor_width"] = 1; }, "spawn needs two street rows");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["min_room_area"] = 64; }, "room area range cannot invert");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["max_room_area"] = 18; },
            "area must be feasible for every plot");
    rejects([](auto& d) { d["map_generation"]["profiles"][0]["layout_complexity"] = 4; },
            "unsupported complexity rejected");
    rejects([](auto& d) { d["map_generation"]["profiles"].append(d["map_generation"]["profiles"][0]); },
            "duplicate map ID rejected");
    rejects(
        [](auto& d) {
            for (auto& p : d["map_generation"]["profiles"]) {
                p["weight"] = 0;
            }
        },
        "need an enabled map");
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
    battle.monster.position = battle.map.center(cell);
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
    game.players[1].position = game.map.center(game.dorms[1].nest);
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
void randomItemPurchases() {
    rejects([](auto& d) { d["random_items"][0]["level_weight_decay"] = 1; }, "equal level weights rejected");
    rejects([](auto& d) { d["random_items"][0]["level_weight_decay"] = 0; }, "unreachable high levels rejected");
    rejects(
        [](auto& d) {
            const int firstPrice = d["random_items"][0]["purchase_costs"][0][0]["amount"].asInt();
            d["random_items"][0]["purchase_costs"][1][0]["amount"] = firstPrice - 1;
        },
        "decreasing price rejected");
    rejects([](auto& d) { d["random_items"][0]["purchase_costs"] = Json::Value(Json::arrayValue); },
            "empty purchase limit rejected");
    rejects([](auto& d) { d["random_items"][0]["item"] = "launcher"; }, "random rule needs consumable behavior");
    rejects([](auto& d) { d["random_items"] = Json::Value(Json::arrayValue); }, "missing random rule rejected");
    rejects([](auto& d) { d["initial_items"].append("magic_trash_bin"); },
            "pending consumables cannot spawn as map furniture");
    auto game = claimed();
    auto& cat = game.players[0];
    auto& room = game.dorms[0];
    const auto& item = game.config().item("magic_trash_bin");
    const auto& rule = game.config().randomItems.at(item.id);
    check(rule.purchaseCosts.size() == 3, "three purchases per seat per match");
    for (const auto& [id, entry] : game.config().items) {
        check(!entry.description.empty(), "every item has a description");
    }
    check(LogicRandomItem::pool(game, 0, item.id).size() == 5,
          "pool has all five installable items, without terrain or consumables");
    const int tile = room.floor.front() == room.nest ? room.floor.back() : room.floor.front();
    cat.wallet["cans"] = 0;
    check(!game.command(0, GameAction::Build, -1, tile, item.id).empty() && cat.itemPurchases.empty() &&
              room.props.empty(),
          "insufficient funds never consume a draw or occupy a tile");
    cat.wallet["cans"] = 10000;
    cat.wallet["dried_fish"] = 10000;
    const auto initial = cat.wallet;
    check(!game.command(0, GameAction::Build, -1, room.nest, item.id).empty() && cat.wallet == initial,
          "invalid placement is rejected before charging");
    room.hp = 0;
    check(!game.command(0, GameAction::Build, -1, tile, item.id).empty() && cat.itemPurchases.empty(),
          "escaping cannot purchase a random item");
    room.hp = game.config().door(1).health;
    for (int i = 0; i < 3; ++i) {
        const auto before = cat.wallet;
        const int cell = build(game, item.id);
        const auto pending = *game.propAt(cell);
        check(pending.kind == item.id && pending.revealAt > game.elapsed && !pending.rewardKind.empty(),
              "purchase first installs a pending trash bin");
        check(LogicRandomItem::purchased(cat, item.id) == i + 1, "placement consumes exactly one draw");
        for (const auto& cost : rule.purchaseCosts[i]) {
            check(cat.wallet[cost.currency] == before.at(cost.currency) - cost.amount,
                  "each purchase uses its configured price");
        }
        const auto paid = cat.wallet;
        check(!game.command(0, GameAction::Build, -1, cell, item.id).empty() && cat.wallet == paid &&
                  LogicRandomItem::purchased(cat, item.id) == i + 1,
              "repeated clicks on a shaking bin neither reroll nor charge");
        const auto pool = LogicRandomItem::pool(game, 0, item.id);
        if (game.config().item(pending.rewardKind).unique) {
            check(std::none_of(pool.begin(), pool.end(),
                               [&](const auto* reward) { return reward->item == pending.rewardKind; }),
                  "pending unique reward is reserved against other rolls");
            check(!game.itemPurchaseError(0, game.config().item(pending.rewardKind), 1).empty(),
                  "pending unique reward blocks direct duplicate purchase");
        }
        game.setConnected(0, false);
        game.setConnected(0, true);
        check(game.propAt(cell)->rewardKind == pending.rewardKind && LogicRandomItem::purchased(cat, item.id) == i + 1,
              "reconnect preserves the draw result and usage");
        game.elapsed = pending.revealAt - .05;
        LogicRandomItem::update(game);
        check(game.propAt(cell)->kind == item.id, "reward remains hidden throughout the shaking interval");
        game.elapsed = pending.revealAt;
        LogicRandomItem::update(game);
        const auto& revealed = *game.propAt(cell);
        check(revealed.kind == pending.rewardKind && revealed.level == pending.rewardLevel &&
                  revealed.rewardKind.empty(),
              "deadline replaces the bin in place with its original rolled level");
        check(game.config().item(revealed.kind).levels.size() >= static_cast<std::size_t>(revealed.level),
              "rolled level is valid for the selected item");
        const auto notices = game.notices.front().id;
        LogicRandomItem::update(game);
        check(game.notices.front().id == notices, "revealing twice cannot issue another reward");
    }
    const auto wallet = cat.wallet;
    check(!game.itemPurchaseError(0, item, 1).empty() &&
              !game.command(0, GameAction::Build, -1, tile, item.id).empty() && cat.wallet == wallet,
          "fourth purchase is denied without debit");
    game.players[1].room = 1;
    game.players[1].wallet = initial;
    game.dorms[1].owner = 1;
    game.dorms[1].props.clear();
    check(game.itemPurchaseError(1, item, 1).empty() && build(game, item.id, 1) >= 0,
          "other players have an independent purchase allowance");
    game.phase = "won";
    check(game.rematch(0).empty() && cat.itemPurchases.empty(), "new match resets the purchase allowance");
    for (const auto& r : game.dorms) {
        check(std::none_of(r.props.begin(), r.props.end(), [](const auto& p) { return !p.rewardKind.empty(); }),
              "new match clears all pending rewards");
    }
}
void configuredRandomRewards() {
    auto data = document();
    auto& rule = data["random_items"][0];
    rule.removeMember("level_weight_decay");
    Json::Value reward;
    reward["item"] = "launcher";
    reward["weight"] = 7;
    reward["min_level"] = 2;
    reward["max_level"] = 4;
    for (int i = 2; i <= 4; ++i) {
        Json::Value level;
        level["level"] = i;
        level["weight"] = i == 3 ? 23 : 0;
        reward["level_weights"].append(level);
    }
    rule["rewards"] = Json::Value(Json::arrayValue);
    rule["rewards"].append(reward);
    auto rejectsPool = [&](const std::function<void(Json::Value&)>& change, const char* message) {
        auto invalid = data;
        change(invalid["random_items"][0]["rewards"]);
        bool rejected = false;
        try {
            parse(invalid);
        } catch (const std::exception&) {
            rejected = true;
        }
        check(rejected, message);
    };
    rejectsPool([](auto& r) { r[0]["item"] = "missing"; }, "unknown reward rejected");
    rejectsPool([](auto& r) { r[0]["item"] = "shelf"; }, "unbuildable reward rejected");
    rejectsPool([](auto& r) { r[0]["item"] = "magic_trash_bin"; }, "recursive random reward rejected");
    rejectsPool([](auto& r) { r.append(r[0]); }, "duplicate reward rejected");
    rejectsPool([](auto& r) { r.clear(); }, "empty configured pool rejected");
    rejectsPool([](auto& r) { r[0]["weight"] = 0; }, "all-zero item weights rejected");
    rejectsPool([](auto& r) { r[0]["weight"] = -1; }, "negative weight rejected");
    rejectsPool([](auto& r) { r[0]["weight"] = "100"; }, "string weight rejected");
    rejectsPool([](auto& r) { r[0]["weight"] = 1000000001; }, "out of range weight rejected");
    rejectsPool([](auto& r) { r[0]["weight"] = 1.5; }, "fractional item weight rejected");
    rejectsPool([](auto& r) { r[0]["min_level"] = 5; }, "reversed range rejected");
    rejectsPool([](auto& r) { r[0]["max_level"] = 64; }, "unknown level rejected");
    rejectsPool([](auto& r) { r[0]["level_weights"][0]["weight"] = 0.001; }, "fractional level weight rejected");
    rejectsPool([](auto& r) { r[0]["level_weights"][1]["weight"] = 0; }, "all-zero level weights rejected");
    rejectsPool([](auto& r) { r[0]["level_weights"][1]["level"] = 2; }, "duplicate level rejected");
    rejectsPool([](auto& r) { r[0]["level_weights"].resize(2); }, "missing level rejected");
    auto game = claimed(parse(data));
    game.players[0].wallet = {{"cans", 10000}, {"dried_fish", 10000}};
    const int cell = build(game, "magic_trash_bin");
    check(game.propAt(cell)->rewardKind == "launcher" && game.propAt(cell)->rewardLevel == 3,
          "two-stage draw uses the configured item and level, skipping zero chances");
    game.elapsed = game.propAt(cell)->revealAt;
    LogicRandomItem::update(game);
    check(game.propAt(cell)->kind == "launcher" && game.propAt(cell)->level == 3,
          "configured level replaces the bin when revealed");

    auto& entry = rule["rewards"][0];
    entry["item"] = "mini_fridge";
    auto uniqueGame = claimed(parse(data));
    auto& cat = uniqueGame.players[0];
    cat.wallet = {{"cans", 10000}, {"dried_fish", 10000}};
    build(uniqueGame, "magic_trash_bin");
    const auto before = cat.wallet;
    std::mt19937 random(12);
    check(!LogicRandomItem::purchase(uniqueGame, 0, uniqueGame.dorms[0].floor.back(),
                                     uniqueGame.config().item("magic_trash_bin"), random)
                  .empty() &&
              cat.wallet == before && LogicRandomItem::purchased(cat, "magic_trash_bin") == 1,
          "pool exhausted by a pending unique reward neither charges nor consumes allowance");

    entry["weight"] = 3;
    reward["weight"] = 7;
    rule["rewards"].append(reward);
    auto fallback = claimed(parse(data));
    fallback.players[0].wallet = {{"cans", 10000}, {"dried_fish", 10000}};
    build(fallback, "mini_fridge");
    const int drawn = build(fallback, "magic_trash_bin");
    check(fallback.propAt(drawn)->rewardKind == "launcher",
          "remaining eligible probabilities are renormalized after unique exclusion");
    check(fallback.config().randomItems.at("magic_trash_bin").rewards[0].weight == 3 &&
              fallback.config().randomItems.at("magic_trash_bin").rewards[1].weight == 7,
          "relative item weights are independent of level count and need not total 100");
    reward["item"] = "fish_rack";
    reward["max_level"] = 3;
    reward["level_weights"].resize(2);
    rule["rewards"].append(reward);
    for (auto& r : rule["rewards"]) {
        r["weight"] = 1000000000;
        for (auto& l : r["level_weights"]) {
            l["weight"] = 1000000000;
        }
    }
    auto large = claimed(parse(data));
    large.players[0].wallet = {{"cans", 10000}, {"dried_fish", 10000}};
    for (int i = 0; i < 20; ++i) {
        large.players[0].itemPurchases.clear();
        large.dorms[0].props.clear();
        const int placed = build(large, "magic_trash_bin");
        check(large.propAt(placed)->rewardLevel >= 2 && large.propAt(placed)->rewardLevel <= 4,
              "item and level weight sums exceeding 32 bits draw valid rewards");
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

void customMapProfiles() {
    for (int bands : {2, 4}) {
        auto data = document();
        auto profile = data["map_generation"]["profiles"][0];
        profile["width"] = 64;
        profile["height"] = 52;
        profile["bands"] = bands;
        profile["layout_complexity"] = 0;
        profile["min_room_area"] = 40;
        profile["max_room_area"] = 42;
        data["map_generation"]["profiles"] = Json::Value(Json::arrayValue);
        data["map_generation"]["profiles"].append(profile);
        auto cfg = parse(data);
        Game game("CUSTOM", 1, 17, cfg);
        check(game.map.width == 64 && game.map.height == 52, "custom map dimensions come from the table");
        const auto street = game.map.distances(game.map.spawn, [&](int cell) { return game.map.tile(cell) == '.'; });
        for (const auto& room : game.dorms) {
            check(room.floor.size() >= 40 && room.floor.size() <= 42, "custom area bounds control usable floor cells");
            check(street[room.entrance] >= 0, "different band counts retain public access to every room");
            int left = game.map.width, right = 0, top = game.map.height, bottom = 0;
            for (int cell : room.floor) {
                left = std::min(left, cell % game.map.width);
                right = std::max(right, cell % game.map.width);
                top = std::min(top, cell / game.map.width);
                bottom = std::max(bottom, cell / game.map.width);
            }
            check(room.floor.size() == (right - left + 1) * (bottom - top + 1),
                  "complexity zero produces rectangular rooms");
        }
    }
}
void mapRulesAndInitialItems() {
    auto data = document();
    auto& profiles = data["map_generation"]["profiles"];
    for (auto& p : profiles) {
        p.removeMember("match");
        p.removeMember("initial_items");
    }
    auto reward = [](const char* item, int level, int weight) {
        Json::Value row, chance;
        row["item"] = item;
        row["weight"] = weight;
        row["min_level"] = row["max_level"] = level;
        chance["level"] = level;
        chance["weight"] = 1;
        row["level_weights"].append(chance);
        return row;
    };
    auto& profile = profiles[0];
    const auto id = profile["id"].asString();
    profile["match"]["preparation_ms"] = 12000;
    profile["match"]["duration_ms"] = 240000;
    auto& initial = profile["initial_items"];
    initial["min_per_room"] = initial["max_per_room"] = 2;
    initial["rewards"].append(reward("launcher", 2, 1000000000));
    initial["rewards"].append(reward("pantry", 1, 0));
    auto cfg = parse(data);
    Game game("MAP", 1, 17, cfg, id);
    check(game.balance.preparation == 12 && game.balance.duration == 240,
          "selected map supplies night and defense durations");
    for (const auto& room : game.dorms) {
        check(room.props.size() == 2, "map controls exact per-room item count");
        for (const auto& prop : room.props) {
            check(prop.kind == "launcher" && prop.level == 2 && prop.cell != room.nest,
                  "configured item and level replace defaults without occupying the nest");
        }
    }
    game.addHuman("Host");
    check(game.selectMap(0, profiles[1]["id"].asString()).empty() && game.balance.duration == cfg->balance.duration &&
              game.balance.preparation == cfg->balance.preparation,
          "switching to an unconfigured map restores global timing");
    for (const auto& room : game.dorms) {
        check(room.props.size() >= 1 && room.props.size() <= 2 &&
                  (room.props.size() != 2 || room.props[1].kind == cfg->pickupItem),
              "unconfigured maps retain legacy initial generation");
    }
    check(game.selectMap(0, id).empty() && game.balance.preparation == 12, "lobby map selection reapplies map timing");
    check(game.start(0).empty(), "custom map starts normally");
    game.elapsed = 11.9;
    game.step(.05);
    check(game.phase == "preparing", "custom night persists until its configured end");
    game.elapsed = 12;
    game.step(.05);
    check(game.phase == "running", "custom night ends on the server");
    game.elapsed = 252;
    game.step(.05);
    check(game.phase == "won", "match ends after custom night plus defense duration");
    profile["match"]["duration_ms"] = 300000;
    initial["min_per_room"] = initial["max_per_room"] = 0;
    initial["rewards"] = Json::Value(Json::arrayValue);
    auto next = parse(data);
    check(game.balance.duration == 240, "new configuration does not mutate an existing match");
    check(game.rematch(0, next).empty() && game.balance.duration == 300,
          "rematch adopts the latest selected map rules");
    check(std::all_of(game.dorms.begin(), game.dorms.end(), [](const auto& r) { return r.props.empty(); }),
          "zero count with an empty pool disables initial props");
    initial["min_per_room"] = initial["max_per_room"] = 3;
    initial["rewards"].append(reward("mini_fridge", 3, 1000000000));
    initial["rewards"].append(reward("crate", 1, 1));
    Game unique("UNIQUE", 1, 17, parse(data), id);
    for (const auto& room : unique.dorms) {
        check(room.props.size() == 3 && std::count_if(room.props.begin(), room.props.end(),
                                                      [](const auto& p) { return p.kind == "mini_fridge"; }) <= 1,
              "unique initial items occur at most once per room and remaining draws use eligible items");
    }
    auto invalid = [&](const std::function<void(Json::Value&)>& mutate, const char* message) {
        auto bad = data;
        mutate(bad["map_generation"]["profiles"][0]);
        bool rejected = false;
        try {
            parse(bad);
        } catch (const std::exception&) {
            rejected = true;
        }
        check(rejected, message);
    };
    invalid([](auto& p) { p["match"]["duration_ms"] = 0; }, "zero daytime rejected");
    invalid([](auto& p) { p["match"]["preparation_ms"] = -1; }, "negative nighttime rejected");
    invalid([](auto& p) { p["initial_items"]["max_per_room"] = 100; }, "too many initial props rejected");
    invalid([](auto& p) { p["initial_items"]["min_per_room"] = 4; }, "reversed count range rejected");
    invalid([](auto& p) { p["initial_items"]["rewards"][1]["weight"] = 0; }, "insufficient unique pool rejected");
    for (const auto* item : {"missing", "magic_trash_bin", "shelf"}) {
        invalid([&](auto& p) { p["initial_items"]["rewards"][0]["item"] = item; },
                "invalid, consumable and blocking initial props rejected");
    }
    invalid([](auto& p) { p["initial_items"]["rewards"][0]["weight"] = 1.5; }, "fractional map weight rejected");
    invalid([](auto& p) { p["initial_items"]["rewards"][0]["max_level"] = 99; }, "invalid map reward level rejected");
}
void pickupItemLevels() {
    auto data = document();
    for (auto& item : data["items"]) {
        if (item["id"].asString() != "crate") {
            continue;
        }
        const auto original = item["levels"][0];
        item["levels"] = Json::Value(Json::arrayValue);
        for (int i = 1; i <= 3; ++i) {
            auto level = original;
            level["level"] = i;
            level["next_level"] = i < 3 ? i + 1 : 0;
            level["amount"] = i * 90;
            item["levels"].append(level);
        }
    }
    auto& profile = data["map_generation"]["profiles"][0];
    auto& initial = profile["initial_items"];
    initial["min_per_room"] = initial["max_per_room"] = 1;
    Json::Value reward, chance;
    reward["item"] = "crate";
    reward["weight"] = 1;
    reward["min_level"] = reward["max_level"] = 3;
    chance["level"] = 3;
    chance["weight"] = 1;
    reward["level_weights"].append(chance);
    initial["rewards"] = Json::Value(Json::arrayValue);
    initial["rewards"].append(reward);
    auto cfg = parse(data);
    check(!cfg->item("crate").buildable && cfg->item("crate").levels.size() == 3,
          "non-purchasable pickups support independently configured tiers");
    Game game("PICKUP", 1, 17, cfg, profile["id"].asString());
    game.addHuman("Collector");
    game.start(0);
    for (auto& player : game.players) {
        player.decisionAt = 10000;
    }
    const auto prop = game.dorms[0].props[0];
    check(prop.kind == "crate" && prop.level == 3, "map spawns the configured pickup tier");
    auto& player = game.players[0];
    player.position = game.map.center(prop.cell);
    const auto before = player.wallet.at("cans");
    game.step(.05);
    check(player.wallet.at("cans") == before + 270 && game.propAt(prop.cell) == nullptr,
          "pickup credits its own tier amount and consumes the item");
    game.step(.05);
    check(player.wallet.at("cans") == before + 270, "the same crate cannot be collected twice");
    Game contested("PICKUP-RACE", 1, 19, cfg, profile["id"].asString());
    contested.addHuman("Collector");
    contested.start(0);
    for (auto& cat : contested.players) {
        cat.decisionAt = 10000;
    }
    const int contestedCell = contested.dorms[0].props[0].cell;
    const int humanBefore = contested.players[0].wallet.at("cans");
    const int aiBefore = contested.players[1].wallet.at("cans");
    contested.players[0].position = contested.players[1].position = contested.map.center(contestedCell);
    contested.step(.05);
    const int humanGain = contested.players[0].wallet.at("cans") - humanBefore;
    const int aiGain = contested.players[1].wallet.at("cans") - aiBefore;
    check(((humanGain == 270 && aiGain == 0) || (humanGain == 0 && aiGain == 270)) &&
              contested.propAt(contestedCell) == nullptr,
          "two cats reaching one pickup in the same tick collect it exactly once");
    player.room = 0;
    game.dorms[0].owner = 0;
    check(!game.command(0, GameAction::Build, -1, prop.cell, "crate").empty() && game.propAt(prop.cell) == nullptr,
          "a pickup remains unavailable for purchase after adding tiers");
    for (auto& item : data["items"]) {
        if (item["id"].asString() == "crate") {
            item["buildable"] = true;
        }
    }
    bool rejected = false;
    try {
        parse(data);
    } catch (const std::exception&) {
        rejected = true;
    }
    check(rejected, "configuration cannot accidentally make pickups purchasable");
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
            for (const auto* name :
                 {"manifest", "currencies", "match", "doors", "nests", "items", "manager", "repair", "map_items",
                  "cat_ai", "manager_ai", "map_generation", "characters", "random_items"}) {
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
    for (auto& profile : data["map_generation"]["profiles"]) {
        profile["width"] = profile["width"].asInt() + 4;
    }
    save();
    std::string error;
    check(store.reload(error) && error.empty(), "complete valid reload accepted");
    const auto after = store.current();
    check(before->version != after->version, "content edits change snapshot identity without manual version bump");
    auto newGame = claimed(after);
    check(newGame.map.width == oldGame.map.width + 4 && newGame.map.profileId == oldGame.map.profileId,
          "map table reload affects new matches without resizing an existing map");
    check(oldGame.income(oldGame.players[0]) == 6 && newGame.income(newGame.players[0]) == 9,
          "existing and new games retain independent config snapshots");
    check(oldGame.config().catAi.repairThreshold == .65 && newGame.config().catAi.repairThreshold == .5,
          "old AI keeps its configuration while new matches use updated strategy");
    check(oldGame.config().managerAi.outOfCombatDelay == before->managerAi.outOfCombatDelay &&
              newGame.config().managerAi.outOfCombatDelay == 8,
          "manager strategy is frozen per match and reloaded for new matches");
    {
        std::ofstream marker(filename / ".publishing.json");
        marker << "{}";
    }
    check(!store.reload(error) && store.current() == after,
          "incomplete publication retains the running server's last good snapshot");
    std::filesystem::remove(filename / ".publishing.json");
    check(store.reload(error), "completed publication resumes normal loading");
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
        rejects([](auto& data) { data["characters"][0]["skins"].append("orange"); }, "duplicate skin ID rejected");
        rejects([](auto& data) { data["characters"][0]["skins"] = Json::Value(Json::arrayValue); },
                "empty skin list rejected");
        rejects([](auto& data) { data["characters"].append(data["characters"][0]); },
                "duplicate character ID rejected");
        progressionAndMoney();
        extendedProgression();
        steelDoorProgression();
        newItemsAndLevels();
        fishRackProduction();
        uniqueFridgePurchases();
        randomItemPurchases();
        configuredRandomRewards();
        customMapProfiles();
        mapRulesAndInitialItems();
        pickupItemLevels();
        snapshots();
        std::cout << "PASS " << checks << " configuration/economy checks\n";
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n';
        return 1;
    }
}
