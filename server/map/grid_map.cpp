#include "grid_map.h"
#include "common/weighted_random.h"
#include "map_layout.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string_view>
namespace snackshop {
namespace {
constexpr std::string_view RoomFloorTiles = "0123456789ABCDEF";
static_assert(RoomFloorTiles.size() == MaxRooms);
} // namespace
bool GridMap::valid(int cell) const {
    return cell >= 0 && cell < width * height;
}
int GridMap::cellAt(Point p) const {
    if (!std::isfinite(p.x) || !std::isfinite(p.y) || p.x < 0 || p.y < 0 || p.x >= width * TileSize ||
        p.y >= height * TileSize) {
        return -1;
    }
    return static_cast<int>(p.y / TileSize) * width + static_cast<int>(p.x / TileSize);
}
Point GridMap::center(int cell) const {
    return {(cell % width + .5) * TileSize, (cell / width + .5) * TileSize};
}
char GridMap::tile(int cell) const {
    return valid(cell) ? rows[cell / width][cell % width] : '#';
}
bool GridMap::wall(int cell) const {
    return tile(cell) == '#';
}
int GridMap::roomAt(int cell) const {
    const auto t = tile(cell);
    const auto floor = RoomFloorTiles.find(t);
    if (floor != std::string_view::npos) {
        return static_cast<int>(floor);
    }
    return t >= 'a' && t < 'a' + MaxRooms ? t - 'a' : -1;
}
std::vector<int> GridMap::neighbors(int cell) const {
    std::vector<int> result;
    if (!valid(cell)) {
        return result;
    }
    const int x = cell % width, y = cell / width;
    if (x > 0) {
        result.push_back(cell - 1);
    }
    if (x + 1 < width) {
        result.push_back(cell + 1);
    }
    if (y > 0) {
        result.push_back(cell - width);
    }
    if (y + 1 < height) {
        result.push_back(cell + width);
    }
    return result;
}
std::vector<int> GridMap::distances(int from, const std::function<bool(int)>& passable) const {
    std::vector<int> result(cellCount(), -1);
    if (!valid(from) || !passable(from)) {
        return result;
    }
    std::vector<int> queue(cellCount());
    int head = 0, tail = 0;
    queue[tail++] = from;
    result[from] = 0;
    while (head < tail) {
        const int current = queue[head++];
        const int x = current % width, y = current / width;
        const std::array<int, 4> adjacent{x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1,
                                          y > 0 ? current - width : -1, y + 1 < height ? current + width : -1};
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
    std::vector<int> parent(cellCount(), -1), queue(cellCount());
    int head = 0, tail = 0;
    queue[tail++] = from;
    parent[from] = from;
    while (head < tail && parent[to] < 0) {
        const int current = queue[head++];
        const int x = current % width, y = current / width;
        const std::array<int, 4> adjacent{x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1,
                                          y > 0 ? current - width : -1, y + 1 < height ? current + width : -1};
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
void GridMap::generate(std::uint32_t value, std::vector<Dorm>& rooms, const GameConfig& config,
                       const std::string& selectedMap) {
    seed = value;
    std::mt19937 random(value);
    auto pick = [&](int low, int high) { return std::uniform_int_distribution<int>(low, high)(random); };
    const auto& profiles = config.mapGeneration.profiles;
    int totalWeight = 0;
    for (const auto& profile : profiles) {
        totalWeight += profile.weight;
    }
    if (totalWeight <= 0) {
        throw std::runtime_error("No enabled map profiles");
    }
    const auto* selected = config.mapProfile(selectedMap);
    if (!selectedMap.empty() && !selected) {
        throw std::invalid_argument("Unknown or disabled map: " + selectedMap);
    }
    if (!selected) {
        int selection = pick(1, totalWeight);
        selected = &*std::find_if(profiles.begin(), profiles.end(), [&](const auto& profile) {
            selection -= profile.weight;
            return selection <= 0;
        });
    }
    const auto& rules = *selected;
    profileId = rules.id;
    name = rules.name;
    theme = rules.theme;
    width = rules.width;
    height = rules.height;
    shopkeeperSpawn = (height / 2) * width + 1;
    rows.assign(height, std::string(width, '.'));
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            if (x == 0 || y == 0 || x == width - 1 || y == height - 1) {
                rows[y][x] = '#';
            }
        }
    }
    const int roomCount = pick(rules.minRooms, rules.maxRooms);
    rooms.assign(roomCount, Dorm{});
    struct Zone {
        int x, y, w, h;
    };
    // Vary shops along configured street bands; all lanes remain public when doors close.
    // Keep continuous exterior lanes so closing any shop never seals a public route.
    std::vector<int> counts(rules.bands, roomCount / rules.bands);
    for (int i = 0; i < roomCount % rules.bands; ++i) {
        ++counts[i];
    }
    std::shuffle(counts.begin(), counts.end(), random);
    const int gap = rules.corridorWidth;
    const int margin = 1 + gap;
    const int availableHeight = height - 2 * margin - gap * (rules.bands - 1);
    std::vector<Zone> zones;
    zones.reserve(roomCount);
    int bandY = margin;
    for (int row = 0; row < rules.bands; ++row) {
        const int h = availableHeight / rules.bands + (row < availableHeight % rules.bands ? 1 : 0);
        const int availableWidth = width - 2 * margin - gap * (counts[row] - 1);
        int x = margin;
        for (int column = 0; column < counts[row]; ++column) {
            const int w = availableWidth / counts[row] + (column < availableWidth % counts[row] ? 1 : 0);
            zones.push_back({x, bandY, w, h});
            x += w + gap;
        }
        if (row == 0) {
            spawn = (bandY + h) * width + width / 2;
        }
        bandY += h + gap;
    }
    std::shuffle(zones.begin(), zones.end(), random);
    for (int id = 0; id < roomCount; ++id) {
        auto& room = rooms[id];
        room.hp = config.doors.front().health;
        room.id = id;
        const auto plot = zones[id];
        const auto candidates = roomFootprints(rules, plot.w, plot.h);
        if (candidates.empty()) {
            throw std::runtime_error("Map profile has no valid room footprint: " + rules.id);
        }
        const auto footprint = candidates[pick(0, static_cast<int>(candidates.size()) - 1)];
        const Zone z{plot.x + pick(0, plot.w - footprint.width), plot.y + pick(0, plot.h - footprint.height),
                     footprint.width, footprint.height};
        const bool mirrorX = pick(0, 1), mirrorY = pick(0, 1);
        const int floorWidth = z.w - 2, floorHeight = z.h - 2;
        auto inside = [&](int x, int y) {
            const int xx = mirrorX ? floorWidth - 1 - x : x;
            const int yy = mirrorY ? floorHeight - 1 - y : y;
            return roomFloorContains(footprint.shape, floorWidth, floorHeight, xx, yy);
        };
        // Carve a connected floor first, then wrap it in walls; narrow corners stay walkable.
        for (int y = 0; y < floorHeight; ++y) {
            for (int x = 0; x < floorWidth; ++x) {
                if (inside(x, y)) {
                    const int cell = (z.y + y + 1) * width + z.x + x + 1;
                    room.floor.push_back(cell);
                    rows[cell / width][cell % width] = RoomFloorTiles[id];
                }
            }
        }
        std::vector<int> boundaryCells;
        for (int cell : room.floor) {
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    const int boundary = cell + dy * width + dx;
                    if (tile(boundary) == '.') {
                        rows[boundary / width][boundary % width] = '#';
                        boundaryCells.push_back(boundary);
                    }
                }
            }
        }
        // A door must join interior floor to the connected exterior street.
        std::vector<std::pair<int, int>> doors;
        for (int cell : boundaryCells) {
            if (!wall(cell)) {
                continue;
            }
            for (int direction : {-1, 1, -width, width}) {
                if (tile(cell + direction) == RoomFloorTiles[id] && tile(cell - direction) == '.') {
                    doors.emplace_back(cell, cell - direction);
                }
            }
        }
        std::sort(doors.begin(), doors.end(), [&](auto a, auto b) {
            auto distance = [&](int c) {
                return std::abs(c % width - spawn % width) + std::abs(c / width - spawn / width);
            };
            return distance(a.first) < distance(b.first);
        });
        if (doors.empty() || room.floor.empty()) {
            throw std::runtime_error("Invalid room footprint");
        }
        const auto chosen = doors[pick(0, std::min(3, static_cast<int>(doors.size()) - 1))];
        room.door = chosen.first;
        room.entrance = chosen.second;
        rows[room.door / width][room.door % width] = static_cast<char>('a' + id);
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
        const auto& initial = rules.initialItems;
        const int wanted = initial ? pick(initial->minPerRoom, initial->maxPerRoom) : pick(1, 2);
        // Initial items are buildable props or pickups; neither blocks movement.
        for (int cell : room.floor) {
            if (static_cast<int>(room.props.size()) >= wanted) {
                break;
            }
            if (cell == room.nest) {
                continue;
            }
            if (initial) {
                std::vector<int> weights;
                for (const auto& reward : initial->rewards) {
                    const bool duplicate = config.item(reward.item).unique &&
                                           std::any_of(room.props.begin(), room.props.end(),
                                                       [&](const auto& prop) { return prop.kind == reward.item; });
                    weights.push_back(duplicate ? 0 : reward.weight);
                }
                const auto& reward = initial->rewards[weightedDraw(weights, random)];
                weights.clear();
                for (const auto& level : reward.levels) {
                    weights.push_back(level.weight);
                }
                Prop prop{cell, reward.item};
                prop.level = reward.levels[weightedDraw(weights, random)].level;
                room.props.push_back(std::move(prop));
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
        const int x = cell % width, y = cell / width;
        return (flipY ? height - 1 - y : y) * width + (flipX ? width - 1 - x : x);
    };
    const auto original = rows;
    for (int cell = 0; cell < width * height; ++cell) {
        const int target = transform(cell);
        rows[target / width][target % width] = original[cell / width][cell % width];
    }
    // The six cats occupy a 3-by-2 patch; preserve both rows when mirroring.
    spawn = transform(spawn) - (flipY ? width : 0);
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
