#ifndef SNACKSHOP_COMBAT_CONFIG_H
#define SNACKSHOP_COMBAT_CONFIG_H
#include <array>
namespace snackshop {
constexpr int EnemyTimeExperience = 1;
constexpr int EnemyDoorExperience = 5;
constexpr double EnemyAttackInterval = .9;
constexpr double EnemyAttackRange = 17;
constexpr double EnemyRestDuration = 7;
constexpr double EnemyRecoveryDuration = 6;
struct EnemyLevelStats {
    int maxHp;
    int doorDamage;
    double speed;
    int nextExperience;
};
inline constexpr std::array<EnemyLevelStats, 10> EnemyLevels{{
    {650, 28, 107, 45},
    {810, 36, 111, 60},
    {970, 44, 115, 75},
    {1130, 52, 119, 90},
    {1290, 60, 123, 105},
    {1450, 68, 127, 120},
    {1610, 76, 131, 135},
    {1770, 84, 135, 150},
    {1930, 92, 139, 165},
    {2090, 100, 143, 0},
}};
} // namespace snackshop
#endif
