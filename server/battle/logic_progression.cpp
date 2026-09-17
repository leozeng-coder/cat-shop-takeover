#include "logic_progression.h"
#include <algorithm>
#include <cmath>
namespace snackshop {
const EnemyLevelStats& LogicProgression::stats(const Monster& monster, const EnemyConfig& config) {
    return config.levels[monster.level - 1];
}
int LogicProgression::grant(Monster& monster, double rage, const EnemyConfig& config) {
    if (!std::isfinite(rage) || rage <= 0 || monster.level >= static_cast<int>(config.levels.size())) {
        return 0;
    }
    rage += monster.rageRemainder;
    const double whole = std::floor(rage + 1e-9);
    monster.rageRemainder = std::max(0.0, rage - whole);
    rage = whole;
    const int previous = monster.level;
    // Bound each conversion by the level threshold, even for large damage multipliers.
    while (rage > 0 && monster.level < static_cast<int>(config.levels.size())) {
        const int needed = stats(monster, config).nextRage - monster.rage;
        const int granted = static_cast<int>(std::min(static_cast<double>(needed), rage));
        monster.rage += granted;
        rage -= granted;
        if (monster.rage < stats(monster, config).nextRage) {
            break;
        }
        const double before = monster.hp;
        monster.rage = 0;
        ++monster.level;
        monster.maxHp = stats(monster, config).maxHp;
        // Heal against the new maximum without rescaling existing HP or reviving a defeated enemy.
        if (monster.hp > 0) {
            monster.hp = std::min(monster.maxHp, monster.hp + monster.maxHp * config.levelUpHealRatio);
        }
        monster.levelUps.push_back({monster.level, monster.hp - before});
    }
    if (monster.level == static_cast<int>(config.levels.size())) {
        monster.rageRemainder = 0;
    }
    return monster.level - previous;
}
int LogicProgression::advanceTime(Monster& monster, double dt, const EnemyConfig& config) {
    if (!std::isfinite(dt) || dt <= 0 || dt > .25 || monster.level >= static_cast<int>(config.levels.size())) {
        return 0;
    }
    return grant(monster, dt * config.timeRage, config);
}
} // namespace snackshop
