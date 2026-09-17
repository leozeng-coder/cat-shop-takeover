#include "battle/logic_combat.h"
#include "battle/logic_progression.h"
#include "common/game_math.h"
#include "game/game.h"
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
    Game g("TEST01", 1, seed);
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
        Game g("MAP", 1, seed);
        Game same("MAP", 1, seed);
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
    check(!p.sleeping && p.room < 0 && p.gold == 120, "walking to nest never auto-claims or earns");
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
    const int rate = g.income(p), before = p.gold;
    check(rate == BedIncome[0] && farthest > 1, "claimed nest produces base income");
    check(g.command(0, GameAction::Move, -1, target).empty(), "owner can roam inside shop with a closed door");
    check(!p.sleeping && g.income(p) == rate, "standing and movement preserve income");
    advance(g, 1);
    check(p.gold == before + rate && GameMath::distance(previous, p.position) > 1,
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
        check(!prop || prop->kind == PropKind::Crate, "movement never clips through furniture");
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
    p.gold = 80;
    check(g.command(0, GameAction::UpgradeNest).empty() && p.gold == 0 && p.bed == 2,
          "nest upgrade charges exact amount");
    check(!g.command(0, GameAction::UpgradeBarricade).empty(), "insufficient funds rejected");
    p.gold = 55;
    int built = -1;
    for (int cell : room.floor) {
        if (!g.propAt(cell) && g.command(0, GameAction::Build, -1, cell).empty()) {
            built = cell;
            break;
        }
    }
    check(built >= 0 && p.gold == 0, "place launcher on selected valid grid");
    check(g.propAt(built)->kind == PropKind::Launcher, "placed item is at requested coordinate");
    check(!g.command(0, GameAction::Move, -1, built).empty(), "built furniture blocks movement");
    p.gold = 10000;
    check(!g.command(0, GameAction::Build, -1, room.nest).empty(), "cannot build over nest");
    check(!g.command(0, GameAction::Build, -1, room.door).empty(), "cannot build over door");
    check(!g.command(0, GameAction::Build, -1, g.dorms[1].nest).empty(), "cannot build in another shop");
    check(!g.command(0, GameAction::Build, -1, built, PropKind::Pantry).empty(),
          "cannot replace occupied grid with different item");
    check(g.command(0, GameAction::Build, -1, built).empty(), "existing launcher can upgrade");
    // The floor immediately inside a single door is a critical choke point.
    for (int cell : g.map.neighbors(room.door)) {
        if (g.map.tile(cell) == '0' + room.id && cell != room.nest && !g.propAt(cell)) {
            check(!g.command(0, GameAction::Build, -1, cell).empty(), "building cannot seal the only entrance");
        }
    }
    room.hp = 10;
    p.gold = 100;
    check(g.command(0, GameAction::Repair, room.id).empty() && p.gold == 55 && room.hp == 150,
          "repair debits and heals");
    check(!g.command(0, GameAction::Repair, room.id).empty(), "repair cooldown");
    p.gold = 1000;
    const int beforeRate = g.income(p);
    int pantry = -1;
    for (int cell : room.floor) {
        if (!g.propAt(cell) && g.command(0, GameAction::Build, -1, cell, PropKind::Pantry).empty()) {
            pantry = cell;
            break;
        }
    }
    check(pantry >= 0 && g.income(p) == beforeRate + PantryIncome[0], "pantry adds passive income");
    check(g.command(0, GameAction::Move, -1, room.nest).empty(), "stand up beside upgraded nest");
    const int gold = p.gold, rate = g.income(p);
    advance(g, 1);
    check(!p.sleeping && p.gold == gold + rate && rate == beforeRate + PantryIncome[0],
          "upgraded nest and pantry keep producing while awake");
}
void rosterAndReconnect() {
    Game g("ROOM", 6, 7);
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
    const int room = g.players[0].room, gold = g.players[0].gold;
    g.setConnected(0, true);
    check(g.players[0].room == room && g.players[0].gold == gold, "reconnect preserves state");
    const auto seed = g.map.seed;
    g.phase = "won";
    check(g.rematch(0).empty(), "rematch");
    check(g.map.seed != seed && g.players[0].room < 0 && g.players[0].gold == 120,
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
    timed.hp = timed.maxHp / 2;
    for (int i = 0; i < 899; ++i) {
        LogicProgression::advanceTime(timed, .05);
    }
    check(timed.level == 1 && timed.experience == 44, "natural XP respects whole seconds and threshold");
    check(LogicProgression::advanceTime(timed, .05) == 1, "natural time reaches level two at 45 seconds");
    check(timed.level == 2 && timed.experience == 0 && timed.maxHp == 810 && timed.hp == 405,
          "level-up uses configured stats and preserves health percentage");
    check(LogicProgression::grant(timed, 65) == 1 && timed.level == 3 && timed.experience == 5,
          "level-up carries excess experience forward");
    Monster alternate;
    for (int i = 0; i < 180; ++i) {
        LogicProgression::advanceTime(alternate, .25);
    }
    check(alternate.level == 2 && alternate.experience == 0, "growth is independent of update subdivision");
    alternate.hp = 0;
    check(LogicProgression::grant(alternate, std::numeric_limits<int>::max()) == 8,
          "large reward advances safely to level cap");
    check(alternate.level == 10 && alternate.experience == 0 && alternate.hp == 0 &&
              alternate.maxHp == EnemyLevels.back().maxHp,
          "capped leveling neither overflows nor revives defeated enemy");
    check(LogicProgression::grant(alternate, 100) == 0, "max-level XP is bounded");
    auto waiting = solo();
    advance(waiting, 20);
    check(waiting.monster.level == 1 && waiting.monster.experience == 0, "preparation does not grant time XP");
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
    check(monster.doorHits == 1 && monster.attackSequence == 1 && monster.experience == 5,
          "one valid door hit awards XP exactly once");
    check(room.hp == DoorHealth[0] - EnemyLevels[0].doorDamage && g.players[0].alive,
          "door damage never damages or captures a cat behind intact door");
    check(monster.attackingPlayer == 0 && monster.state == "attacking", "attack indicator identifies door owner");
    const double started = monster.attackStartedAt;
    check(!LogicCombat::hitDoor(g, 0) && monster.doorHits == 1, "attack cooldown blocks duplicate hit and XP");
    advance(g, .45);
    check(monster.doorHits == 1 && monster.attackStartedAt == started, "active target survives cooldown snapshots");
    advance(g, .45);
    check(monster.doorHits == 2 && monster.attackSequence == 2, "next hit occurs at configured interval");
    monster.experience = 40;
    monster.experienceRemainder = 0;
    monster.attackCooldown = 0;
    const double before = room.hp;
    g.step(.05);
    check(monster.level == 2 && monster.experience == 0, "door experience can trigger a level-up");
    check(room.hp == before - EnemyLevels[0].doorDamage, "current hit uses level before its XP reward");
    monster.attackCooldown = 0;
    monster.position = GridMap::center(g.map.spawn);
    const int hits = monster.doorHits, xp = monster.experience;
    check(!LogicCombat::hitDoor(g, 0) && monster.doorHits == hits && monster.experience == xp,
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
    check(!g.players[0].alive && GameMath::distance(monster.position, catPosition) < EnemyAttackRange,
          "capture requires walking to cat, without cat HP or attack stage");
    check(monster.attackSequence == sequence, "capture is not a second attack event");
    const int savedExperience = monster.experience, savedHits = monster.doorHits;
    g.setConnected(0, false);
    g.setConnected(0, true);
    check(monster.level >= level && monster.experience == savedExperience && monster.doorHits == savedHits &&
              !g.players[0].alive,
          "reconnection preserves progression and captured state");
    g.phase = "won";
    check(g.rematch(0).empty(), "combat match can reset");
    check(g.monster.level == 1 && g.monster.experience == 0 && g.monster.doorHits == 0 &&
              g.monster.attackingPlayer == -1 && g.players[0].alive,
          "rematch resets growth, attack state and captured roster");
}
void fullMatches() {
    for (std::uint32_t seed = 0; seed < 6; ++seed) {
        auto g = solo(seed);
        g.setConnected(0, false);
        advance(g, 331);
        check(g.phase == "won" || g.phase == "lost", "full round terminates");
        for (const auto& p : g.players) {
            check(p.gold >= 0 && p.bed <= 3 && !g.map.wall(GridMap::cellAt(p.position)),
                  "full match player invariants");
        }
        for (const auto& room : g.dorms) {
            check(room.hp >= 0 && room.hp <= DoorHealth[room.level - 1], "door health bounds");
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
        doorCombatAndAttackTarget();
        fullMatches();
        std::cout << "PASS " << checks << " checks\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << "\n";
        return 1;
    }
}
