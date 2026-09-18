#include "manager_behavior.h"
#include "battle/logic_combat.h"
#include "battle/logic_progression.h"
#include "common/game_math.h"
#include "game/logic_economy.h"
#include <algorithm>
namespace snackshop {
namespace {
using Context = ManagerAiContext;
using Status = bt::Status;
void setAttackingPlayer(Game& game, int player) {
    auto& m = game.monster;
    if (m.attackingPlayer != player) {
        if (m.attackingPlayer >= 0) {
            game.dorms[game.players[m.attackingPlayer].room].attackDelayUntil = 0;
        }
        m.attackingPlayer = player;
        m.attackStartedAt = player >= 0 ? game.elapsed : -1;
    }
}
void cancelMovement(Context& c) {
    c.game.monster.path.clear();
    setAttackingPlayer(c.game, -1);
}
bool returning(const Monster& m) {
    return m.state == "retreating" || m.state == "defeated";
}
void beginReturn(Context& c, bool defeated) {
    auto& m = c.game.monster;
    m.state = defeated ? "defeated" : "retreating";
    m.prey = m.target = m.destination = -1;
    m.path.clear();
    m.repathAt = 0;
    setAttackingPlayer(c.game, -1);
    if (defeated) {
        for (auto& p : c.game.players) {
            if (p.alive) {
                LogicEconomy::reward(p, c.game.config(), c.game.config().enemy.retreatReward);
            }
        }
        c.game.notify("店长被赶跑了！每只留守猫获得奖励");
    } else {
        c.game.notify("店长撑不住了，正回家休息回血");
    }
}
Status returnHome(Context& c) {
    auto& m = c.game.monster;
    const auto& ai = c.game.config().managerAi;
    setAttackingPlayer(c.game, -1);
    if (c.game.elapsed >= m.repathAt) {
        m.path = c.game.pathTo(m.position, c.game.map.shopkeeperSpawn);
        m.repathAt = c.game.elapsed + ai.repathInterval;
    }
    const double speed = LogicProgression::stats(m, c.game.config().enemy).speed * ai.retreatSpeed;
    c.game.moveAlong(m.position, m.path, speed * c.dt);
    if (GameMath::distance(m.position, c.game.map.center(c.game.map.shopkeeperSpawn)) < 2) {
        m.state = "resting";
        m.restUntil = c.game.elapsed + c.game.config().enemy.restDuration;
        m.path.clear();
        return Status::Success;
    }
    return Status::Running;
}
Status rest(Context& c) {
    auto& m = c.game.monster;
    m.hp = std::min(m.maxHp, m.hp + m.maxHp / c.game.config().enemy.recoveryDuration * c.dt);
    if (c.game.elapsed >= m.restUntil && m.hp >= m.maxHp * c.game.config().managerAi.resumeHealth) {
        m.state = "hunting";
        ++m.raids;
        m.prey = m.target = m.destination = -1;
        m.targetDecisionAt = m.targetHoldUntil = m.repathAt = 0;
        c.game.notify("店长休息好了，再次出门找猫");
        return Status::Success;
    }
    return Status::Running;
}
int destinationFor(const Game& game, const Player& cat) {
    const int cell = game.map.cellAt(cat.position), room = game.map.roomAt(cell);
    return room >= 0 && game.dorms[room].doorClosed() && game.map.roomAt(game.map.cellAt(game.monster.position)) != room
               ? game.dorms[room].entrance
               : cell;
}
bool selectTarget(Context& c) {
    auto& m = c.game.monster;
    const auto& ai = c.game.config().managerAi;
    if (m.prey >= 0 && !c.game.players[m.prey].alive) {
        m.prey = -1;
        m.targetDecisionAt = 0;
    }
    if (c.game.elapsed < m.targetDecisionAt) {
        return m.prey >= 0;
    }
    m.targetDecisionAt = c.game.elapsed + ai.targetInterval;
    struct Candidate {
        int id;
        double score;
    };
    std::vector<Candidate> candidates;
    for (const auto& cat : c.game.players) {
        if (!cat.alive) {
            continue;
        }
        const int destination = destinationFor(c.game, cat);
        const auto route = c.game.pathTo(m.position, destination);
        if (route.empty()) {
            continue;
        }
        const int roomId = c.game.map.roomAt(c.game.map.cellAt(cat.position));
        int attacks = 0;
        double doorHealth = 0;
        if (roomId >= 0) {
            const auto& room = c.game.dorms[roomId];
            for (const auto& prop : room.props) {
                attacks += c.game.config().item(prop.kind).behavior == ItemBehavior::SingleAttack;
            }
            doorHealth = destination == room.entrance ? room.hp : 0;
        }
        const double score = attacks * ai.attackWeight + doorHealth * ai.doorHealthWeight +
                             (route.size() - 1) * ai.distanceWeight +
                             std::uniform_real_distribution<double>(0, ai.randomWeight)(c.random);
        candidates.push_back({cat.id, score});
    }
    if (candidates.empty()) {
        m.prey = m.target = m.destination = -1;
        m.path.clear();
        return false;
    }
    const auto best = std::min_element(candidates.begin(), candidates.end(),
                                       [](const auto& a, const auto& b) { return a.score < b.score; });
    const auto current = std::find_if(candidates.begin(), candidates.end(),
                                      [&](const auto& candidate) { return candidate.id == m.prey; });
    if (current != candidates.end() &&
        (c.game.elapsed < m.targetHoldUntil || best->score + ai.switchMargin >= current->score)) {
        return true;
    }
    if (m.prey != best->id) {
        m.prey = best->id;
        m.targetHoldUntil = c.game.elapsed + ai.targetHold;
        m.repathAt = 0;
        m.path.clear();
    }
    return true;
}
Status hunt(Context& c) {
    auto& m = c.game.monster;
    if (!selectTarget(c)) {
        setAttackingPlayer(c.game, -1);
        m.state = "hunting";
        return Status::Failure;
    }
    auto& prey = c.game.players[m.prey];
    const int cell = c.game.map.cellAt(prey.position), roomId = c.game.map.roomAt(cell);
    const int destination = destinationFor(c.game, prey);
    const bool locked =
        roomId >= 0 && destination == c.game.dorms[roomId].entrance && c.game.dorms[roomId].doorClosed();
    m.target = roomId;
    if (c.game.elapsed >= m.repathAt || m.destination != destination) {
        // Finish the current grid segment before rerouting to a moving cat.
        // Recentring on every prey cell change can otherwise erase the speed advantage.
        Point origin = m.position;
        if (!m.path.empty() && c.game.walkable(c.game.map.cellAt(m.path.front()))) {
            origin = m.path.front();
        }
        m.path = c.game.pathTo(origin, destination);
        m.destination = destination;
        m.repathAt = c.game.elapsed + c.game.config().managerAi.repathInterval;
        if (m.path.empty()) {
            m.prey = m.target = m.destination = -1;
            m.state = "hunting";
            setAttackingPlayer(c.game, -1);
            return Status::Failure;
        }
    }
    int attacked = -1;
    if (locked && GameMath::distance(m.position, c.game.map.center(destination)) < 2) {
        attacked = c.game.dorms[roomId].owner;
        m.state = "attacking";
        LogicCombat::hitDoor(c.game, roomId);
        if (!c.game.dorms[roomId].doorClosed()) {
            attacked = -1;
        }
    } else {
        m.state = locked ? "hunting" : "chasing";
        c.game.moveAlong(m.position, m.path, LogicProgression::stats(m, c.game.config().enemy).speed * c.dt);
        if (!locked && LogicCombat::catchCat(c.game, prey.id)) {
            m.prey = m.target = m.destination = -1;
            m.targetDecisionAt = 0;
            m.path.clear();
            m.state = "hunting";
        }
    }
    setAttackingPlayer(c.game, attacked);
    return Status::Running;
}
} // namespace
void ManagerBehavior::clearAttack(Game& game) {
    setAttackingPlayer(game, -1);
}
const bt::Tree<ManagerAiContext>& ManagerBehavior::tree() {
    static const auto definition = [] {
        bt::Builder<Context> b;
        const int defeated =
            b.sequence("defeated", {b.condition("new_defeat",
                                                [](Context& c) {
                                                    const auto& m = c.game.monster;
                                                    return m.hp <= 0 && m.state != "defeated" && m.state != "resting";
                                                }),
                                    b.action("flee_after_defeat", [](Context& c) {
                                        beginReturn(c, true);
                                        return Status::Success;
                                    })});
        const int returningHome = b.sequence(
            "returning_home", {b.condition("already_returning", [](Context& c) { return returning(c.game.monster); }),
                               b.action("return_home", returnHome, cancelMovement)});
        const int resting = b.sequence(
            "resting", {b.condition("at_home_resting", [](Context& c) { return c.game.monster.state == "resting"; }),
                        b.action("recover_at_home", rest)});
        const int lowHealth =
            b.sequence("low_health", {b.condition("needs_recovery",
                                                  [](Context& c) {
                                                      const auto& m = c.game.monster;
                                                      return m.hp <= m.maxHp * c.game.config().managerAi.retreatHealth;
                                                  }),
                                      b.action("retreat_for_recovery", [](Context& c) {
                                          beginReturn(c, false);
                                          return Status::Success;
                                      })});
        const int root = b.selector("manager", {defeated, returningHome, resting, lowHealth,
                                                b.action("select_and_hunt", hunt, cancelMovement)});
        return std::move(b).finish(root);
    }();
    return definition;
}
} // namespace snackshop
