#include "ai/logic_cat_ai.h"
#include "common/game_math.h"
#include "game.h"
#include "logic_economy.h"
#include <algorithm>
namespace snackshop {
const Prop* Game::propAt(int cell) const {
    const int room = map.roomAt(cell);
    if (room < 0) {
        return nullptr;
    }
    for (const auto& prop : dorms[room].props) {
        if (prop.cell == cell) {
            return &prop;
        }
    }
    return nullptr;
}
bool Game::walkable(int cell, int player, int startingRoom) const {
    if (map.wall(cell)) {
        return false;
    }
    if (const auto* prop = propAt(cell); prop && config().item(prop->kind).behavior != ItemBehavior::Pickup) {
        return false;
    }
    const int room = map.roomAt(cell);
    if (room >= 0 && cell == dorms[room].door) {
        if (dorms[room].doorClosed()) {
            // A guest already inside may open the door to leave. Ownership keeps
            // the owner inside and denies entry to outside cats and the manager.
            return player >= 0 && startingRoom == room && dorms[room].owner != player;
        }
        return true;
    }
    return true;
}
std::deque<Point> Game::pathTo(Point from, int cell, int player) const {
    const int start = GridMap::cellAt(from), startingRoom = map.roomAt(start);
    const auto path = map.route(start, cell, [&](int next) { return walkable(next, player, startingRoom); });
    std::deque<Point> points;
    // Recenter on the current grid axis before changing direction. This prevents
    // rapid destination changes from cutting diagonally through wall corners.
    for (int next : path) {
        points.push_back(GridMap::center(next));
    }
    return points;
}
bool Game::moveAlong(Point& position, std::deque<Point>& path, double distance, int player) const {
    while (!path.empty() && distance > 0) {
        const int current = GridMap::cellAt(position), next = GridMap::cellAt(path.front());
        if (next != current && !walkable(next, player, map.roomAt(current))) {
            path.clear();
            return false;
        }
        const double segment = GameMath::distance(position, path.front());
        if (segment <= distance) {
            position = path.front();
            path.pop_front();
            distance -= segment;
        } else {
            GameMath::approach(position, path.front(), distance);
            distance = 0;
        }
    }
    return path.empty();
}
bool Game::buildKeepsAccess(const Dorm& room, int cell) const {
    auto passable = [&](int next) {
        if (map.roomAt(next) != room.id || next == cell || map.wall(next)) {
            return false;
        }
        const auto* prop = propAt(next);
        return !prop || config().item(prop->kind).behavior == ItemBehavior::Pickup;
    };
    const auto reachable = map.distances(room.door, passable);
    for (int floor : room.floor) {
        if (passable(floor) && reachable[floor] < 0) {
            return false;
        }
    }
    return true;
}
void Game::arrive(Player& p) {
    const int cell = GridMap::cellAt(p.position), roomId = map.roomAt(cell);
    if (roomId >= 0) {
        auto& props = dorms[roomId].props;
        const auto crate = std::find_if(props.begin(), props.end(), [&](const Prop& prop) {
            return prop.cell == cell && config().item(prop.kind).behavior == ItemBehavior::Pickup;
        });
        if (crate != props.end()) {
            const auto& item = config().item(crate->kind);
            const auto amount = item.levels[crate->level - 1].amount;
            LogicEconomy::credit(p, config(), item.currency, amount);
            props.erase(crate);
            notify(p.name + " 找到" + item.name + " +" + std::to_string(amount) + " " +
                   config().currency(item.currency).name);
        }
    }
    if (isEscaping(p)) {
        p.sleeping = false;
        p.nestIntent = -1;
        return;
    }
    if (!p.path.empty() || p.nestIntent < 0) {
        return;
    }
    auto& room = dorms[p.nestIntent];
    if (cell != room.nest || GameMath::distance(p.position, GridMap::center(room.nest)) > 1) {
        p.nestIntent = -1;
        return;
    }
    if (room.owner >= 0 && room.owner != p.id) {
        notify(p.name + " 慢了一步，这个猫窝已有主人");
        p.nestIntent = -1;
        return;
    }
    if (p.room < 0) {
        if (phase == "running" && map.roomAt(GridMap::cellAt(monster.position)) == room.id) {
            notify(p.name + " 的猫窝被店长盯上了，快找其他猫店");
            p.nestIntent = -1;
            return;
        }
        p.room = room.id;
        room.owner = p.id;
        for (auto& other : players) {
            if (other.id == p.id || !other.alive ||
                (other.nestIntent != room.id && (!other.ai.active || other.ai.targetRoom != room.id))) {
                continue;
            }
            // Abort the losing task; next tick the AI can choose another unclaimed nest.
            LogicCatAi::stop(*this, other);
            other.nestIntent = -1;
            other.path.clear();
            other.decisionAt = 0;
        }
        notify(p.name + " 占领了 " + std::to_string(room.id + 1) + " 号猫店，店门已关闭，走动也能赚罐头");
    }
    p.sleeping = true;
    p.nestIntent = -1;
}
} // namespace snackshop
