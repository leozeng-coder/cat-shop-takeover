#ifndef SNACKSHOP_LOGIC_PROGRESSION_H
#define SNACKSHOP_LOGIC_PROGRESSION_H
#include "game/game_types.h"
namespace snackshop {
class LogicProgression {
public:
    static const EnemyLevelStats& stats(const Monster& monster, const EnemyConfig& config);
    // Returns how many levels were gained; excess XP carries into the next level.
    static int grant(Monster& monster, int experience, const EnemyConfig& config);
    static int advanceTime(Monster& monster, double dt, const EnemyConfig& config);
};
} // namespace snackshop
#endif
