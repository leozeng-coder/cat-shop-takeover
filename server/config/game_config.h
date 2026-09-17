#ifndef SNACKSHOP_GAME_CONFIG_H
#define SNACKSHOP_GAME_CONFIG_H
#include <array>
namespace snackshop {
constexpr int Seats = 6;
constexpr int MapWidth = 44;
constexpr int MapHeight = 36;
constexpr int TileSize = 32;
constexpr double CatSpeed = 155;
inline constexpr std::array<int, 3> BedIncome{6, 11, 19};
inline constexpr std::array<int, 2> BedCost{80, 200};
inline constexpr std::array<int, 3> DoorHealth{300, 550, 950};
inline constexpr std::array<int, 2> DoorCost{90, 210};
inline constexpr std::array<int, 3> TowerCost{55, 85, 150};
inline constexpr std::array<int, 3> TowerDamage{11, 20, 34};
inline constexpr std::array<int, 3> PantryCost{65, 100, 170};
inline constexpr std::array<int, 3> PantryIncome{2, 4, 7};
inline constexpr std::array<int, 3> RepairCost{75, 110, 190};
struct Balance {
    double preparation = 30;
    double duration = 300;
    double reconnectGrace = 5;
};
} // namespace snackshop
#endif
