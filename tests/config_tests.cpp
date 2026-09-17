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
    for (const auto* name :
         {"currencies", "match", "doors", "nests", "items", "manager", "repair", "cat_ai", "manager_ai"}) {
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
    for (const auto* name :
         {"currencies", "match", "doors", "nests", "items", "manager", "repair", "cat_ai", "manager_ai"}) {
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
int build(Game& game, const std::string& item) {
    for (int cell : game.dorms[0].floor) {
        if (!game.propAt(cell) && game.command(0, GameAction::Build, -1, cell, item).empty()) {
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
    rejects([](auto& d) { d["schema_version"] = 2; }, "unsupported schema rejected");
    rejects([](auto& d) { d["extra"] = 1; }, "unknown fields rejected");
    rejects([](auto& d) { d["currencies"].append(d["currencies"][0]); }, "duplicate currencies rejected");
    rejects([](auto& d) { d["currencies"][0]["initial"] = -1; }, "negative wallet rejected");
    rejects([](auto& d) { d["doors"][1]["health"] = 0; }, "zero door health rejected");
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
    rejects([](auto& d) { d["initial_items"][0] = "missing"; }, "invalid spawn item rejected");
    rejects([](auto& d) { d["pickup_item"] = "launcher"; }, "pickup behavior checked");
    rejects([](auto& d) { d["manager"]["levels"][9]["next_experience"] = 100; }, "max-level XP terminates");
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
    check(!game.command(0, GameAction::UpgradeNest).empty(), "max nest guarded");
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
    auto newDoor = data["doors"][2];
    newDoor["id"] = "iron_2";
    newDoor["stage"] = 4;
    newDoor["display_level"] = 2;
    newDoor["health"] = 1400;
    data["doors"][2]["next_stage"] = 4;
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
    for (int i = 0; i < 3; ++i) {
        check(game.command(0, GameAction::UpgradeBarricade).empty(), "extended door stage reachable");
    }
    check(game.dorms[0].level == 4 && game.config().door(4).displayName() == "铁门 2级",
          "level cap follows configuration");
    auto attack = data["items"][0];
    attack["id"] = "heavy_launcher";
    attack["levels"][0]["amount"] = 77;
    attack["levels"][0]["range"] = 1000;
    data["items"].append(attack);
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
    check(battle.dorms[0].hp == 102, "utility dispatch restores configured durability");
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
            const int cans = p.wallet["cans"];
            check(game.command(0, GameAction::Build, -1, cell, rack.id).empty() &&
                      p.wallet["cans"] == cans - level.cost.front().amount,
                  "rack upgrades use the regular build command and configured price");
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
                                     "map_items", "cat_ai", "manager_ai"}) {
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
    check(oldGame.config().managerAi.outOfCombatDelay == 5 && newGame.config().managerAi.outOfCombatDelay == 8,
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
        newItemsAndLevels();
        fishRackProduction();
        snapshots();
        std::cout << "PASS " << checks << " configuration/economy checks\n";
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n';
        return 1;
    }
}
