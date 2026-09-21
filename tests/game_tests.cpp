#include "battle/logic_combat.h"
#include "battle/logic_progression.h"
#include "common/game_math.h"
#include "game/game.h"
#include "item/logic_item.h"
#include "test_config.h"
#include <algorithm>
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
void characterSelection() {
    Game game("CATS", 6, 77, testConfig());
    check(game.players[0].character.skin != game.players[1].character.skin, "AI seats use catalog variants");
    game.addHuman("Host");
    game.addHuman("Friend");
    game.setReady(1, true);
    check(game.selectCharacter(1, {"cat_orange", "mint"}).empty(), "guest can choose own appearance");
    check(!game.players[1].ready && game.players[0].ready, "appearance change resets only guest readiness");
    check(!game.selectCharacter(2, {"cat_orange", "rose"}).empty(), "AI cannot issue selection commands");
    check(!game.selectCharacter(1, {"cat_orange", "missing"}).empty() && game.players[1].character.skin == "mint",
          "invalid appearance is rejected without changing selection");
    check(game.selectCharacter(0, {"cat_orange", "mint"}).empty(), "matching cosmetics are allowed");
    game.selectMap(0, "harbor_market");
    check(game.players[1].character.skin == "mint", "map changes preserve appearance");
    game.setReady(1, true);
    game.start(0);
    check(!game.selectCharacter(1, {"cat_orange", "rose"}).empty(), "appearance is locked after starting");
    game.setConnected(1, false);
    game.setConnected(1, true);
    check(game.players[1].character.skin == "mint", "reconnection preserves appearance");
    game.phase = "won";
    game.rematch(0);
    check(game.players[1].character.skin == "mint", "rematch preserves appearance");
    auto next = std::make_shared<GameConfig>(*testConfig());
    next->characters[0].skins = {"rose"};
    game.phase = "won";
    game.rematch(0, next);
    check(game.players[1].character.skin == "rose", "removed cosmetics fall back on next match");
}
void mapSelection() {
    Game game("CHOICE", 6, 77, testConfig(), "neon_alley");
    game.addHuman("Host");
    game.addHuman("Friend");
    check(game.map.profileId == "neon_alley" && game.map.theme == "neon_alley",
          "explicit selection binds geometry and art");
    const auto seed = game.map.seed;
    check(!game.selectMap(1, "harbor_market").empty() && game.map.seed == seed, "guest cannot change the map");
    game.setReady(1, true);
    check(game.selectMap(0, "harbor_market").empty(), "host changes map in lobby");
    check(game.map.profileId == "harbor_market" && game.map.width == 52 && !game.players[1].ready &&
              game.players[0].ready,
          "new geometry is authoritative and guests must ready again");
    check(!game.selectMap(0, "missing_map").empty() && game.map.profileId == "harbor_market",
          "invalid map leaves match intact");
    check(!game.start(0).empty(), "old readiness cannot start a changed map");
    game.setReady(1, true);
    check(game.start(0).empty() && !game.selectMap(0, "snack_street").empty(), "active matches cannot change map");
    game.phase = "won";
    check(game.rematch(0).empty() && game.selectedMap == "harbor_market" && game.map.profileId == "harbor_market",
          "rematch retains explicitly selected map and generates a new layout");
    auto next = std::make_shared<GameConfig>(*testConfig());
    for (auto& profile : next->mapGeneration.profiles) {
        if (profile.id == "harbor_market") {
            profile.weight = 0;
        }
    }
    game.phase = "won";
    check(game.rematch(0, next).empty() && game.selectedMap.empty() && game.map.profileId != "harbor_market",
          "a map disabled by reload falls back to the enabled random pool on rematch");
}
void generatedMaps() {
    std::set<std::string> layouts;
    std::set<std::string> profiles;
    std::set<std::size_t> roomCounts;
    for (std::uint32_t seed = 0; seed < 60; ++seed) {
        Game g("MAP", 1, seed, testConfig());
        Game same("MAP", 1, seed, testConfig());
        const auto& rules =
            *std::find_if(g.config().mapGeneration.profiles.begin(), g.config().mapGeneration.profiles.end(),
                          [&](const auto& profile) { return profile.id == g.map.profileId; });
        profiles.insert(g.map.profileId);
        check(g.map.width == rules.width && g.map.height == rules.height && g.map.theme == rules.theme,
              "selected backend profile owns dimensions and art theme");
        check(g.map.rows.size() == rules.height &&
                  std::all_of(g.map.rows.begin(), g.map.rows.end(),
                              [&](const auto& row) { return row.size() == rules.width; }),
              "terrain dimensions match the configured grid");
        check(g.dorms.size() >= rules.minRooms && g.dorms.size() <= rules.maxRooms, "configured room count range");
        check(g.map.cellAt({double(rules.width * TileSize), 0}) == -1 &&
                  g.map.cellAt({0, double(rules.height * TileSize)}) == -1 && !g.map.valid(g.map.cellCount()),
              "bounds use the active map size");
        for (int cell = 0; cell < g.map.cellCount(); ++cell) {
            check(g.map.cellAt(g.map.center(cell)) == cell, "grid/world coordinate round trip uses active width");
            for (int next : g.map.neighbors(cell)) {
                check(std::abs(next % g.map.width - cell % g.map.width) +
                              std::abs(next / g.map.width - cell / g.map.width) ==
                          1,
                      "neighbors never wrap between rows");
            }
        }
        check(g.map.rows == same.map.rows && g.dorms.size() == same.dorms.size(), "seed is deterministic");
        check(g.players.size() == Seats && g.dorms.size() >= 8 && g.dorms.size() <= MaxRooms,
              "six cats choose among the configured spare rooms");
        roomCounts.insert(g.dorms.size());
        const auto street = g.map.distances(g.map.spawn, [&](int cell) { return g.map.tile(cell) == '.'; });
        check(street[g.map.shopkeeperSpawn] >= 0, "shopkeeper home shares the connected public street");
        for (const auto& cat : g.players) {
            check(g.map.tile(g.map.cellAt(cat.position)) == '.', "all six cats spawn on the street after mirroring");
        }
        std::string layout;
        for (const auto& row : g.map.rows) {
            layout += row;
        }
        layouts.insert(layout);
        std::set<int> sizes;
        for (const auto& room : g.dorms) {
            check(room.floor.size() >= rules.minRoomArea && room.floor.size() <= rules.maxRoomArea,
                  "usable room area stays within its profile bounds");
            check(street[room.entrance] >= 0, "every door remains reachable without crossing another shop");
            check(room.props.size() >= 1 && room.props.size() <= 2, "one or two initial props besides nest");
            check(g.map.roomAt(room.nest) == room.id && !g.propAt(room.nest), "each shop has a dedicated nest");
            check(g.map.roomAt(room.door) == room.id &&
                      std::all_of(room.floor.begin(), room.floor.end(),
                                  [&](int cell) { return g.map.roomAt(cell) == room.id; }),
                  "all room floors and doors decode consistently, including rooms above ten");
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
    check(profiles.size() == testConfig()->mapGeneration.profiles.size(), "all enabled map profiles are exercised");
    check(roomCounts.size() > 3, "generation exercises the expanded room counts");
}
void extraRoomInteractions() {
    auto cfg = std::make_shared<GameConfig>(*testConfig());
    for (auto& profile : cfg->mapGeneration.profiles) {
        profile.minRooms = profile.maxRooms;
    }
    Game g("EXTRA", 1, 42, cfg, "autumn_market");
    g.addHuman("Captain");
    check(g.start(0).empty() && g.dorms.size() == MaxRooms, "largest map starts with sixteen rooms and six cats");
    for (auto& cat : g.players) {
        cat.decisionAt = 10000;
    }
    const int id = static_cast<int>(g.dorms.size()) - 1;
    auto& room = g.dorms[id];
    room.props.clear();
    check(id >= Seats && g.map.roomAt(room.nest) == id && g.map.roomAt(room.door) == id,
          "extra rooms decode floor and door IDs independently of player seats");
    settle(g, id);
    check(room.owner == 0 && room.doorClosed() && !g.walkable(room.door, 0, id),
          "extra rooms support authoritative ownership and door collision");
    g.players[0].wallet["cans"] = g.players[0].wallet["dried_fish"] = 10000;
    check(g.command(0, GameAction::UpgradeBarricade).empty(), "extra room door can upgrade");
    room.hp -= 150;
    const double damaged = room.hp;
    check(g.command(0, GameAction::Repair, id).empty() && room.hp > damaged, "extra room door can be repaired");
    g.phase = "running";
    g.monster.state = "attacking";
    g.monster.position = g.map.center(room.entrance);
    room.hp = 1;
    check(LogicCombat::hitDoor(g, id) && room.hp == 0 && g.isEscaping(g.players[0]),
          "manager can breach extra room doors and trigger escape-only state");
    check(!g.command(1, GameAction::EnterNest, static_cast<int>(g.dorms.size())).empty() &&
              !g.repairError(0, static_cast<int>(g.dorms.size())).empty() &&
              !LogicCombat::hitDoor(g, static_cast<int>(g.dorms.size())),
          "room actions reject IDs beyond the generated room count");
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
          "closed door blocks owner, outside cats and shopkeeper");
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
        const int cell = g.map.cellAt(p.position);
        check(!g.map.wall(cell) && cell != room.door && g.map.roomAt(cell) == room.id,
              "rapid retargeting stays inside room with a closed door");
        const auto* prop = g.propAt(cell);
        check(!prop || g.config().item(prop->kind).behavior != ItemBehavior::Obstacle,
              "movement never clips through fixed obstacles");
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
void joystickSteering() {
    auto g = solo();
    g.balance.preparation = 120;
    for (auto& cat : g.players) {
        cat.decisionAt = 1000;
    }
    auto& p = g.players[0];
    const int start = g.map.cellAt(p.position);
    const auto neighbors = g.map.neighbors(start);
    const auto next = std::find_if(neighbors.begin(), neighbors.end(),
                                   [&](int cell) { return g.map.tile(cell) == '.'; });
    check(next != neighbors.end(), "spawn has an open steering direction");
    const Point direction{double(*next % g.map.width - start % g.map.width),
                          double(*next / g.map.width - start / g.map.width)};
    check(g.command(0, GameAction::Steer, -1, -1, "", direction).empty(), "joystick direction accepted");
    advance(g, .2);
    check(GameMath::distance(p.position, g.map.center(start)) > 10 && p.path.empty(),
          "steering moves without grid pathfinding");
    check(g.command(0, GameAction::Steer, -1, -1, "", {}).empty(), "neutral joystick stops");
    const auto stopped = p.position;
    advance(g, .3);
    check(GameMath::distance(p.position, stopped) < .01, "release stops at the current position");

    int wallSide = -1;
    int roadSide = -1;
    for (int cell = 0; cell < g.map.cellCount() && roadSide < 0; ++cell) {
        if (g.map.tile(cell) != '.') continue;
        for (int neighbor : g.map.neighbors(cell)) {
            if (g.map.wall(neighbor)) {
                roadSide = cell;
                wallSide = neighbor;
                break;
            }
        }
    }
    check(roadSide >= 0, "map has a wall beside a street");
    p.position = g.map.center(roadSide);
    const Point intoWall{double(wallSide % g.map.width - roadSide % g.map.width),
                         double(wallSide / g.map.width - roadSide / g.map.width)};
    check(g.command(0, GameAction::Steer, -1, -1, "", intoWall).empty(), "wallward input accepted");
    advance(g, .4);
    check(g.map.cellAt(p.position) == roadSide, "joystick cannot cross a wall");
    check(g.command(0, GameAction::Steer, -1, -1, "", {}).empty(), "wallward input released");
}
void competingNestClaims() {
    // Click order, seat order and AI status do not reserve a nest.
    auto g = solo();
    g.balance.preparation = 120;
    for (auto& p : g.players) {
        p.decisionAt = 1000;
    }
    auto& room = g.dorms[0];
    room.props.clear();
    const auto center = g.map.center(room.nest);
    g.players[0].human = false;
    g.players[0].position = {center.x + 6, center.y};
    g.players[1].human = g.players[1].connected = true;
    g.players[1].position = {center.x + 2, center.y};
    g.players[2].position = g.map.center(room.entrance);
    check(g.command(0, GameAction::EnterNest, 0).empty(), "first cat starts approaching the nest");
    check(g.command(1, GameAction::EnterNest, 0).empty(), "another cat may contest the same nest");
    check(g.command(2, GameAction::Move, -1, room.nest).empty(), "nest intent does not block room entry");
    check(room.owner < 0 && !room.doorClosed() && g.income(g.players[0]) == 0,
          "intent neither owns, closes nor generates income");
    g.step(.05);
    check(room.owner == 1 && g.players[1].room == 0 && room.doorClosed(),
          "closer later seat wins within the same tick and immediately closes the door");
    check(g.players[0].room < 0 && g.players[0].nestIntent < 0 && g.players[0].path.empty(),
          "loser releases stale nest movement without becoming an owner");
    check(g.map.roomAt(g.map.cellAt(g.players[0].position)) == 0,
          "closure neither waits for nor teleports a guest inside");
    check(g.walkable(room.door, 0, 0) && !g.walkable(room.door, 0) && !g.walkable(room.door, 1, 0) &&
              !g.walkable(room.door, -1, 0),
          "closed door permits only an inside non-owner cat to leave");
    check(!g.command(1, GameAction::Move, -1, room.entrance).empty(), "owner cannot exit their closed door");
    g.players[0].human = g.players[0].connected = true;
    check(g.command(0, GameAction::Move, -1, room.entrance).empty(), "guest can open the door and exit");
    for (int i = 0; i < 300 && !g.players[0].path.empty(); ++i) {
        g.step(.05);
        check(room.doorClosed(), "guest exit never globally opens the door");
        check(!g.map.wall(g.map.cellAt(g.players[0].position)), "guest exits without crossing walls");
        check(g.map.roomAt(g.map.cellAt(g.players[2].position)) != room.id,
              "preplanned outside route cannot enter a now-closed room");
    }
    check(g.map.cellAt(g.players[0].position) == room.entrance && g.players[0].path.empty(),
          "guest physically reaches the street");
    check(!g.command(0, GameAction::Move, -1, room.nest).empty(), "departed guest cannot return inside");
    check(!g.command(0, GameAction::EnterNest, 0).empty(), "departed guest cannot steal the owned nest");
    check(g.players[0].room < 0 && g.income(g.players[0]) == 0 && g.income(g.players[1]) > 0,
          "only the actual owner earns nest income");
    check(g.command(0, GameAction::EnterNest, 1).empty(), "loser can choose a different room");
    advance(g, 10);
    check(g.players[0].room == 1 && room.owner == 1, "loser settles elsewhere without changing original ownership");

    auto cancel = solo();
    for (auto& p : cancel.players) {
        p.decisionAt = 1000;
    }
    check(cancel.command(0, GameAction::EnterNest, 0).empty(), "start a cancellable approach");
    check(cancel.command(0, GameAction::Move, -1, cancel.map.spawn).empty(), "retarget cancels nest intent");
    check(cancel.players[0].nestIntent < 0 && cancel.dorms[0].owner < 0, "cancelled movement leaves an unclaimed nest");
    cancel.players[1].position = cancel.map.center(cancel.dorms[0].nest);
    check(cancel.command(0, GameAction::EnterNest, 0).empty(), "an idle visitor does not block claiming a nest");
    advance(cancel, 10);
    check(cancel.dorms[0].owner == 0 && cancel.dorms[0].doorClosed() &&
              cancel.map.roomAt(cancel.map.cellAt(cancel.players[1].position)) == 0,
          "owner closes immediately with an idle visitor still inside");
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
    check(g.command(0, GameAction::Move, -1, built).empty(), "installed items allow movement onto their tile");
    p.wallet.at("cans") = 10000;
    check(!g.command(0, GameAction::Build, -1, room.nest).empty(), "cannot build over nest");
    check(!g.command(0, GameAction::Build, -1, room.door).empty(), "cannot build over door");
    check(!g.command(0, GameAction::Build, -1, g.dorms[1].nest).empty(), "cannot build in another shop");
    check(!g.command(0, GameAction::Build, -1, built, "pantry").empty(),
          "cannot replace occupied grid with different item");
    check(g.command(0, GameAction::Build, -1, built).empty(), "existing launcher can upgrade");
    // Even the floor immediately inside the only entrance can hold a passable item.
    for (int cell : g.map.neighbors(room.door)) {
        if (g.map.roomAt(cell) == room.id && cell != room.door && cell != room.nest && !g.propAt(cell)) {
            check(g.command(0, GameAction::Build, -1, cell).empty(), "doorway items do not seal the entrance");
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
void itemTraversal() {
    auto g = solo();
    for (auto& cat : g.players) {
        cat.decisionAt = 10000;
    }
    settle(g);
    auto& cat = g.players[0];
    auto& room = g.dorms[cat.room];
    room.props.clear();
    cat.wallet["cans"] = cat.wallet["dried_fish"] = 100000;
    auto cell = room.floor.begin();
    for (const auto& [id, item] : g.config().items) {
        if (!item.buildable) {
            continue;
        }
        while (*cell == room.nest) {
            ++cell;
        }
        cat.position = g.map.center(*cell);
        check(g.command(cat.id, GameAction::Build, -1, *cell, id).empty(),
              "items can be installed on a tile occupied by a cat");
        check(g.walkable(*cell, cat.id, room.id) && g.walkable(*cell, 1, room.id) && g.walkable(*cell),
              "every buildable item allows player, AI and manager traversal");
        ++cell;
    }
    cat.position = g.map.center(room.nest);
    for (int floor : room.floor) {
        if (floor != room.nest && !g.propAt(floor)) {
            check(g.command(cat.id, GameAction::Build, -1, floor, "pantry").empty(),
                  "all usable room tiles can hold items without reserving a corridor");
        }
    }
    check(room.props.size() + 1 == room.floor.size(), "fully furnished room only leaves the nest tile vacant");
    for (int floor : room.floor) {
        check(!g.pathTo(cat.position, floor, cat.id).empty(), "every tile remains reachable through installed items");
    }
    check(g.pathTo(cat.position, room.entrance, cat.id).empty(), "passable items cannot bypass the closed door");
    room.hp = 0;
    auto escape = g.pathTo(cat.position, room.entrance, cat.id);
    check(!escape.empty() && g.moveAlong(cat.position, escape, 10000, cat.id) &&
              g.map.cellAt(cat.position) == room.entrance,
          "cat can physically escape through a fully furnished room after breach");
    cat.position = g.map.center(room.nest);
    g.phase = "running";
    g.monster.state = "chasing";
    g.monster.position = g.map.center(room.entrance);
    g.monster.path = g.pathTo(g.monster.position, room.nest);
    check(!g.monster.path.empty() && g.moveAlong(g.monster.position, g.monster.path, 10000) &&
              LogicCombat::catchCat(g, cat.id),
          "manager traverses installed items and physically catches the cat");
    room.props.front().kind = "shelf";
    check(!g.walkable(room.props.front().cell, 1) && !g.walkable(room.props.front().cell),
          "fixed shelf terrain retains collision for cats and the manager");
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
    capture.monster.position = capture.map.center(room.entrance);
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
void breachEscapeOnly() {
    auto game = solo();
    for (auto& p : game.players) {
        p.decisionAt = 10000;
    }
    settle(game);
    auto& cat = game.players[0];
    auto& room = game.dorms[0];
    room.props.clear();
    cat.wallet["cans"] = cat.wallet["dried_fish"] = 10000;
    int installed = -1, empty = -1;
    for (int cell : room.floor) {
        if (game.command(0, GameAction::Build, -1, cell, "pantry").empty()) {
            installed = cell;
            break;
        }
    }
    for (int cell : room.floor) {
        if (cell != room.nest && cell != room.door && !game.propAt(cell)) {
            empty = cell;
            break;
        }
    }
    check(installed >= 0 && empty >= 0, "breach fixture has existing and empty build tiles");
    auto& friendRoom = game.dorms[1];
    friendRoom.owner = 1;
    friendRoom.hp = 100;
    game.players[1].room = 1;
    room.hp = 1;
    game.phase = "running";
    game.monster.state = "attacking";
    game.monster.position = game.map.center(room.entrance);
    const auto position = cat.position;
    check(LogicCombat::hitDoor(game, room.id) && game.isEscaping(cat) && !cat.sleeping && cat.nestIntent == -1 &&
              cat.path.empty(),
          "breach wakes the human without selecting an automatic escape route");
    const auto wallet = cat.wallet;
    for (auto action : {GameAction::EnterNest, GameAction::UpgradeNest, GameAction::UpgradeBarricade, GameAction::Build,
                        GameAction::Repair}) {
        check(!game.command(0, action, 1, empty, "pantry").empty() && cat.wallet == wallet,
              "escape-only state rejects non-movement commands without charging");
    }
    check(!game.command(0, GameAction::Build, -1, installed, "pantry").empty() && game.propAt(installed)->level == 1 &&
              cat.wallet == wallet,
          "existing items cannot upgrade after the owner's door breaks");
    check(!game.nestUpgradeError(0).empty() && !game.itemPurchaseError(0, game.config().item("pantry"), 1).empty() &&
              !game.repairError(0, 1).empty() && friendRoom.hp == 100,
          "offers also disable purchases and repairs to a friend's door");
    game.step(.05);
    check(cat.position.x == position.x && cat.position.y == position.y && cat.path.empty(),
          "connected human remains still until a movement command");
    check(game.command(0, GameAction::Move, -1, room.door).empty(), "broken door allows manual escape movement");
    game.step(.05);
    check(GameMath::distance(cat.position, position) > 0 && !cat.sleeping && cat.nestIntent == -1,
          "manual movement starts after breach and cannot return the cat to sleep");
    game.setConnected(0, false);
    game.setConnected(0, true);
    check(game.isEscaping(cat) && !game.command(0, GameAction::UpgradeNest).empty(),
          "reconnection preserves escape-only restrictions");
    game.phase = "won";
    check(game.rematch(0).empty() && !game.isEscaping(game.players[0]), "new matches reset escape state");
}
void enemyProgression() {
    // Fixed thresholds keep numerical boundary cases independent of live balance edits.
    auto rules = testConfig()->enemy;
    rules.levels[0].nextRage = 45;
    rules.levels[1].nextRage = 60;
    rules.timeRage = 1;
    rules.levels[0].maxHp = 650;
    rules.levels[1].maxHp = 810;
    rules.levels[2].maxHp = 970;
    Monster timed;
    timed.hp = timed.maxHp = rules.levels[0].maxHp;
    timed.hp = timed.maxHp / 2;
    for (int i = 0; i < 899; ++i) {
        LogicProgression::advanceTime(timed, .05, rules);
    }
    check(timed.level == 1 && timed.rage == 44, "natural rage respects whole seconds and threshold");
    check(LogicProgression::advanceTime(timed, .05, rules) == 1, "natural time reaches level two at 45 seconds");
    check(timed.level == 2 && timed.rage == 0 && timed.maxHp == 810 && timed.hp == 527.5,
          "level-up heals 25 percent of new max HP without rescaling existing HP");
    check(LogicProgression::grant(timed, 65, rules) == 1 && timed.level == 3 && timed.rage == 5,
          "level-up carries excess rage forward");
    Monster alternate;
    alternate.hp = alternate.maxHp = rules.levels[0].maxHp;
    for (int i = 0; i < 180; ++i) {
        LogicProgression::advanceTime(alternate, .25, rules);
    }
    check(alternate.level == 2 && alternate.rage == 0, "growth is independent of update subdivision");
    alternate.hp = 0;
    check(LogicProgression::grant(alternate, std::numeric_limits<int>::max(), rules) == 8,
          "large reward advances safely to level cap");
    check(alternate.level == 10 && alternate.rage == 0 && alternate.hp == 0 &&
              alternate.maxHp == rules.levels.back().maxHp,
          "capped leveling neither overflows nor revives defeated enemy");
    check(LogicProgression::grant(alternate, 100, rules) == 0, "max-level rage is bounded");
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
    LogicProgression::grant(full, 45, rules);
    check(full.hp == 810 && full.levelUps[0].healed == 160, "healing caps at max and records actual recovery");
    const auto eventCount = full.levelUps.size();
    check(LogicProgression::grant(full, 0, rules) == 0 && LogicProgression::grant(full, -1, rules) == 0 &&
              full.levelUps.size() == eventCount,
          "nonpositive rage cannot heal or emit upgrade events");
    auto waiting = solo();
    advance(waiting, 20);
    check(waiting.monster.level == 1 && waiting.monster.rage == 0, "preparation does not grant time rage");
}
void incomingHitRage() {
    auto setup = [](double multiplier, double healRatio = .25, int damage = 11) {
        auto cfg = std::make_shared<GameConfig>(*testConfig());
        cfg->enemy.timeRage = 1;
        cfg->enemy.levels[0].nextRage = 45;
        cfg->enemy.levels[1].nextRage = 60;
        cfg->enemy.levels[0].maxHp = 650;
        cfg->enemy.levels[1].maxHp = 810;
        cfg->enemy.levels[2].maxHp = 970;
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
        game.monster.position = game.map.center(room.nest);
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
    m.position = g.map.center(room.nest);
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
    monster.position = g.map.center(room.entrance);
    g.step(.05);
    check(monster.doorHits == 1 && monster.attackSequence == 1 && monster.rage == g.config().enemy.doorRage,
          "one valid door hit awards rage exactly once");
    check(room.hp == testConfig()->door(1).health - testConfig()->enemy.levels[0].doorDamage && g.players[0].alive,
          "door damage never damages or captures a cat behind intact door");
    check(monster.attackingPlayer == 0 && monster.state == "attacking", "attack indicator identifies door owner");
    const double started = monster.attackStartedAt;
    check(!LogicCombat::hitDoor(g, 0) && monster.doorHits == 1, "attack cooldown blocks duplicate hit and rage");
    advance(g, g.config().enemy.attackInterval / 2);
    check(monster.doorHits == 1 && monster.attackStartedAt == started, "active target survives cooldown snapshots");
    advance(g, g.config().enemy.attackInterval / 2);
    check(monster.doorHits == 2 && monster.attackSequence == 2, "next hit occurs at configured interval");
    monster.rage = g.config().enemy.levels[0].nextRage - g.config().enemy.doorRage;
    monster.rageRemainder = 0;
    monster.attackCooldown = 0;
    const double before = room.hp;
    g.step(.05);
    check(monster.level == 2 && monster.rage == 0 && monster.levelUps.size() == 1,
          "door rage can trigger a level-up and broadcast event");
    check(room.hp == before - testConfig()->enemy.levels[0].doorDamage,
          "current hit uses level before its rage reward");
    monster.attackCooldown = 0;
    monster.position = g.map.center(g.map.spawn);
    const int hits = monster.doorHits, xp = monster.rage;
    check(!LogicCombat::hitDoor(g, 0) && monster.doorHits == hits && monster.rage == xp,
          "remote or missed door attack awards nothing");
    g.step(.05);
    check(monster.attackingPlayer == -1, "walking between targets clears portrait feedback");
    monster.position = g.map.center(room.entrance);
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
        advance(g, g.balance.preparation + g.balance.duration + 1);
        check(g.phase == "won" || g.phase == "lost", "full round terminates");
        for (const auto& p : g.players) {
            check(p.wallet.at("cans") >= 0 && p.bed <= static_cast<int>(g.config().nests.size()) &&
                      !g.map.wall(g.map.cellAt(p.position)),
                  "full match player invariants");
        }
        for (const auto& room : g.dorms) {
            check(room.hp >= 0 && room.hp <= testConfig()->door(room.level).health, "door health bounds");
        }
    }
}
void presentationEvents() {
    auto g = solo();
    for (int id = 1; id < Seats; ++id) {
        g.players[id].alive = false;
    }
    settle(g);
    const auto has = [&](const char* type) {
        return std::any_of(g.events.begin(), g.events.end(),
                           [&](const auto& event) { return event.type == type && event.player == 0; });
    };
    check(has("door.close") && has("character.nest"), "arrival emits close and nest events after claiming");
    auto sequence = g.eventSequence;
    check(!g.command(0, GameAction::Move, -1, -1).empty() && g.eventSequence == sequence,
          "rejected movement cannot emit a wake sound");
    auto& room = g.dorms[g.players[0].room];
    const auto target = *std::find_if(room.floor.begin(), room.floor.end(), [&](int cell) {
        return cell != room.nest && !g.propAt(cell) && g.walkable(cell, 0, room.id);
    });
    check(g.command(0, GameAction::Move, -1, target).empty() && has("character.wake"),
          "accepted movement wakes the cat once");
    g.players[0].wallet["cans"] = 100000;
    g.players[0].wallet["dried_fish"] = 100000;
    check(g.command(0, GameAction::Build, room.id, target, "launcher").empty() && has("item.install"),
          "successful purchase emits installation");
    sequence = g.eventSequence;
    check(!g.command(0, GameAction::Build, room.id, target, "missing").empty() && g.eventSequence == sequence,
          "rejected purchase does not emit installation");
    g.monster.position = g.map.center(target);
    LogicItem::updateAttack(g, .1);
    check(has("item.fire"), "actual launcher shot emits a presentation event");
    g.phase = "running";
    g.monster.state = "hunting";
    g.monster.position = g.map.center(room.entrance);
    g.monster.attackCooldown = 0;
    room.props.clear();
    room.hp = 1;
    check(LogicCombat::hitDoor(g, room.id) && has("door.hit") && has("door.break"),
          "actual door hit and breach emit separate events");
    g.monster.position = g.players[0].position;
    check(LogicCombat::catchCat(g, 0) && has("character.caught"), "capture emits a cat interaction");
    sequence = g.eventSequence;
    check(!LogicCombat::catchCat(g, 0) && g.eventSequence == sequence,
          "capture cannot be replayed on an already captured cat");
    g.phase = "won";
    g.rematch(0);
    check(g.events.empty() && g.eventSequence == sequence, "rematch clears old events without reusing event IDs");
}
} // namespace
int main() {
    try {
        generatedMaps();
        mapSelection();
        characterSelection();
        extraRoomInteractions();
        movementAndOwnership();
        joystickSteering();
        competingNestClaims();
        gridBuilding();
        itemTraversal();
        rosterAndReconnect();
        daylightAndCapture();
        breachEscapeOnly();
        enemyProgression();
        incomingHitRage();
        doorCombatAndAttackTarget();
        fullMatches();
        presentationEvents();
        std::cout << "PASS " << checks << " checks\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << "\n";
        return 1;
    }
}
