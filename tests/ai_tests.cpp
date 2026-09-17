#include "ai/behavior_tree.h"
#include "ai/logic_cat_ai.h"
#include "battle/logic_combat.h"
#include "common/game_math.h"
#include "game/game.h"
#include "test_config.h"
#include <algorithm>
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
void advance(Game& game, int ticks) {
    for (int i = 0; i < ticks; ++i) {
        game.step(.05);
    }
}
Game setup(bool home = true, std::shared_ptr<const GameConfig> config = testConfig()) {
    Game game("AI", 1, 42, std::move(config));
    game.addHuman("Test");
    game.start(0);
    game.elapsed = 5;
    game.balance.preparation = 1000;
    for (auto& p : game.players) {
        p.decisionAt = 10000;
    }
    auto& p = game.players[0];
    p.human = false;
    p.decisionAt = 0;
    if (home) {
        p.room = 0;
        p.sleeping = true;
        p.bed = 3;
        p.wallet["cans"] = 2000;
        auto& room = game.dorms[0];
        room.owner = 0;
        room.props.clear();
        room.level = 3;
        room.hp = 950;
        p.position = GridMap::center(room.nest);
    }
    return game;
}
void tick(Game& game) {
    game.players[0].decisionAt = 0;
    LogicCatAi::update(game, game.players[0]);
}
void treeSemantics() {
    struct Context {
        bool emergency = false, allow = true;
        int progress = 0, stops = 0;
        std::vector<int> order;
    };
    bt::Builder<Context> b;
    const int urgent = b.sequence("urgent", {b.condition("emergency", [](Context& c) { return c.emergency; }),
                                             b.action("urgent_action", [](Context& c) {
                                                 c.order.push_back(2);
                                                 return bt::Status::Success;
                                             })});
    const int work = b.sequence(
        "work", {b.condition("allowed", [](Context& c) { return c.allow; }), b.action(
                                                                                 "long_action",
                                                                                 [](Context& c) {
                                                                                     ++c.progress;
                                                                                     return bt::Status::Running;
                                                                                 },
                                                                                 [](Context& c) {
                                                                                     ++c.stops;
                                                                                     c.order.push_back(1);
                                                                                 })});
    const int root = b.selector("root", {urgent, work});
    const auto tree = std::move(b).finish(root);
    Context first, second;
    bt::Runtime a, z;
    check(tree.tick(first, a) == bt::Status::Running && tree.tick(first, a) == bt::Status::Running &&
              first.progress == 2 && first.stops == 0,
          "running action continues without a restart");
    tree.tick(second, z);
    first.emergency = true;
    check(tree.tick(first, a) == bt::Status::Success && first.order == std::vector<int>({1, 2}),
          "reactive priority halts old movement before executing emergency action");
    check(second.progress == 1 && second.stops == 0 && z.running >= 0,
          "shared definition does not share per-actor progress");
    second.allow = false;
    check(tree.tick(second, z) == bt::Status::Failure && second.stops == 1 && z.running < 0,
          "failed running condition aborts the previous task");
    tree.halt(second, z);
    check(second.stops == 1, "halt is idempotent");

    bt::Builder<Context> fallback;
    const int fail = fallback.action("failure", [](Context&) { return bt::Status::Failure; });
    const int success = fallback.action("success", [](Context&) { return bt::Status::Success; });
    const int selector = fallback.selector("fallback", {fail, success});
    const auto fallbackTree = std::move(fallback).finish(selector);
    bt::Runtime r;
    check(fallbackTree.tick(first, r) == bt::Status::Success && fallbackTree.lastAction(r) == "success",
          "selector tries next branch on failure");
}
void movingAndInterrupts() {
    auto game = setup(false);
    auto& p = game.players[0];
    tick(game);
    check(p.ai.tree.result == bt::Status::Running && p.ai.ownsMovement && p.room < 0 && p.nestIntent >= 0,
          "enter-nest action remains running until physical arrival");
    const auto destination = p.ai.targetCell;
    const double deadline = p.ai.moveDeadline;
    advance(game, 8);
    tick(game);
    check(p.ai.targetCell == destination && p.ai.moveDeadline == deadline,
          "running nest task keeps its target and deadline instead of repathing");
    for (int i = 0; i < 400 && p.room < 0; ++i) {
        game.step(.05);
    }
    check(p.room >= 0 && p.sleeping && game.dorms[p.room].doorClosed(), "AI follows normal claim and close-door rules");

    auto attacked = setup();
    auto& cat = attacked.players[0];
    attacked.dorms[0].level = 1;
    attacked.dorms[0].hp = 100;
    cat.wallet["cans"] = 45;
    cat.ai.active = true;
    cat.decisionAt = 1000;
    attacked.phase = "running";
    attacked.monster.state = "attacking";
    attacked.monster.target = 0;
    attacked.monster.prey = 0;
    attacked.monster.position = GridMap::center(attacked.dorms[0].entrance);
    LogicCatAi::update(attacked, cat);
    check(attacked.dorms[0].hp == 240 && cat.wallet["cans"] == 0 && LogicCatAi::currentAction(cat) == "repair_door",
          "new threat bypasses normal decision delay and uses authoritative repair");
    attacked.phase = "preparing";
    cat.sleeping = false;
    tick(attacked);
    check(LogicCatAi::currentAction(cat) == "return_to_nest" && cat.ai.ownsMovement,
          "ordinary return-to-nest task is running before the breach");
    attacked.phase = "running";
    attacked.dorms[0].hp = 0;
    cat.decisionAt = 1000;
    LogicCatAi::update(attacked, cat);
    check(LogicCatAi::currentAction(cat) == "evade" && cat.ai.tree.result == bt::Status::Running &&
              cat.nestIntent == -1 && !cat.path.empty(),
          "door breach interrupts normal work and issues a real escape movement");
    for (const auto& point : cat.path) {
        check(attacked.walkable(GridMap::cellAt(point), cat.id), "escape never traverses walls or closed doors");
    }
    check(attacked.dorms[0].hp == 0, "escape does not restore a broken door");
}
void invalidTargetAndTimeout() {
    auto game = setup(false);
    auto& cat = game.players[0];
    tick(game);
    const int old = cat.ai.targetRoom;
    game.dorms[old].owner = 1;
    game.players[1].room = old;
    game.players[1].position = GridMap::center(game.dorms[old].nest);
    tick(game);
    check(cat.ai.targetRoom != old && cat.nestIntent != old, "stale occupied target releases its reservation");
    cat.ai.moveDeadline = game.elapsed - 1;
    tick(game);
    check(cat.ai.moveDeadline > game.elapsed || cat.ai.tree.result == bt::Status::Failure,
          "expired movement retries or fails without remaining stuck");

    auto blocked = setup(false);
    for (int i = 0; i < Seats; ++i) {
        blocked.dorms[i].owner = i;
    }
    tick(blocked);
    check(blocked.players[0].path.empty() && blocked.players[0].nestIntent == -1 &&
              blocked.players[0].ai.tree.result != bt::Status::Running,
          "no available nest falls back without retaining a fake running action");
}
void economyAndLimits() {
    auto game = setup();
    auto& cat = game.players[0];
    for (int i = 0; i < 30; ++i) {
        tick(game);
    }
    bool cans = false, fish = false, repair = false;
    int attacks = 0, fridges = 0;
    for (const auto& prop : game.dorms[0].props) {
        const auto& item = game.config().item(prop.kind);
        cans |= item.behavior == ItemBehavior::CurrencyProducer && item.currency == "cans";
        fish |= item.behavior == ItemBehavior::CurrencyProducer && item.currency == "dried_fish";
        repair |= item.behavior == ItemBehavior::DoorRepair;
        attacks += item.behavior == ItemBehavior::SingleAttack;
        fridges += item.behavior == ItemBehavior::DoorAttackDelay;
    }
    check(fridges == 1, "AI installs exactly one configured door-defense item");
    check(cans && fish && repair && attacks > 0,
          "AI builds both currency producers, defense and utility through behavior types");
    check(attacks <= game.config().catAi.profiles[cat.personality].attackCount, "profile caps attack construction");
    check(game.income(cat, "dried_fish") > 0, "AI fish production joins the ordinary economy");
    check(cat.wallet["cans"] >= game.config().catAi.profiles[cat.personality].reserve.front().amount,
          "discretionary building and prop upgrades preserve emergency funds");

    auto poor = setup();
    poor.players[0].wallet["cans"] = 0;
    tick(poor);
    check(poor.dorms[0].props.empty() && poor.players[0].wallet["cans"] == 0, "no budget means no free structures");
    auto prereq = setup();
    prereq.players[0].bed = 1;
    prereq.dorms[0].level = 1;
    prereq.dorms[0].hp = 300;
    tick(prereq); // First weapon.
    tick(prereq); // Door prerequisite.
    check(prereq.dorms[0].level == 2 && prereq.players[0].bed == 1, "AI upgrades door prerequisite before nest");
    tick(prereq);
    check(prereq.players[0].bed == 2, "AI upgrades nest after prerequisite is satisfied");
}
void controlLifecycle() {
    auto game = setup(false);
    auto& p = game.players[0];
    p.human = true;
    p.connected = false;
    p.disconnectedFor = game.balance.reconnectGrace - .1;
    tick(game);
    check(!p.ai.active && p.path.empty(), "AI waits for disconnection grace period");
    p.disconnectedFor = game.balance.reconnectGrace;
    tick(game);
    check(p.ai.active && p.ai.ownsMovement && !p.path.empty(), "AI takes over a disconnected human");
    game.setConnected(0, true);
    check(!p.ai.active && p.path.empty() && p.nestIntent == -1 && p.ai.tree.running < 0,
          "reconnection cancels AI movement and reservations immediately");
    const auto goal = game.map.spawn;
    check(game.command(0, GameAction::Move, -1, goal).empty(), "reconnected player can move");
    const auto size = p.path.size();
    LogicCatAi::update(game, p);
    check(p.path.size() == size && !p.ai.active, "AI stop does not erase new human movement");

    p.connected = false;
    p.disconnectedFor = game.balance.reconnectGrace;
    tick(game);
    game.phase = "running";
    game.monster.state = "chasing";
    game.monster.position = p.position;
    check(LogicCombat::catchCat(game, 0), "manager physically reaches the controlled cat");
    check(!p.ai.active && p.ai.tree.running < 0 && p.path.empty() && p.nestIntent == -1,
          "capture clears behavior progress and movement");
    game.phase = "won";
    check(game.rematch(0).empty() && !p.ai.active && p.ai.targetCell == -1 && p.alive,
          "rematch creates fresh AI state");
}
void multiplayerAndDeterminism() {
    for (unsigned seed = 0; seed < 12; ++seed) {
        Game first("A", 1, seed, testConfig()), second("B", 1, seed, testConfig());
        for (auto* game : {&first, &second}) {
            game->addHuman("Host");
            game->start(0);
            game->setConnected(0, false);
            game->balance.preparation = 1000;
            advance(*game, 590);
        }
        std::set<int> owners;
        for (int i = 0; i < Seats; ++i) {
            const auto& a = first.players[i];
            const auto& b = second.players[i];
            check(a.room >= 0 && owners.insert(a.room).second, "six bots independently settle unique rooms");
            check(a.room == b.room && a.wallet == b.wallet && a.position.x == b.position.x &&
                      a.position.y == b.position.y && a.ai.targetCell == b.ai.targetCell,
                  "identical seeds and inputs reproduce AI behavior");
        }
    }
}
} // namespace
int main() {
    try {
        treeSemantics();
        movingAndInterrupts();
        invalidTargetAndTimeout();
        economyAndLimits();
        controlLifecycle();
        multiplayerAndDeterminism();
        std::cout << "PASS " << checks << " behavior tree/AI checks\n";
    } catch (const std::exception& e) {
        std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n';
        return 1;
    }
}
