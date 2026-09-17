#include "cat_behavior.h"
#include "common/game_math.h"
#include "game/logic_economy.h"
#include <algorithm>
#include <cmath>
namespace snackshop {
namespace {
using Context = CatAiContext;
using Status = bt::Status;
Status result(const std::string& error) {
    return error.empty() ? Status::Success : Status::Failure;
}
void cancelMovement(Context& c) {
    auto& state = c.cat.ai;
    if (state.ownsMovement) {
        c.cat.path.clear();
        c.cat.nestIntent = -1;
    }
    state.ownsMovement = false;
    state.targetRoom = state.targetCell = -1;
    state.moveDeadline = state.repathAt = 0;
}
Status enterNest(Context& c) {
    auto& p = c.cat;
    auto& state = p.ai;
    if (p.sleeping && p.room >= 0) {
        cancelMovement(c);
        return Status::Success;
    }
    if (state.ownsMovement && !p.path.empty() && p.nestIntent == state.targetRoom &&
        c.game.elapsed < state.moveDeadline) {
        const auto& room = c.game.dorms[state.targetRoom];
        if (room.owner < 0 || room.owner == p.id) {
            return Status::Running;
        }
    }
    cancelMovement(c);
    std::vector<int> rooms;
    if (p.room >= 0) {
        rooms.push_back(p.room);
    } else {
        for (const auto& room : c.game.dorms) {
            if (room.owner < 0) {
                rooms.push_back(room.id);
            }
        }
        std::shuffle(rooms.begin(), rooms.end(), c.random);
    }
    for (int id : rooms) {
        if (c.game.command(p.id, GameAction::EnterNest, id).empty()) {
            state.ownsMovement = true;
            state.targetRoom = id;
            state.targetCell = c.game.dorms[id].nest;
            state.moveDeadline = c.game.elapsed + c.game.config().catAi.moveTimeout;
            return Status::Running;
        }
    }
    return Status::Failure;
}
bool routeSafe(const Game& game, const Player& p, const std::deque<Point>& route) {
    const double minimum =
        std::min(GameMath::distance(p.position, game.monster.position), game.config().enemy.captureRange + TileSize);
    return std::all_of(route.begin(), route.end(),
                       [&](Point point) { return GameMath::distance(point, game.monster.position) + 1e-6 >= minimum; });
}
Status evade(Context& c) {
    auto& p = c.cat;
    auto& state = p.ai;
    const auto& ai = c.game.config().catAi;
    if (c.game.elapsed < state.repathAt) {
        return Status::Running;
    }
    state.repathAt = c.game.elapsed + ai.escapeRepath;
    const int current = GridMap::cellAt(p.position);
    const int startingRoom = c.game.map.roomAt(current);
    const double clearance = std::min(GameMath::distance(p.position, c.game.monster.position),
                                      c.game.config().enemy.captureRange + TileSize);
    const auto reachable = c.game.map.distances(current, [&](int cell) {
        return c.game.walkable(cell, p.id, startingRoom) &&
               (cell == current ||
                GameMath::distance(GridMap::center(cell), c.game.monster.position) + 1e-6 >= clearance);
    });
    std::vector<int> cells;
    for (int cell = 0; cell < MapWidth * MapHeight; ++cell) {
        if (cell != current && reachable[cell] >= 0) {
            cells.push_back(cell);
        }
    }
    auto score = [&](int cell) {
        const auto point = GridMap::center(cell);
        return GameMath::distance(point, c.game.monster.position) - .35 * GameMath::distance(point, p.position);
    };
    const int count = std::min(ai.escapeCandidates, static_cast<int>(cells.size()));
    std::partial_sort(cells.begin(), cells.begin() + count, cells.end(), [&](int a, int b) {
        const double left = score(a), right = score(b);
        return left == right ? a < b : left > right;
    });
    for (int i = 0; i < count; ++i) {
        const auto route = c.game.pathTo(p.position, cells[i], p.id);
        if (route.empty() || !routeSafe(c.game, p, route)) {
            continue;
        }
        if (c.game.command(p.id, GameAction::Move, -1, cells[i]).empty()) {
            state.ownsMovement = true;
            state.targetCell = cells[i];
            return Status::Running;
        }
    }
    if (!routeSafe(c.game, p, p.path)) {
        p.path.clear();
    }
    // Stay in the safety branch when trapped; never fall through to returning to a breached nest.
    return Status::Running;
}
int countItems(Context& c, ItemBehavior behavior, const std::string& currency = {}) {
    int count = 0;
    for (const auto& prop : c.game.dorms[c.cat.room].props) {
        const auto& item = c.game.config().item(prop.kind);
        if (item.behavior == behavior && (currency.empty() || item.currency == currency)) {
            ++count;
        }
    }
    return count;
}
bool canSpend(Context& c, const LevelConfig& level, bool emergency) {
    if (!c.game.purchaseError(c.cat.id, level.cost, level.requirements).empty()) {
        return false;
    }
    if (!emergency) {
        for (const auto& reserve : c.profile().reserve) {
            int expense = 0;
            for (const auto& cost : level.cost) {
                if (cost.currency == reserve.currency) {
                    expense = cost.amount;
                }
            }
            if (LogicEconomy::balance(c.cat, reserve.currency) - expense < reserve.amount) {
                return false;
            }
        }
    }
    return true;
}
Status place(Context& c, const ItemConfig& item, bool emergency) {
    if (!canSpend(c, item.levels.front(), emergency)) {
        return Status::Failure;
    }
    auto& room = c.game.dorms[c.cat.room];
    auto cells = room.floor;
    const bool attack = item.behavior == ItemBehavior::SingleAttack;
    auto distance = [&](int cell) {
        return std::abs(cell % MapWidth - room.door % MapWidth) + std::abs(cell / MapWidth - room.door / MapWidth);
    };
    std::sort(cells.begin(), cells.end(), [&](int a, int b) {
        const int da = distance(a), db = distance(b);
        return da == db ? a < b : attack ? da < db : da > db;
    });
    std::erase_if(cells, [&](int cell) { return cell == room.nest || cell == room.door || c.game.propAt(cell); });
    if (cells.empty()) {
        return Status::Failure;
    }
    const int size = static_cast<int>(cells.size()), start = c.cat.ai.buildCursor % size;
    for (int offset = 0; offset < size && c.buildAttempts < c.game.config().catAi.buildAttempts; ++offset) {
        const int index = (start + offset) % size;
        c.cat.ai.buildCursor = (index + 1) % size;
        ++c.buildAttempts;
        if (c.game.command(c.cat.id, GameAction::Build, -1, cells[index], item.id).empty()) {
            return Status::Success;
        }
    }
    return Status::Failure;
}
Status buildType(Context& c, ItemBehavior behavior, int target, const std::string& currency = {},
                 bool emergency = false) {
    if (countItems(c, behavior, currency) >= target) {
        return Status::Failure;
    }
    for (const auto& [id, item] : c.game.config().items) {
        if (item.buildable && item.behavior == behavior && (currency.empty() || item.currency == currency) &&
            place(c, item, emergency) == Status::Success) {
            return Status::Success;
        }
    }
    return Status::Failure;
}
Status upgradeType(Context& c, ItemBehavior behavior) {
    for (const auto& prop : c.game.dorms[c.cat.room].props) {
        const auto& item = c.game.config().item(prop.kind);
        const int next = item.levels[prop.level - 1].nextLevel;
        if (item.behavior == behavior && item.buildable && next && canSpend(c, item.levels[next - 1], false) &&
            c.game.command(c.cat.id, GameAction::Build, -1, prop.cell, item.id).empty()) {
            return Status::Success;
        }
    }
    return Status::Failure;
}
Status buildAttack(Context& c) {
    return buildType(c, ItemBehavior::SingleAttack, c.profile().attackCount, {}, c.cat.ai.danger > 0);
}
Status buildFirstAttack(Context& c) {
    return buildType(c, ItemBehavior::SingleAttack, std::min(1, c.profile().attackCount), {}, true);
}
Status buildRepair(Context& c) {
    return buildType(c, ItemBehavior::DoorRepair, c.profile().repairCount);
}
Status buildCurrency(Context& c) {
    for (const auto& target : c.profile().producers) {
        if (buildType(c, ItemBehavior::CurrencyProducer, target.count, target.currency) == Status::Success) {
            return Status::Success;
        }
    }
    return Status::Failure;
}
Status upgradeDoor(Context& c) {
    return result(c.game.command(c.cat.id, GameAction::UpgradeBarricade));
}
Status upgradeNest(Context& c) {
    return result(c.game.command(c.cat.id, GameAction::UpgradeNest));
}
Status repairDoor(Context& c) {
    return result(c.game.command(c.cat.id, GameAction::Repair, c.cat.room));
}
bool needsRepair(Context& c) {
    const auto& room = c.game.dorms[c.cat.room];
    return room.hp < c.game.config().door(room.level).health * c.game.config().catAi.repairThreshold &&
           c.game.repairError(c.cat.id, room.id).empty();
}
bool needsNestDoor(Context& c) {
    const int next = c.game.config().nest(c.cat.bed).nextLevel;
    return next && c.game.config().nest(next).requirements.doorStage > c.game.dorms[c.cat.room].level;
}
bool hasSafeHome(Context& c) {
    return c.cat.room >= 0 && c.game.dorms[c.cat.room].doorClosed();
}
Status idle(Context&) {
    return Status::Success;
}
} // namespace
int CatBehavior::danger(const Game& game, const Player& p) {
    const auto& m = game.monster;
    if (game.phase != "running" || m.hp <= 0 || m.state == "retreating" || m.state == "resting") {
        return 0;
    }
    const int room = game.map.roomAt(GridMap::cellAt(p.position));
    if (room >= 0 && game.dorms[room].doorClosed() && game.map.roomAt(GridMap::cellAt(m.position)) != room) {
        return m.target == room ? 1 : 0;
    }
    return m.prey == p.id || GameMath::distance(p.position, m.position) < game.config().catAi.dangerRadius ? 2 : 0;
}
const bt::Tree<CatAiContext>& CatBehavior::tree() {
    static const auto definition = [] {
        bt::Builder<Context> b;
        const int safety =
            b.sequence("safety", {b.condition("exposed_to_manager", [](Context& c) { return c.cat.ai.danger == 2; }),
                                  b.action("evade", evade, cancelMovement)});
        const int settle = b.sequence("settle", {b.condition("unclaimed", [](Context& c) { return c.cat.room < 0; }),
                                                 b.action("enter_nest", enterNest, cancelMovement)});
        const int repair = b.sequence("repair_damaged_door", {b.condition("door_below_threshold", needsRepair),
                                                              b.action("repair_door", repairDoor)});
        const int defense =
            b.sequence("urgent_defense", {b.condition("under_attack", [](Context& c) { return c.cat.ai.danger == 1; }),
                                          b.selector("reinforce", {b.action("reinforce_door", upgradeDoor),
                                                                   b.action("reinforce_attack", buildAttack)})});
        const int cautious = b.sequence(
            "defensive_personality",
            {b.condition("prefers_defense", [](Context& c) { return c.profile().preference == AiPreference::Defense; }),
             b.action("prioritize_door", upgradeDoor)});
        const int prerequisite = b.sequence("unlock_nest", {b.condition("nest_requires_door", needsNestDoor),
                                                            b.action("unlock_nest_door", upgradeDoor)});
        const int economy = b.sequence(
            "economic_personality",
            {b.condition("prefers_economy", [](Context& c) { return c.profile().preference == AiPreference::Economy; }),
             b.action("prioritize_nest", upgradeNest)});
        const int aggressive = b.sequence(
            "attack_personality",
            {b.condition("prefers_attack", [](Context& c) { return c.profile().preference == AiPreference::Attack; }),
             b.action("prioritize_attack", buildAttack)});
        const int returnAction = b.action("return_to_nest", enterNest, cancelMovement);
        const int continueRest = b.sequence("continue_rest", {b.condition("return_in_progress",
                                                                          [](Context& c) {
                                                                              return c.cat.ai.ownsMovement &&
                                                                                     c.cat.ai.targetRoom >= 0 &&
                                                                                     c.cat.ai.danger == 0;
                                                                          }),
                                                              returnAction});
        const int rest = b.sequence(
            "rest", {b.condition("awake_and_safe", [](Context& c) { return !c.cat.sleeping && c.cat.ai.danger == 0; }),
                     returnAction});
        const int home = b.sequence(
            "manage_home",
            {b.condition("has_safe_home", hasSafeHome),
             b.selector(
                 "home_priorities",
                 {repair, defense, continueRest, b.action("first_weapon", buildFirstAttack), cautious, prerequisite,
                  economy, aggressive, b.action("build_currency", buildCurrency), b.action("build_repair", buildRepair),
                  b.action("upgrade_nest", upgradeNest), b.action("build_attack", buildAttack),
                  b.action("upgrade_door", upgradeDoor),
                  b.action("upgrade_attack", [](Context& c) { return upgradeType(c, ItemBehavior::SingleAttack); }),
                  b.action("upgrade_currency",
                           [](Context& c) { return upgradeType(c, ItemBehavior::CurrencyProducer); }),
                  b.action("upgrade_repair", [](Context& c) { return upgradeType(c, ItemBehavior::DoorRepair); }),
                  rest})});
        const int root = b.selector("cat", {safety, settle, home, b.action("idle", idle)});
        return std::move(b).finish(root);
    }();
    return definition;
}
} // namespace snackshop
