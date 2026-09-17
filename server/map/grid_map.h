#ifndef SNACKSHOP_GRID_MAP_H
#define SNACKSHOP_GRID_MAP_H
#include "game/game_types.h"
#include <functional>
#include <random>
namespace snackshop {
// '.' street, '#' wall, '0'..'5' room floor, 'a'..'f' single entrance.
// Immutable terrain is shared by generation, navigation and network snapshots.
class GridMap {
public:
    std::array<std::string, MapHeight> rows;
    std::uint32_t seed = 0;
    int spawn = 12 * MapWidth + 22;
    int shopkeeperSpawn = 18 * MapWidth + 1;
    void generate(std::uint32_t value, std::array<Dorm, Seats>& rooms, const GameConfig& config);
    static bool valid(int cell);
    static int cellAt(Point point);
    static Point center(int cell);
    char tile(int cell) const;
    int roomAt(int cell) const;
    bool wall(int cell) const;
    std::vector<int> neighbors(int cell) const;
    std::array<int, MapWidth * MapHeight> distances(int from, const std::function<bool(int)>& passable) const;
    std::vector<int> route(int from, int to, const std::function<bool(int)>& passable) const;
};
} // namespace snackshop
#endif
