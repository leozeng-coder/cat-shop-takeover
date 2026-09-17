#include "logic_progression.h"
#include <algorithm>
#include <cmath>
namespace snackshop {
const EnemyLevelStats& LogicProgression::stats(const Monster& monster, const EnemyConfig& config) {
    return config.levels[monster.level - 1];
}
int LogicProgression::grant(Monster& monster, int experience, const EnemyConfig& config) {
    if (experience <= 0 || monster.level >= static_cast<int>(config.levels.size())) {
        return 0;
    }
    const int previous = monster.level;
    // Consume a bounded amount for each level instead of adding potentially
    // oversized rewards to an integer accumulator.
    while (experience > 0 && monster.level < static_cast<int>(config.levels.size())) {
        const int needed = stats(monster, config).nextExperience - monster.experience;
        const int granted = std::min(needed, experience);
        monster.experience += granted;
        experience -= granted;
        if (monster.experience < stats(monster, config).nextExperience) {
            break;
        }
        const double healthRatio = monster.maxHp > 0 ? std::clamp(monster.hp / monster.maxHp, 0.0, 1.0) : 0;
        monster.experience = 0;
        ++monster.level;
        monster.maxHp = stats(monster, config).maxHp;
        // Leveling preserves injury percentage and cannot revive a defeated enemy.
        monster.hp = monster.maxHp * healthRatio;
    }
    return monster.level - previous;
}
int LogicProgression::advanceTime(Monster& monster, double dt, const EnemyConfig& config) {
    if (!std::isfinite(dt) || dt <= 0 || dt > .25 || monster.level >= static_cast<int>(config.levels.size())) {
        return 0;
    }
    monster.experienceRemainder += dt * config.timeExperience;
    const int whole = static_cast<int>(std::floor(monster.experienceRemainder + 1e-9));
    monster.experienceRemainder = std::max(0.0, monster.experienceRemainder - whole);
    return grant(monster, whole, config);
}
} // namespace snackshop
