#include "battle/logic_combat.h"
#include "battle/logic_progression.h"
#include "common/game_math.h"
#include "game/game.h"
#include "item/logic_item.h"
#include "test_config.h"
#include <cmath>
#include <iostream>
#include <limits>
#include <set>
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
void advance(Game& g, double seconds) {
    for (int i = 0; i < static_cast<int>(std::ceil(seconds / .05)); ++i) {
        g.step(.05);
    }
}
Game solo(std::uint32_t seed = 42) {
    Game g("TEST01", 1, seed, testConfig());
    g.addHuman("Captain");
    check(g.start(0).empty(), "solo start");
    return g;
}
void settle(Game& g, int room = 0) {
    check(g.command(0, GameAction::EnterNest, room).empty(), "nest click starts route");
    for (int i = 0; i < 400 && !g.players[0].sleeping; ++i) {
        g.step(.05);
    }
    check(g.players[0].sleeping && g.players[0].room == room, "physical arrival claims nest");
}
void generatedMaps() {
    std::set<std::string> layouts;
    for (std::uint32_t seed = 0; seed < 60; ++seed) {
        Game g("MAP", 1, seed, testConfig());
        Game same("MAP", 1, seed, testConfig());
        check(g.map.rows == same.map.rows, "seed is deterministic");
        std::string layout;
        for (const auto& row : g.map.rows) {
            layout += row;
        }
        layouts.insert(layout);
        std::set<int> sizes;
        for (const auto& room : g.dorms) {
            check(room.floor.size() >= 8, "room has meaningful usable area");
            check(room.props.size() >= 1 && room.props.size() <= 2, "one or two initial props besides nest");
            check(g.map.roomAt(room.nest) == room.id && !g.propAt(room.nest), "each shop has a dedicated nest");
            check(!room.doorClosed() && g.walkable(room.door), "unclaimed entrance is open to all actors");
            check(room.nest == same.dorms[room.id].nest && room.props.size() == same.dorms[room.id].props.size(),
                  "seed reproduces nest and prop count");
            for (std::size_t i = 0; i < room.props.size(); ++i) {
                check(room.props[i].cell == same.dorms[room.id].props[i].cell &&
                          room.props[i].kind == same.dorms[room.id].props[i].kind,
                      "seed reproduces prop positions and kinds");
            }
            check(!g.pathTo(g.players[0].position, room.nest, 0).empty(), "every nest reachable from street");
            check(g.map.tile(room.entrance) == '.', "entrance faces the street");
            int doors = 0;
            for (char c : layout) {
                if (c == 'a' + room.id) {
                    ++doors;
                }
            }
            check(doors == 1, "exactly one door per shop");
            sizes.insert(static_cast<int>(room.floor.size()));
            for (const auto& prop : room.props) {
                check(prop.cell != room.nest && g.map.roomAt(prop.cell) == room.id, "initial prop belongs to room");
            }
        }
        check(sizes.size() >= 3, "rooms have different sizes");
    }
    check(layouts.size() == 60, "different seeds create different layouts");
}
void movementAndOwnership() {
    auto g = solo();
    g.balance.preparation = 120;
    for (auto& cat : g.players) {
        cat.decisionAt = 1000;
    }
    auto& p = g.players[0];
    auto& room = g.dorms[0];
    room.props.clear();
    check(g.command(0, GameAction::Move, -1, room.nest).empty(), "free movement to nest tile");
    advance(g, 10);
    check(!p.sleeping && p.room < 0 && p.wallet.at("cans") == 120, "walking to nest never auto-claims or earns");
    check(!room.doorClosed(), "walking into room does not close the door");
    settle(g);
    check(room.doorClosed(), "arriving after nest interaction closes door");
    check(!g.walkable(room.door, 0, 0) && !g.walkable(room.door, 1) && !g.walkable(room.door),
          "closed door blocks owner, guests and shopkeeper");
    check(!g.command(1, GameAction::EnterNest, 0).empty(), "one owner per room");
    check(!g.command(0, GameAction::EnterNest, 1).empty(), "one room per player");
    const auto previous = p.position;
    check(!g.command(0, GameAction::Move, -1, -1).empty(), "invalid coordinate rejected");
    check(!g.command(0, GameAction::Move, -1, 0).empty(), "wall destination rejected");
    check(!g.command(0, GameAction::Move, -1, g.map.spawn).empty(), "owner cannot walk through closed door");
    check(!g.command(1, GameAction::Move, -1, room.nest).empty(), "guest cannot enter shop with a closed door");
    check(GameMath::distance(previous, p.position) == 0 && p.sleeping, "invalid move preserves position and rest");
    int target = -1;
    std::size_t farthest = 0;
    for (int cell : room.floor) {
        const auto route = g.pathTo(p.position, cell, 0);
        if (route.size() > farthest) {
            target = cell;
            farthest = route.size();
        }
    }
    const double rate = g.income(p);
    const int before = p.wallet.at("cans");
    check(rate == testConfig()->nest(1).amount && farthest > 1, "claimed nest produces base income");
    check(g.command(0, GameAction::Move, -1, target).empty(), "owner can roam inside shop with a closed door");
    check(!p.sleeping && g.income(p) == rate, "standing and movement preserve income");
    advance(g, 1);
    check(p.wallet.at("cans") == before + rate && GameMath::distance(previous, p.position) > 1,
          "cans accumulate while cat is physically walking");
    for (int i = 0; i < 220; ++i) {
        if (i % 11 == 0) {
            g.command(0, GameAction::Move, -1, i % 22 == 0 ? target : room.nest);
        }
        g.step(.05);
        const int cell = GridMap::cellAt(p.position);
        check(!g.map.wall(cell) && cell != room.door && g.map.roomAt(cell) == room.id,
              "rapid retargeting stays inside room with a closed door");
        const auto* prop = g.propAt(cell);
        check(!prop || prop->kind == "crate", "movement never clips through furniture");
    }
    settle(g);
    check(g.income(p) == rate, "returning to rest does not change income");
    check(g.command(0, GameAction::Move, -1, room.nest).empty(), "can stand up in place");
    advance(g, 1);
    check(!p.sleeping && g.income(p) == rate, "standing idle continues producing cans");
    room.hp = 0;
    check(!room.doorClosed() && g.walkable(room.door, 0) && g.walkable(room.door),
          "destroyed door reopens for cats and shopkeeper");
    check(g.command(0, GameAction::Move, -1, g.map.spawn).empty(), "owner can escape after breach");
    check(g.income(p) == rate, "breach does not revoke occupied nest income");
    p.alive = false;
    check(g.income(p) == 0, "captured cats stop producing");
}
void competingNestClaims() {
    auto g = solo();
    for (auto& p : g.players) {
        p.decisionAt = 1000;
    }
    const auto& room = g.dorms[0];
    // A route planned before reservation must not carry a guest into the closing shop.
    check(g.command(1, GameAction::Move, -1, room.nest).empty(), "guest preplans a room visit");
    check(g.command(0, GameAction::EnterNest, 0).empty(), "first cat reserves nest approach");
    check(!g.command(1, GameAction::EnterNest, 0).empty(), "simultaneous second nest claim rejected");
    check(g.players[0].room < 0 && !room.doorClosed() && g.income(g.players[0]) == 0,
          "reservation does not remotely close or produce income");
    advance(g, 10);
    check(room.owner == 0 && room.doorClosed(), "first arrival claims and closes door");
    check(g.map.roomAt(GridMap::cellAt(g.players[1].position)) != 0,
          "outdated guest route cannot pass reserved doorway");
    check(g.command(1, GameAction::EnterNest, 1).empty(), "losing cat can choose another nest");
    advance(g, 10);
    check(g.players[1].room == 1, "losing cat is not trapped");

    auto cancel = solo();
    for (auto& p : cancel.players) {
        p.decisionAt = 1000;
    }
    check(cancel.command(0, GameAction::EnterNest, 0).empty(), "reserve cancellable nest");
    check(cancel.command(0, GameAction::Move, -1, cancel.map.spawn).empty(), "retarget cancels reservation");
    check(cancel.command(1, GameAction::EnterNest, 0).empty(), "cancelled reservation releases nest");
    cancel.players[1].nestIntent = -1;
    cancel.players[1].path.clear();
    cancel.players[1].position = GridMap::center(cancel.dorms[0].nest);
    check(!cancel.command(0, GameAction::EnterNest, 0).empty(), "cannot lock a visiting cat inside");
}
void gridBuilding() {
    auto g = solo();
    settle(g);
    auto& p = g.players[0];
    auto& room = g.dorms[p.room];
    p.wallet.at("cans") = 170;
    check(!g.command(0, GameAction::UpgradeNest).empty() && p.wallet.at("cans") == 170 && p.bed == 1,
          "nest prerequisite rejects without charging");
    check(g.command(0, GameAction::UpgradeBarricade).empty() && room.level == 2, "door meets nest prerequisite");
    check(g.command(0, GameAction::UpgradeNest).empty() && p.wallet.at("cans") == 0 && p.bed == 2,
          "nest upgrade charges exact amount");
    check(!g.command(0, GameAction::UpgradeBarricade).empty(), "insufficient funds rejected");
    p.wallet.at("cans") = 55;
    int built = -1;
    for (int cell : room.floor) {
        if (!g.propAt(cell) && g.command(0, GameAction::Build, -1, cell).empty()) {
            built = cell;
            break;
        }
    }
    check(built >= 0 && p.wallet.at("cans") == 0, "place launcher on selected valid grid");
    check(g.propAt(built)->kind == "launcher", "placed item is at requested coordinate");
    check(!g.command(0, GameAction::Move, -1, built).empty(), "built furniture blocks movement");
    p.wallet.at("cans") = 10000;
    check(!g.command(0, GameAction::Build, -1, room.nest).empty(), "cannot build over nest");
    check(!g.command(0, GameAction::Build, -1, room.door).empty(), "cannot build over door");
    check(!g.command(0, GameAction::Build, -1, g.dorms[1].nest).empty(), "cannot build in another shop");
    check(!g.command(0, GameAction::Build, -1, built, "pantry").empty(),
          "cannot replace occupied grid with different item");
    check(g.command(0, GameAction::Build, -1, built).empty(), "existing launcher can upgrade");
    // The floor immediately inside a single door is a critical choke point.
    for (int cell : g.map.neighbors(room.door)) {
        if (g.map.tile(cell) == '0' + room.id && cell != room.nest && !g.propAt(cell)) {
            check(!g.command(0, GameAction::Build, -1, cell).empty(), "building cannot seal the only entrance");
        }
    }
    room.hp = 10;
    p.wallet.at("cans") = 100;
    check(g.command(0, GameAction::Repair, room.id).empty() && p.wallet.at("cans") == 55 && room.hp == 150,
          "repair debits and heals");
    check(!g.command(0, GameAction::Repair, room.id).empty(), "repair cooldown");
    p.wallet.at("cans") = 1000;
    const double beforeRate = g.income(p);
    int pantry = -1;
    for (int cell : room.floor) {
        if (!g.propAt(cell) && g.command(0, GameAction::Build, -1, cell, "pantry").empty()) {
            pantry = cell;
            break;
        }
    }
    check(pantry >= 0 && g.income(p) == beforeRate + testConfig()->item("pantry").levels[0].amount,
          "pantry adds passive income");
    check(g.command(0, GameAction::Move, -1, room.nest).empty(), "stand up beside upgraded nest");
    const int gold = p.wallet.at("cans");
    const double rate = g.income(p);
    advance(g, 1);
    check(!p.sleeping && p.wallet.at("cans") == gold + rate &&
              rate == beforeRate + testConfig()->item("pantry").levels[0].amount,
          "upgraded nest and pantry keep producing while awake");
}
void rosterAndReconnect() {
    Game g("ROOM", 6, 7, testConfig());
    g.addHuman("Host");
    check(!g.start(0).empty(), "multiplayer waits for one friend");
    g.addHuman("Friend");
    check(!g.start(0).empty(), "friend needs readiness");
    g.setReady(1, true);
    check(g.start(0).empty(), "two humans start multiplayer with four AI");
    check(g.addHuman("Late") == -1, "late join rejected");
    g.setConnected(0, false);
    advance(g, 4);
    check(g.players[0].room < 0, "disconnect grace");
    advance(g, 25);
    check(g.players[0].room >= 0 && g.players[0].sleeping, "AI takes over and physically reaches nest");
    const int room = g.players[0].room, gold = g.players[0].wallet.at("cans");
    g.setConnected(0, true);
    check(g.players[0].room == room && g.players[0].wallet.at("cans") == gold, "reconnect preserves state");
    const auto seed = g.map.seed;
    g.phase = "won";
    check(g.rematch(0).empty(), "rematch");
    check(g.map.seed != seed && g.players[0].room < 0 && g.players[0].wallet.at("cans") == 120,
          "rematch generates new map and resets resources");
    g.removeHuman(0);
    check(g.host == 1 && g.players[1].ready, "host transfers");
}
void daylightAndCapture() {
    auto g = solo();
    advance(g, 29);
    check(g.phase == "preparing" && g.players[0].room < 0, "30 second preparation does not auto-assign humans");
    advance(g, 1.1);
    check(g.phase == "running", "daylight transition");
    auto capture = solo();
    settle(capture);
    auto& room = capture.dorms[0];
    room.props.clear();
    room.hp = 1;
    capture.phase = "running";
    capture.elapsed = 31;
    capture.monster.position = GridMap::center(room.entrance);
    capture.monster.prey = 0;
    capture.monster.hp = 5000;
    capture.monster.maxHp = 5000;
    capture.step(.05);
    check(room.hp == 0 && !room.doorClosed() && capture.players[0].alive,
          "breaking the door opens it without remotely capturing the cat");
    check(capture.monster.attackingPlayer == -1, "breach stops the avatar attack indicator");
    check(capture.walkable(room.door), "shopkeeper can cross broken door");
    advance(capture, 12);
    check(!capture.players[0].alive, "shopkeeper enters room and captures cat physically");
    check(capture.income(capture.players[0]) == 0, "captured cat stops earning");
    check(!capture.command(0, GameAction::Move, -1, capture.map.spawn).empty(), "captured cats cannot move");
}
void enemyProgression() {
    Monster timed;
    timed.hp = timed.maxHp = testConfig()->enemy.levels[0].maxHp;
    timed.hp = timed.maxHp / 2;
    for (int i = 0; i < 899; ++i) {
        LogicProgression::advanceTime(timed, .05, testConfig()->enemy);
    }
    check(timed.level == 1 && timed.rage == 44, "natural rage respects whole seconds and threshold");
    check(LogicProgression::advanceTime(timed, .05, testConfig()->enemy) == 1,
          "natural time reaches level two at 45 seconds");
    check(timed.level == 2 && timed.rage == 0 && timed.maxHp == 810 && timed.hp == 527.5,
          "level-up heals 25 percent of new max HP without rescaling existing HP");
    check(LogicProgression::grant(timed, 65, testConfig()->enemy) == 1 && timed.level == 3 && timed.rage == 5,
          "level-up carries excess rage forward");
    Monster alternate;
    alternate.hp = alternate.maxHp = testConfig()->enemy.levels[0].maxHp;
    for (int i = 0; i < 180; ++i) {
        LogicProgression::advanceTime(alternate, .25, testConfig()->enemy);
    }
    check(alternate.level == 2 && alternate.rage == 0, "growth is independent of update subdivision");
    alternate.hp = 0;
    check(LogicProgression::grant(alternate, std::numeric_limits<int>::max(), testConfig()->enemy) == 8,
          "large reward advances safely to level cap");
    check(alternate.level == 10 && alternate.rage == 0 && alternate.hp == 0 &&
              alternate.maxHp == testConfig()->enemy.levels.back().maxHp,
          "capped leveling neither overflows nor revives defeated enemy");
    check(LogicProgression::grant(alternate, 100, testConfig()->enemy) == 0, "max-level rage is bounded");
    check(alternate.levelUps.size() == 9, "exactly one announcement event per gained level, including cap");
    for (std::size_t i = 0; i < alternate.levelUps.size(); ++i) {
        check(alternate.levelUps[i].level == static_cast<int>(i) + 2, "event order survives multi-level gains");
        if (i > 0) {
            check(alternate.levelUps[i].healed == 0, "defeated upgrades never advertise healing");
        }
    }
    check(timed.levelUps.size() == 2 && timed.levelUps[0].healed == 202.5 && timed.levelUps[1].healed == 242.5 &&
              timed.hp == 770,
          "every level heals independently against its own new maximum");
    Monster full;
    full.hp = full.maxHp = 650;
    LogicProgression::grant(full, 45, testConfig()->enemy);
    check(full.hp == 810 && full.levelUps[0].healed == 160, "healing caps at max and records actual recovery");
    const auto eventCount = full.levelUps.size();
    check(LogicProgression::grant(full, 0, testConfig()->enemy) == 0 &&
              LogicProgression::grant(full, -1, testConfig()->enemy) == 0 && full.levelUps.size() == eventCount,
          "nonpositive rage cannot heal or emit upgrade events");
    auto waiting = solo();
    advance(waiting, 20);
    check(waiting.monster.level == 1 && waiting.monster.rage == 0, "preparation does not grant time rage");
}
void incomingHitRage() {
    auto setup = [](double multiplier, double healRatio = .25, int damage = 11) {
        auto cfg = std::make_shared<GameConfig>(*testConfig());
        cfg->enemy.timeRage = 1;
        cfg->enemy.doorRage = 0;
        cfg->enemy.damageRageMultiplier = multiplier;
        cfg->enemy.levelUpHealRatio = healRatio;
        cfg->items.at("launcher").levels[0].amount = damage;
        Game game("HITS", 1, 42, cfg);
        game.addHuman("Test");
        game.start(0);
        game.phase = "running";
        game.elapsed = 40;
        auto& room = game.dorms[0];
        room.owner = 0;
        game.players[0].room = 0;
        room.props = {{room.nest, "launcher", 1}};
        game.monster.state = "hunting";
        game.monster.position = GridMap::center(room.nest);
        game.monster.hp = 100;
        return game;
    };
    auto g = setup(1);
    auto& room = g.dorms[0];
    auto& m = g.monster;
    m.rage = 34;
    LogicItem::updateAttack(g, .05);
    check(m.level == 2 && m.rage == 0 && m.hp == 291.5,
          "actual damage times multiplier grants rage before applying level healing");
    check(m.levelUps.size() == 1 && m.levelUps[0].level == 2 && m.levelUps[0].healed == 202.5,
          "damage-triggered upgrade emits one event and does not count healing as damage");
    LogicItem::updateAttack(g, .05);
    check(m.hp == 291.5 && m.rage == 0 && m.levelUps.size() == 1,
          "cooldown ticks cannot grant extra rage, healing or announcements");
    room.props[0].cooldown = 0;
    m.position = {-10000, -10000};
    LogicItem::updateAttack(g, .05);
    check(m.hp == 291.5 && m.rage == 0, "out-of-range attacks grant no rage");
    m.position = GridMap::center(room.nest);
    m.hp = 1;
    m.rage = 59;
    room.props.push_back({room.nest, "launcher", 1});
    LogicItem::updateAttack(g, .05);
    check(m.hp == 0 && m.level == 3 && m.rage == 0 && m.levelUps.size() == 2 && m.levelUps.back().healed == 0,
          "lethal hit counts only remaining HP, cannot revive, and blocks subsequent attacks");

    auto multiple = setup(10);
    LogicItem::updateAttack(multiple, .05);
    check(multiple.monster.level == 3 && multiple.monster.rage == 5 && multiple.monster.hp == 534 &&
              multiple.monster.levelUps.size() == 2,
          "one high-multiplier hit crosses thresholds without losing broadcasts or healing");
    auto healing = setup(5, .5);
    LogicItem::updateAttack(healing, .05);
    check(healing.monster.level == 2 && healing.monster.rage == 10 && healing.monster.hp == 494,
          "damage multiplier and upgrade healing both use configuration");
    auto noHealing = setup(5, 0);
    LogicItem::updateAttack(noHealing, .05);
    check(noHealing.monster.level == 2 && noHealing.monster.hp == 89 && noHealing.monster.levelUps.back().healed == 0,
          "zero recovery disables upgrade healing without rescaling HP");
    auto disabled = setup(0);
    LogicItem::updateAttack(disabled, .05);
    check(disabled.monster.level == 1 && disabled.monster.hp == 89 && disabled.monster.rage == 0 &&
              disabled.monster.levelUps.empty(),
          "zero damage multiplier preserves damage and disables damage rage");
    auto fractional = setup(.5);
    LogicItem::updateAttack(fractional, .05);
    check(fractional.monster.rage == 5 && fractional.monster.rageRemainder == .5, "fractional damage rage is retained");
    fractional.dorms[0].props[0].cooldown = 0;
    LogicItem::updateAttack(fractional, .05);
    check(fractional.monster.rage == 11 && fractional.monster.rageRemainder == 0,
          "repeated hits consume accumulated fractional rage");
    auto overkill = setup(.5, .25, 20);
    overkill.monster.hp = 3.5;
    LogicItem::updateAttack(overkill, .05);
    check(overkill.monster.hp == 0 && overkill.monster.rage == 1 && overkill.monster.rageRemainder == .75,
          "overkill rage uses actual fractional HP loss, not nominal weapon damage");
    auto tiny = setup(.1, 0, 1);
    for (int i = 0; i < 9; ++i) {
        tiny.dorms[0].props[0].cooldown = 0;
        LogicItem::updateAttack(tiny, .05);
    }
    check(tiny.monster.rage == 0 && std::abs(tiny.monster.rageRemainder - .9) < 1e-9,
          "sub-one rage hits accumulate without rounding each hit");
    LogicProgression::advanceTime(tiny.monster, .1, tiny.config().enemy);
    check(tiny.monster.rage == 1 && tiny.monster.rageRemainder == 0,
          "time and damage share the same fractional rage accumulator");
    auto crossing = setup(.1, 0);
    crossing.monster.rage = 44;
    crossing.monster.rageRemainder = .75;
    LogicItem::updateAttack(crossing, .05);
    check(crossing.monster.level == 2 && crossing.monster.rage == 0 &&
              std::abs(crossing.monster.rageRemainder - .85) < 1e-9,
          "fractional rage survives a level threshold");
    const double remainder = crossing.monster.rageRemainder;
    crossing.setConnected(0, false);
    crossing.setConnected(0, true);
    check(crossing.monster.rageRemainder == remainder, "reconnect preserves fractional rage");
    crossing.phase = "won";
    check(crossing.rematch(0).empty() && crossing.monster.rageRemainder == 0, "new match clears fractional rage");
    auto split = setup(.25, 0, 7);
    split.dorms[0].props.resize(4, split.dorms[0].props[0]);
    LogicItem::updateAttack(split, .05);
    auto single = setup(.25, 0, 28);
    LogicItem::updateAttack(single, .05);
    check(split.monster.hp == single.monster.hp && split.monster.rage == 7 &&
              split.monster.rage == single.monster.rage && split.monster.rageRemainder == single.monster.rageRemainder,
          "equal actual damage gives equal rage regardless of weapon hit count");
    Monster huge;
    check(LogicProgression::grant(huge, 10000000000.5, testConfig()->enemy) == 9 && huge.rage == 0 &&
              huge.rageRemainder == 0 && huge.hp == 0,
          "large damage rewards avoid integer overflow, clear cap remainder and cannot revive");
    Monster invalid;
    check(LogicProgression::grant(invalid, std::numeric_limits<double>::infinity(), testConfig()->enemy) == 0 &&
              LogicProgression::grant(invalid, std::numeric_limits<double>::quiet_NaN(), testConfig()->enemy) == 0 &&
              invalid.rageRemainder == 0,
          "nonfinite rage cannot corrupt progression");
}
void doorCombatAndAttackTarget() {
    auto g = solo();
    for (auto& cat : g.players) {
        cat.decisionAt = 10000;
    }
    settle(g);
    for (auto& room : g.dorms) {
        room.props.clear();
    }
    auto& room = g.dorms[0];
    auto& monster = g.monster;
    g.phase = "running";
    g.elapsed = 31;
    monster.state = "hunting";
    monster.prey = 0;
    monster.position = GridMap::center(room.entrance);
    g.step(.05);
    check(monster.doorHits == 1 && monster.attackSequence == 1 && monster.rage == 5,
          "one valid door hit awards rage exactly once");
    check(room.hp == testConfig()->door(1).health - testConfig()->enemy.levels[0].doorDamage && g.players[0].alive,
          "door damage never damages or captures a cat behind intact door");
    check(monster.attackingPlayer == 0 && monster.state == "attacking", "attack indicator identifies door owner");
    const double started = monster.attackStartedAt;
    check(!LogicCombat::hitDoor(g, 0) && monster.doorHits == 1, "attack cooldown blocks duplicate hit and rage");
    advance(g, .45);
    check(monster.doorHits == 1 && monster.attackStartedAt == started, "active target survives cooldown snapshots");
    advance(g, .45);
    check(monster.doorHits == 2 && monster.attackSequence == 2, "next hit occurs at configured interval");
    monster.rage = 40;
    monster.rageRemainder = 0;
    monster.attackCooldown = 0;
    const double before = room.hp;
    g.step(.05);
    check(monster.level == 2 && monster.rage == 0 && monster.levelUps.size() == 1,
          "door rage can trigger a level-up and broadcast event");
    check(room.hp == before - testConfig()->enemy.levels[0].doorDamage,
          "current hit uses level before its rage reward");
    monster.attackCooldown = 0;
    monster.position = GridMap::center(g.map.spawn);
    const int hits = monster.doorHits, xp = monster.rage;
    check(!LogicCombat::hitDoor(g, 0) && monster.doorHits == hits && monster.rage == xp,
          "remote or missed door attack awards nothing");
    g.step(.05);
    check(monster.attackingPlayer == -1, "walking between targets clears portrait feedback");
    monster.position = GridMap::center(room.entrance);
    monster.repathAt = 0;
    monster.attackCooldown = 0;
    room.hp = 1;
    g.step(.05);
    check(room.hp == 0 && g.players[0].alive && monster.attackingPlayer == -1 && monster.state == "chasing",
          "breach stops knocking, starts pursuit and leaves cat alive");
    check(!LogicCombat::hitDoor(g, 0), "destroyed door cannot grant another reward");
    const auto catPosition = g.players[0].position;
    const int level = monster.level;
    const auto sequence = monster.attackSequence;
    for (int step = 0; step < 200 && g.players[0].alive; ++step) {
        g.step(.05);
    }
    check(!g.players[0].alive && GameMath::distance(monster.position, catPosition) < testConfig()->enemy.captureRange,
          "capture requires walking to cat, without cat HP or attack stage");
    check(monster.attackSequence == sequence, "capture is not a second attack event");
    const int savedRage = monster.rage, savedHits = monster.doorHits;
    g.setConnected(0, false);
    g.setConnected(0, true);
    check(monster.level >= level && monster.rage == savedRage && monster.doorHits == savedHits && !g.players[0].alive,
          "reconnection preserves progression and captured state");
    g.phase = "won";
    check(g.rematch(0).empty(), "combat match can reset");
    check(g.monster.level == 1 && g.monster.rage == 0 && g.monster.doorHits == 0 && g.monster.attackingPlayer == -1 &&
              g.monster.levelUps.empty() && g.players[0].alive,
          "rematch resets growth, attack state and captured roster");
}
void fullMatches() {
    for (std::uint32_t seed = 0; seed < 6; ++seed) {
        auto g = solo(seed);
        g.setConnected(0, false);
        advance(g, 331);
        check(g.phase == "won" || g.phase == "lost", "full round terminates");
        for (const auto& p : g.players) {
            check(p.wallet.at("cans") >= 0 && p.bed <= static_cast<int>(g.config().nests.size()) &&
                      !g.map.wall(GridMap::cellAt(p.position)),
                  "full match player invariants");
        }
        for (const auto& room : g.dorms) {
            check(room.hp >= 0 && room.hp <= testConfig()->door(room.level).health, "door health bounds");
        }
    }
}
} // namespace
int main() {
    try {
        generatedMaps();
        movementAndOwnership();
        competingNestClaims();
        gridBuilding();
        rosterAndReconnect();
        daylightAndCapture();
        enemyProgression();
        incomingHitRage();
        doorCombatAndAttackTarget();
        fullMatches();
        std::cout << "PASS " << checks << " checks\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << "\n";
        return 1;
    }
}
