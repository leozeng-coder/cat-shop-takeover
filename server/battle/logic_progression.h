#ifndef SNACKSHOP_LOGIC_PROGRESSION_H
#define SNACKSHOP_LOGIC_PROGRESSION_H
#include "game/game_types.h"
namespace snackshop {
class LogicProgression {
public:
    static const EnemyLevelStats& stats(const Monster& monster);
    // Returns how many levels were gained; excess XP carries into the next level.
    static int grant(Monster& monster, int experience);
    static int advanceTime(Monster& monster, double dt);
};
} // namespace snackshop
#endif
