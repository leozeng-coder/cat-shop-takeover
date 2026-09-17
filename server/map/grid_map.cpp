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
    return t >= '0' && t < '0' + MaxRooms ? t - '0' : t >= 'a' && t < 'a' + MaxRooms ? t - 'a' : -1;
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
void GridMap::generate(std::uint32_t value, std::vector<Dorm>& rooms, const GameConfig& config) {
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
    const auto& rules = config.mapGeneration;
    const int roomCount = pick(rules.minRooms, rules.maxRooms);
    rooms.assign(roomCount, Dorm{});
    struct Zone {
        int x, y, w, h;
    };
    // Vary the number, width and offset of shops along three staggered street blocks.
    // Keep continuous exterior lanes so closing any shop never seals a public route.
    std::array<int, 3> counts{roomCount / 3, roomCount / 3, roomCount / 3};
    for (int i = 0; i < roomCount % 3; ++i) {
        ++counts[i];
    }
    std::shuffle(counts.begin(), counts.end(), random);
    const std::array<int, 2> gaps{pick(2, 3), pick(2, 3)};
    const int availableHeight = MapHeight - 4 - gaps[0] - gaps[1];
    std::vector<Zone> zones;
    int bandY = 2;
    for (int row = 0; row < 3; ++row) {
        const int h = availableHeight / 3 + (row < availableHeight % 3 ? 1 : 0);
        const int gap = pick(1, 2);
        const int availableWidth = MapWidth - 4 - gap * (counts[row] - 1);
        int x = 2;
        for (int column = 0; column < counts[row]; ++column) {
            const int w = availableWidth / counts[row] + (column < availableWidth % counts[row] ? 1 : 0);
            zones.push_back({x, bandY, w, h});
            x += w + gap;
        }
        if (row == 0) {
            spawn = (bandY + h) * MapWidth + MapWidth / 2;
        }
        bandY += h + (row < 2 ? gaps[row] : 0);
    }
    std::shuffle(zones.begin(), zones.end(), random);
    for (int id = 0; id < roomCount; ++id) {
        auto& room = rooms[id];
        room.hp = config.doors.front().health;
        room.id = id;
        const auto plot = zones[id];
        const int width = pick(rules.minRoomWidth, std::min(rules.maxRoomWidth, plot.w));
        const int height = pick(rules.minRoomHeight, std::min(rules.maxRoomHeight, plot.h));
        const Zone z{plot.x + pick(0, plot.w - width), plot.y + pick(0, plot.h - height), width, height};
        const int shape = pick(0, 5);
        const bool mirrorX = pick(0, 1), mirrorY = pick(0, 1);
        const int floorWidth = z.w - 2, floorHeight = z.h - 2;
        auto inside = [&](int x, int y) {
            const int xx = mirrorX ? floorWidth - 1 - x : x;
            const int yy = mirrorY ? floorHeight - 1 - y : y;
            // Rectangle, L, corner recess, stepped, T and U footprints.
            if (shape == 1 && xx >= floorWidth / 2 && yy >= floorHeight / 2) {
                return false;
            }
            if (shape == 2 && xx >= floorWidth - 2 && yy >= floorHeight - 2) {
                return false;
            }
            if (shape == 3 && ((xx < 2 && yy < 2) || (xx >= floorWidth - 2 && yy >= floorHeight - 2))) {
                return false;
            }
            if (shape == 4 && yy >= 2 && (xx < 1 || xx >= floorWidth - 1)) {
                return false;
            }
            if (shape == 5 && xx >= 2 && xx < floorWidth - 2 && yy < floorHeight - 2) {
                return false;
            }
            return true;
        };
        // Carve a connected floor first, then wrap it in walls; narrow corners stay walkable.
        for (int y = 0; y < floorHeight; ++y) {
            for (int x = 0; x < floorWidth; ++x) {
                if (inside(x, y)) {
                    const int cell = (z.y + y + 1) * MapWidth + z.x + x + 1;
                    room.floor.push_back(cell);
                    rows[cell / MapWidth][cell % MapWidth] = static_cast<char>('0' + id);
                }
            }
        }
        std::vector<int> footprint;
        for (int cell : room.floor) {
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    const int boundary = cell + dy * MapWidth + dx;
                    if (tile(boundary) == '.') {
                        rows[boundary / MapWidth][boundary % MapWidth] = '#';
                        footprint.push_back(boundary);
                    }
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
        // Initial items are buildable props or pickups; neither blocks movement.
        for (int cell : room.floor) {
            if (static_cast<int>(room.props.size()) >= wanted) {
                break;
            }
            if (cell == room.nest) {
                continue;
            }
            const auto& kind = room.props.empty()
                                   ? config.initialItems[pick(0, static_cast<int>(config.initialItems.size()) - 1)]
                                   : config.pickupItem;
            room.props.push_back({cell, kind});
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
    // The six cats occupy a 3-by-2 patch; preserve both rows when mirroring.
    spawn = transform(spawn) - (flipY ? MapWidth : 0);
    shopkeeperSpawn = transform(shopkeeperSpawn);
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
