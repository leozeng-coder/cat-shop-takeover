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
    config->enemy.timeRage = 0;
    config->enemy.doorRage = 0;
    config->enemy.damageRageMultiplier = 0;
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
    p.position = game.map.center(game.dorms[room].nest);
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
    distance.monster.position = distance.map.center(distance.dorms[0].entrance);
    tick(distance);
    check(distance.monster.prey == 0, "manager prefers shorter reachable path, not straight-line distance");
    const auto until = distance.monster.targetHoldUntil;
    distance.monster.position = distance.map.center(distance.dorms[1].entrance);
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
void movingPreyChase() {
    auto config = rules();
    auto game = setup(config);
    for (auto& row : game.map.rows) {
        row.assign(game.map.width, '#');
    }
    const int left = 2, right = game.map.width - 3, top = 2, bottom = game.map.height - 3;
    for (int x = left; x <= right; ++x) {
        game.map.rows[top][x] = game.map.rows[bottom][x] = '.';
    }
    for (int y = top; y <= bottom; ++y) {
        game.map.rows[y][left] = game.map.rows[y][right] = '.';
    }
    auto& cat = game.players[0];
    cat.alive = true;
    cat.room = -1;
    cat.position = game.map.center(top * game.map.width + left + 3);
    game.monster.position = game.map.center(top * game.map.width + left);
    game.monster.level = 4;
    const std::array<int, 4> corners{top * game.map.width + right, bottom * game.map.width + right,
                                     bottom * game.map.width + left, top * game.map.width + left};
    std::size_t corner = 0;
    for (int frame = 0; frame < 160 && cat.alive; ++frame) {
        if (cat.path.empty()) {
            cat.path = game.pathTo(cat.position, corners[corner], cat.id);
            corner = (corner + 1) % corners.size();
        }
        game.moveAlong(cat.position, cat.path, config->catSpeed * .05, cat.id);
        tick(game);
        check(!game.map.wall(game.map.cellAt(game.monster.position)), "chasing respects the corridor walls");
    }
    check(!cat.alive, "level-four manager catches a moving cat despite frequent target cell changes");
}
void retreatAndDefeat() {
    auto config = rules();
    config->managerAi.outOfCombatHealing = 0;
    auto low = setup(config);
    occupy(low, 0, 0);
    auto& m = low.monster;
    m.hp = m.maxHp * .2;
    m.position = low.map.center(low.dorms[0].entrance);
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
    check(low.map.roomAt(low.map.cellAt(m.position)) < 0, "home is on the street");
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
    d.position = defeated.map.center(defeated.dorms[0].entrance);
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
void fridgeDoorDefense() {
    auto make = [](int level) {
        auto game = setup(rules());
        occupy(game, 0, 0);
        game.dorms[0].props.push_back({freeCell(game, 0), "mini_fridge", level});
        game.monster.position = game.map.center(game.dorms[0].entrance);
        game.monster.prey = 0;
        game.monster.targetDecisionAt = 1000;
        return game;
    };
    for (int level = 1; level <= 5; ++level) {
        auto game = make(level);
        auto& room = game.dorms[0];
        const double hp = room.hp;
        game.monster.attackCooldown = .5;
        check(!LogicCombat::hitDoor(game, 0), "fridge can trigger during an existing attack cooldown");
        const double delay = level * .2;
        check(std::abs(room.attackDelayUntil - game.elapsed - .5 - delay) < 1e-9 &&
                  room.doorDefenseReadyAt == game.elapsed + 2 && room.props[0].lastShot == game.elapsed,
              "configured fridge pulse extends this door's next attack and schedules 2 second cooldown");
        const double deadline = room.attackDelayUntil;
        game.monster.attackCooldown = 0;
        game.elapsed = deadline - .01;
        check(!LogicCombat::hitDoor(game, 0) && room.hp == hp && game.monster.doorHits == 0 &&
                  room.attackDelayUntil == deadline,
              "repeated ticks do not reapply the delay or damage the door early");
        game.elapsed = deadline;
        check(LogicCombat::hitDoor(game, 0) && game.monster.doorHits == 1 && room.attackDelayUntil == 0,
              "next attack resolves once at the delayed deadline");
        game.elapsed = 41.999;
        game.monster.attackCooldown = 1;
        LogicCombat::hitDoor(game, 0);
        check(room.props[0].lastShot == 40, "fridge cannot trigger again before 2 seconds");
        game.elapsed = 42;
        LogicCombat::hitDoor(game, 0);
        check(room.props[0].lastShot == 42 && room.doorDefenseReadyAt == 44,
              "fridge triggers again exactly at its configured frequency");
    }
    auto game = make(5);
    tick(game);
    auto& room = game.dorms[0];
    check(game.monster.attackingPlayer == 0 && game.monster.doorHits == 0,
          "manager behavior waits for fridge instead of bypassing delayed attack");
    const auto gate = room.doorDefenseReadyAt;
    game.players[0].wallet["cans"] = 10000;
    game.setConnected(0, false);
    game.setConnected(0, true);
    check(room.doorDefenseReadyAt == gate && room.attackDelayUntil > game.elapsed,
          "reconnect retains active delay and pulse cooldown");
    occupy(game, 1, 1);
    game.monster.prey = 1;
    game.monster.position = game.map.center(game.dorms[1].entrance);
    game.monster.attackCooldown = 0;
    tick(game);
    check(game.monster.attackingPlayer == 1 && game.monster.doorHits == 1 && game.dorms[1].attackDelayUntil == 0 &&
              room.attackDelayUntil == 0 && room.doorDefenseReadyAt == gate,
          "switching doors clears pending delay, preserves pulse cooldown and never slows another owner");

    auto upgraded = make(1);
    tick(upgraded);
    const double cooldown = upgraded.dorms[0].doorDefenseReadyAt;
    upgraded.players[0].wallet["cans"] = 10000;
    const int cell = upgraded.dorms[0].props[0].cell;
    check(upgraded.command(0, GameAction::UpgradeBarricade).empty(), "door meets fridge upgrade prerequisite");
    check(upgraded.command(0, GameAction::Build, -1, cell, "mini_fridge").empty(), "fridge upgrades during combat");
    check(upgraded.dorms[0].doorDefenseReadyAt == cooldown, "upgrading cannot bypass the two-second pulse cooldown");
    upgraded.monster.hp = 1;
    tick(upgraded);
    check(upgraded.monster.state == "retreating" && upgraded.dorms[0].attackDelayUntil == 0,
          "retreat clears a pending door delay");

    for (const auto* state : {"retreating", "defeated", "resting"}) {
        auto inactive = make(5);
        inactive.monster.state = state;
        check(!LogicCombat::hitDoor(inactive, 0) && inactive.dorms[0].doorDefenseReadyAt == 0,
              "inactive manager cannot trigger the fridge");
    }
    auto broken = make(5);
    broken.dorms[0].hp = 0;
    check(!LogicCombat::hitDoor(broken, 0) && broken.dorms[0].doorDefenseReadyAt == 0,
          "broken doors cannot receive fridge protection");
    auto distant = make(5);
    distant.monster.position = distant.map.center(distant.map.spawn);
    check(!LogicCombat::hitDoor(distant, 0) && distant.dorms[0].doorDefenseReadyAt == 0,
          "fridge cannot remotely delay a manager on the street");
    auto waiting = make(5);
    waiting.phase = "preparing";
    check(!LogicCombat::hitDoor(waiting, 0) && waiting.dorms[0].doorDefenseReadyAt == 0,
          "preparation does not consume defensive pulses");
    auto customRules = rules();
    auto& item = customRules->items.at("mini_fridge");
    item.id = "other_freezer";
    item.levels[0].amount = 350;
    item.levels[0].intervalMs = 1500;
    customRules->items.emplace(item.id, item);
    auto custom = setup(customRules);
    occupy(custom, 0, 0);
    custom.monster.position = custom.map.center(custom.dorms[0].entrance);
    custom.dorms[0].props.push_back({freeCell(custom, 0), "other_freezer", 1});
    LogicCombat::hitDoor(custom, 0);
    check(std::abs(custom.dorms[0].attackDelayUntil - custom.elapsed - .35) < 1e-9 &&
              custom.dorms[0].doorDefenseReadyAt == custom.elapsed + 1.5,
          "registered behavior uses configured amount and frequency without hardcoded fridge IDs");

    auto continuous = make(5);
    for (int i = 0; i < 100; ++i) {
        tick(continuous);
    }
    check(continuous.monster.doorHits >= 2 && continuous.monster.doorHits < 6,
          "continuous maximum-level pulses slow door attacks without permanently freezing them");
}
void outOfCombatRecovery() {
    auto config = rules();
    auto game = setup(config);
    auto& m = game.monster;
    m.hp = m.maxHp / 2;
    m.lastCombatAt = game.elapsed;
    const double before = m.hp;
    for (int i = 0; i < static_cast<int>(config->managerAi.outOfCombatDelay / .25); ++i) {
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
    m.position = game.map.center(weaponCell);
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
        movingPreyChase();
        retreatAndDefeat();
        outOfCombatRecovery();
        fridgeDoorDefense();
        std::cout << "PASS " << checks << " manager strategy/recovery checks\n";
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n';
        return 1;
    }
}
