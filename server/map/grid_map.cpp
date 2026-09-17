#include "grid_map.h"
#include <algorithm>
#include <cmath>
#include <queue>
#include <stdexcept>
namespace snackshop {
bool GridMap::valid(int cell) {
    return cell >= 0 && cell < MapWidth * MapHeight;
}
int GridMap::cellAt(Point p) {
    if (!std::isfinite(p.x) || !std::isfinite(p.y) || p.x < 0 || p.y < 0 || p.x >= MapWidth * TileSize ||
        p.y >= MapHeight * TileSize) {
        return -1;
    }
    return static_cast<int>(p.y / TileSize) * MapWidth + static_cast<int>(p.x / TileSize);
}
Point GridMap::center(int cell) {
    return {(cell % MapWidth + .5) * TileSize, (cell / MapWidth + .5) * TileSize};
}
char GridMap::tile(int cell) const {
    return valid(cell) ? rows[cell / MapWidth][cell % MapWidth] : '#';
}
bool GridMap::wall(int cell) const {
    return tile(cell) == '#';
}
int GridMap::roomAt(int cell) const {
    const auto t = tile(cell);
    return t >= '0' && t <= '5' ? t - '0' : t >= 'a' && t <= 'f' ? t - 'a' : -1;
}
std::vector<int> GridMap::neighbors(int cell) const {
    std::vector<int> result;
    if (!valid(cell)) {
        return result;
    }
    const int x = cell % MapWidth, y = cell / MapWidth;
    if (x > 0) {
        result.push_back(cell - 1);
    }
    if (x + 1 < MapWidth) {
        result.push_back(cell + 1);
    }
    if (y > 0) {
        result.push_back(cell - MapWidth);
    }
    if (y + 1 < MapHeight) {
        result.push_back(cell + MapWidth);
    }
    return result;
}
std::array<int, MapWidth * MapHeight> GridMap::distances(int from, const std::function<bool(int)>& passable) const {
    std::array<int, MapWidth * MapHeight> result;
    result.fill(-1);
    if (!valid(from) || !passable(from)) {
        return result;
    }
    std::array<int, MapWidth * MapHeight> queue{};
    int head = 0, tail = 0;
    queue[tail++] = from;
    result[from] = 0;
    while (head < tail) {
        const int current = queue[head++];
        const int x = current % MapWidth, y = current / MapWidth;
        const std::array<int, 4> adjacent{x > 0 ? current - 1 : -1, x + 1 < MapWidth ? current + 1 : -1,
                                          y > 0 ? current - MapWidth : -1, y + 1 < MapHeight ? current + MapWidth : -1};
        for (int next : adjacent) {
            if (next < 0 || result[next] >= 0 || !passable(next)) {
                continue;
            }
            result[next] = result[current] + 1;
            queue[tail++] = next;
        }
    }
    return result;
}
std::vector<int> GridMap::route(int from, int to, const std::function<bool(int)>& passable) const {
    if (!valid(from) || !valid(to) || !passable(to)) {
        return {};
    }
    std::array<int, MapWidth * MapHeight> parent, queue;
    parent.fill(-1);
    int head = 0, tail = 0;
    queue[tail++] = from;
    parent[from] = from;
    while (head < tail && parent[to] < 0) {
        const int current = queue[head++];
        const int x = current % MapWidth, y = current / MapWidth;
        const std::array<int, 4> adjacent{x > 0 ? current - 1 : -1, x + 1 < MapWidth ? current + 1 : -1,
                                          y > 0 ? current - MapWidth : -1, y + 1 < MapHeight ? current + MapWidth : -1};
        for (int next : adjacent) {
            if (next < 0 || parent[next] >= 0 || !passable(next)) {
                continue;
            }
            parent[next] = current;
            queue[tail++] = next;
        }
    }
    if (parent[to] < 0) {
        return {};
    }
    std::vector<int> path{to};
    for (int cell = to; cell != from;) {
        cell = parent[cell];
        path.push_back(cell);
    }
    std::reverse(path.begin(), path.end());
    return path;
}
void GridMap::generate(std::uint32_t value, std::array<Dorm, Seats>& rooms) {
    seed = value;
    spawn = 12 * MapWidth + 22;
    shopkeeperSpawn = 18 * MapWidth + 1;
    std::mt19937 random(value);
    auto pick = [&](int low, int high) { return std::uniform_int_distribution<int>(low, high)(random); };
    for (auto& row : rows) {
        row.assign(MapWidth, '.');
    }
    for (int y = 0; y < MapHeight; ++y) {
        for (int x = 0; x < MapWidth; ++x) {
            if (x == 0 || y == 0 || x == MapWidth - 1 || y == MapHeight - 1) {
                rows[y][x] = '#';
            }
        }
    }
    struct Zone {
        int x, y, w, h;
    };
    const std::array<Zone, Seats> zones{
        {{2, 2, 16, 9}, {24, 2, 17, 11}, {2, 14, 12, 13}, {17, 16, 9, 10}, {30, 17, 12, 12}, {7, 30, 28, 5}}};
    for (int id = 0; id < Seats; ++id) {
        auto& room = rooms[id];
        room = Dorm{};
        room.id = id;
        auto z = zones[id];
        z.x += pick(0, 1);
        z.y += pick(0, 1);
        z.w -= pick(1, 3);
        z.h -= (id == 5 ? 1 : pick(1, 2));
        const int shape = id == 5 ? 0 : pick(0, 3);
        const bool mirrorX = pick(0, 1), mirrorY = pick(0, 1);
        std::vector<int> footprint;
        auto inside = [&](int x, int y) {
            if (x < 0 || y < 0 || x >= z.w || y >= z.h) {
                return false;
            }
            const int xx = mirrorX ? z.w - 1 - x : x;
            const int yy = mirrorY ? z.h - 1 - y : y;
            if (shape == 1 && xx >= z.w / 2 && yy >= z.h / 2) {
                return false;
            }
            if (shape == 2 && xx >= z.w - 3 && yy >= z.h - 3) {
                return false;
            }
            if (shape == 3 && z.w >= 10 && xx >= 4 && xx < z.w - 4 && yy < z.h / 2) {
                return false;
            }
            return true;
        };
        for (int y = 0; y < z.h; ++y) {
            for (int x = 0; x < z.w; ++x) {
                if (!inside(x, y)) {
                    continue;
                }
                const int cell = (z.y + y) * MapWidth + z.x + x;
                footprint.push_back(cell);
                const bool boundary = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
                rows[z.y + y][z.x + x] = boundary ? '#' : static_cast<char>('0' + id);
                if (!boundary) {
                    room.floor.push_back(cell);
                }
            }
        }
        // A door must join interior floor to the connected exterior street.
        std::vector<std::pair<int, int>> doors;
        for (int cell : footprint) {
            if (!wall(cell)) {
                continue;
            }
            for (int direction : {-1, 1, -MapWidth, MapWidth}) {
                if (tile(cell + direction) == '0' + id && tile(cell - direction) == '.') {
                    doors.emplace_back(cell, cell - direction);
                }
            }
        }
        std::sort(doors.begin(), doors.end(), [&](auto a, auto b) {
            auto distance = [&](int c) {
                return std::abs(c % MapWidth - spawn % MapWidth) + std::abs(c / MapWidth - spawn / MapWidth);
            };
            return distance(a.first) < distance(b.first);
        });
        if (doors.empty() || room.floor.empty()) {
            throw std::runtime_error("Invalid room footprint");
        }
        const auto chosen = doors[pick(0, std::min(3, static_cast<int>(doors.size()) - 1))];
        room.door = chosen.first;
        room.entrance = chosen.second;
        rows[room.door / MapWidth][room.door % MapWidth] = static_cast<char>('a' + id);
        const auto depth = distances(room.door, [&](int cell) { return roomAt(cell) == id && !wall(cell); });
        int deepest = -1;
        for (int cell : room.floor) {
            if (depth[cell] < 0) {
                throw std::runtime_error("Disconnected room floor");
            }
            if (depth[cell] > deepest) {
                deepest = depth[cell];
                room.nest = cell;
            }
        }
        std::shuffle(room.floor.begin(), room.floor.end(), random);
        const int wanted = pick(1, 2);
        for (int cell : room.floor) {
            if (static_cast<int>(room.props.size()) >= wanted) {
                break;
            }
            if (cell == room.nest ||
                std::abs(cell % MapWidth - room.door % MapWidth) + std::abs(cell / MapWidth - room.door / MapWidth) <
                    3) {
                continue;
            }
            const auto index = room.props.size();
            const PropKind kind = index == 0 ? static_cast<PropKind>(pick(2, 4)) : PropKind::Crate;
            auto passable = [&](int c) {
                if (roomAt(c) != id || wall(c) || (c == cell && kind != PropKind::Crate)) {
                    return false;
                }
                return std::none_of(room.props.begin(), room.props.end(),
                                    [&](const Prop& p) { return p.cell == c && p.kind != PropKind::Crate; });
            };
            const auto reachable = distances(room.door, passable);
            bool connected = true;
            for (int floor : room.floor) {
                if (passable(floor) && reachable[floor] < 0) {
                    connected = false;
                    break;
                }
            }
            if (connected) {
                room.props.push_back({cell, kind});
            }
        }
        // Tight shapes still receive the requested loot count without blocking a corridor.
        for (int cell : room.floor) {
            if (static_cast<int>(room.props.size()) >= wanted) {
                break;
            }
            if (cell != room.nest && std::none_of(room.props.begin(), room.props.end(),
                                                  [&](const Prop& prop) { return prop.cell == cell; })) {
                room.props.push_back({cell, PropKind::Crate});
            }
        }
    }
    // Mirror the whole street as well as varying individual shop footprints.
    // Transform navigation anchors and props together so geometry stays authoritative.
    const bool flipX = pick(0, 1) != 0, flipY = pick(0, 1) != 0;
    auto transform = [&](int cell) {
        const int x = cell % MapWidth, y = cell / MapWidth;
        return (flipY ? MapHeight - 1 - y : y) * MapWidth + (flipX ? MapWidth - 1 - x : x);
    };
    const auto original = rows;
    for (int cell = 0; cell < MapWidth * MapHeight; ++cell) {
        const int target = transform(cell);
        rows[target / MapWidth][target % MapWidth] = original[cell / MapWidth][cell % MapWidth];
    }
    spawn = transform(12 * MapWidth + 22);
    shopkeeperSpawn = transform(18 * MapWidth + 1);
    for (auto& room : rooms) {
        room.door = transform(room.door);
        room.entrance = transform(room.entrance);
        room.nest = transform(room.nest);
        for (auto& cell : room.floor) {
            cell = transform(cell);
        }
        for (auto& prop : room.props) {
            prop.cell = transform(prop.cell);
        }
    }
}
} // namespace snackshop
