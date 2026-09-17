#include "battle/logic_combat.h"
#include "battle/logic_enemy.h"
#include "game/game.h"
#include "item/logic_item.h"
#include "test_config.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <set>
#include <stdexcept>
using namespace snackshop;
namespace {
int checks = 0;
void check(bool value, const char* message) {
    ++checks;
    if (!value) {
        throw std::runtime_error(message);
    }
}
std::shared_ptr<GameConfig> rules() {
    auto config = std::make_shared<GameConfig>(*testConfig());
    config->enemy.timeExperience = 0;
    config->enemy.doorExperience = 0;
    config->managerAi.randomWeight = 0;
    return config;
}
Game setup(std::shared_ptr<const GameConfig> config, unsigned seed = 42) {
    Game game("MANAGER", 1, seed, std::move(config));
    game.addHuman("Test");
    game.start(0);
    game.phase = "running";
    game.elapsed = 40;
    game.monster.state = "hunting";
    for (auto& p : game.players) {
        p.alive = false;
        p.decisionAt = 10000;
    }
    for (auto& room : game.dorms) {
        room.props.clear();
    }
    return game;
}
void tick(Game& game, double dt = .05) {
    game.elapsed += dt;
    LogicEnemy::update(game, dt);
}
void occupy(Game& game, int id, int room) {
    auto& p = game.players[id];
    p.alive = true;
    p.room = room;
    p.sleeping = true;
    p.position = GridMap::center(game.dorms[room].nest);
    game.dorms[room].owner = id;
}
int freeCell(const Game& game, int room) {
    for (int cell : game.dorms[room].floor) {
        if (cell != game.dorms[room].nest && cell != game.dorms[room].door) {
            return cell;
        }
    }
    throw std::runtime_error("No fixture prop cell");
}
void weightedTargets() {
    auto config = rules();
    auto& ai = config->managerAi;
    ai.attackWeight = 1;
    ai.doorHealthWeight = ai.distanceWeight = 0;
    auto game = setup(config);
    occupy(game, 0, 0);
    occupy(game, 1, 1);
    game.dorms[0].props.push_back({freeCell(game, 0), "launcher"});
    tick(game);
    check(game.monster.prey == 1, "manager prefers fewer attack-type items");

    config = rules();
    config->managerAi.attackWeight = config->managerAi.distanceWeight = 0;
    config->managerAi.doorHealthWeight = 1;
    auto doors = setup(config);
    occupy(doors, 0, 0);
    occupy(doors, 1, 1);
    doors.dorms[0].hp = 290;
    doors.dorms[1].hp = 80;
    tick(doors);
    check(doors.monster.prey == 1, "manager prefers lower remaining door durability");

    config = rules();
    config->managerAi.attackWeight = config->managerAi.doorHealthWeight = 0;
    config->managerAi.distanceWeight = 1;
    auto distance = setup(config);
    occupy(distance, 0, 0);
    occupy(distance, 1, 1);
    distance.monster.position = GridMap::center(distance.dorms[0].entrance);
    tick(distance);
    check(distance.monster.prey == 0, "manager prefers shorter reachable path, not straight-line distance");
    const auto until = distance.monster.targetHoldUntil;
    distance.monster.position = GridMap::center(distance.dorms[1].entrance);
    distance.elapsed += config->managerAi.targetInterval;
    tick(distance);
    check(distance.monster.prey == 0 && distance.elapsed < until, "minimum target hold avoids oscillation");
    distance.players[0].alive = false;
    tick(distance);
    check(distance.monster.prey == 1, "dead target immediately overrides hold time");

    config = rules();
    config->managerAi.attackWeight = config->managerAi.doorHealthWeight = config->managerAi.distanceWeight = 0;
    config->managerAi.randomWeight = 10;
    std::set<int> selected;
    for (unsigned seed = 0; seed < 32; ++seed) {
        auto a = setup(config, seed), b = setup(config, seed);
        for (auto* match : {&a, &b}) {
            occupy(*match, 0, 0);
            occupy(*match, 1, 1);
            tick(*match);
        }
        selected.insert(a.monster.prey);
        check(a.monster.prey == b.monster.prey, "seeded randomness reproduces target decisions");
    }
    check(selected.size() == 2, "random targeting component actually varies equally weighted candidates");
}
void retreatAndDefeat() {
    auto config = rules();
    config->managerAi.outOfCombatHealing = 0;
    auto low = setup(config);
    occupy(low, 0, 0);
    auto& m = low.monster;
    m.hp = m.maxHp * .2;
    m.position = GridMap::center(low.dorms[0].entrance);
    m.attackingPlayer = 0;
    m.prey = 0;
    const auto wallet = low.players[0].wallet;
    const double doorHp = low.dorms[0].hp;
    tick(low);
    check(m.state == "retreating" && m.hp > 0 && m.prey == -1 && m.attackingPlayer == -1,
          "low HP interrupts combat and starts a voluntary retreat");
    check(low.players[0].wallet == wallet && low.dorms[0].hp == doorHp,
          "voluntary retreat neither rewards cats nor lands another door hit");
    m.hp = m.maxHp;
    tick(low);
    check(m.state == "retreating" && !m.path.empty(), "healing en route does not cancel committed return home");
    for (int i = 0; i < 1500 && m.state != "resting"; ++i) {
        tick(low);
    }
    check(m.state == "resting", "manager physically reaches home before resting");
    check(low.map.roomAt(GridMap::cellAt(m.position)) < 0, "home is on the street");
    m.hp = 0;
    const double restUntil = m.restUntil;
    tick(low);
    check(m.hp > 0 && m.state == "resting", "home recovery can revive the defeated manager");
    for (int i = 0; i < 500 && m.state == "resting"; ++i) {
        tick(low);
    }
    check(m.state == "hunting" && low.elapsed >= restUntil && m.hp >= m.maxHp * config->managerAi.resumeHealth,
          "manager resumes only after both minimum rest and health threshold");

    auto defeated = setup(config);
    occupy(defeated, 0, 0);
    auto& d = defeated.monster;
    d.position = GridMap::center(defeated.dorms[0].entrance);
    d.hp = 0;
    const int cans = defeated.players[0].wallet["cans"];
    tick(defeated);
    check(d.state == "defeated" && d.hp == 0 &&
              defeated.players[0].wallet["cans"] == cans + config->enemy.retreatReward[0].amount,
          "zero HP is a separate defeat state with one reward");
    for (int i = 0; i < 10; ++i) {
        tick(defeated);
    }
    check(d.state == "defeated" && d.hp == 0 &&
              defeated.players[0].wallet["cans"] == cans + config->enemy.retreatReward[0].amount,
          "defeat does not resurrect or grant rewards repeatedly during the escape");
    check(!LogicCombat::hitDoor(defeated, 0) && !LogicCombat::catchCat(defeated, 0),
          "defeated manager cannot attack or catch cats");
    for (int i = 0; i < 1500 && d.state != "resting"; ++i) {
        tick(defeated);
    }
    check(d.state == "resting", "defeated manager still moves home instead of teleporting");
}
void outOfCombatRecovery() {
    auto config = rules();
    auto game = setup(config);
    auto& m = game.monster;
    m.hp = m.maxHp / 2;
    m.lastCombatAt = game.elapsed;
    const double before = m.hp;
    for (int i = 0; i < 20; ++i) {
        tick(game, .25);
    }
    check(std::abs(m.hp - before) < 1e-6, "out-of-combat delay gives no early regeneration");
    for (int i = 0; i < 4; ++i) {
        tick(game, .25);
    }
    check(std::abs(m.hp - before - m.maxHp * config->managerAi.outOfCombatHealing) < 1e-6,
          "out-of-combat regeneration follows configured percent per second");
    occupy(game, 0, 0);
    const int weaponCell = freeCell(game, 0);
    game.dorms[0].props.push_back({weaponCell, "launcher"});
    m.position = GridMap::center(weaponCell);
    LogicItem::updateAttack(game, .05);
    check(m.lastCombatAt == game.elapsed, "an actual incoming hit resets combat time");
    game.dorms[0].props.clear();
    game.players[0].alive = false;
    const double damaged = m.hp;
    for (int i = 0; i < 16; ++i) {
        tick(game, .25);
    }
    check(std::abs(m.hp - damaged) < 1e-6, "new damage restarts the full regeneration delay");
    m.hp = m.maxHp - .1;
    m.lastCombatAt = game.elapsed - 100;
    tick(game, .25);
    check(m.hp == m.maxHp, "regeneration is capped at maximum health");
    game.phase = "won";
    game.step(.05);
    check(m.behavior.running < 0 && m.path.empty() && m.attackingPlayer < 0,
          "finished match stops manager behavior and attack feedback");
}
} // namespace
int main() {
    try {
        weightedTargets();
        retreatAndDefeat();
        outOfCombatRecovery();
        std::cout << "PASS " << checks << " manager strategy/recovery checks\n";
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n';
        return 1;
    }
}
