#ifndef SNACKSHOP_GRID_MAP_H
#define SNACKSHOP_GRID_MAP_H
#include "game/game_types.h"
#include <functional>
#include <random>
namespace snackshop {
// '.' street, '#' wall, '0'..'9' / 'A'..'F' room floor, 'a'..'p' single entrance.
// Immutable terrain is shared by generation, navigation and network snapshots.
class GridMap {
public:
    std::vector<std::string> rows;
    std::string profileId, name, theme;
    int width = 0, height = 0;
    std::uint32_t seed = 0;
    int spawn = -1, shopkeeperSpawn = -1;
    void generate(std::uint32_t value, std::vector<Dorm>& rooms, const GameConfig& config, const std::string& selectedMap = "");
    int cellCount() const { return width * height; }
    bool valid(int cell) const;
    int cellAt(Point point) const;
    Point center(int cell) const;
    char tile(int cell) const;
    int roomAt(int cell) const;
    bool wall(int cell) const;
    std::vector<int> neighbors(int cell) const;
    std::vector<int> distances(int from, const std::function<bool(int)>& passable) const;
    std::vector<int> route(int from, int to, const std::function<bool(int)>& passable) const;
};
} // namespace snackshop
#endif
