#ifndef SNACKSHOP_LOGIC_PROGRESSION_H
#define SNACKSHOP_LOGIC_PROGRESSION_H
#include "game/game_types.h"
namespace snackshop {
class LogicProgression {
public:
    static const EnemyLevelStats& stats(const Monster& monster, const EnemyConfig& config);
    // Returns levels gained. Fractional rage from all sources accumulates across hits and levels.
    static int grant(Monster& monster, double rage, const EnemyConfig& config);
    static int advanceTime(Monster& monster, double dt, const EnemyConfig& config);
};
} // namespace snackshop
#endif
