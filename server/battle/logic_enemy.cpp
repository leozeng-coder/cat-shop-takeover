#include "logic_enemy.h"
#include "ai/manager_behavior.h"
#include "item/logic_item.h"
#include "logic_progression.h"
#include <algorithm>
namespace snackshop {
void LogicEnemy::update(Game& game, double dt) {
    if (game.phase != "running") {
        stop(game);
        return;
    }
    auto& m = game.monster;
    const double combatTime = std::min(dt, std::max(0.0, game.elapsed - game.balance.preparation));
    if (LogicProgression::advanceTime(m, combatTime, game.config().enemy) > 0) {
        game.notify("店长随时间成长，升至 Lv." + std::to_string(m.level));
    }
    m.attackCooldown = std::max(0.0, m.attackCooldown - dt);
    if (m.state != "retreating" && m.state != "defeated" && m.state != "resting") {
        LogicItem::updateAttack(game, dt);
    }
    ManagerAiContext context{game, game.m_random, dt};
    ManagerBehavior::tree().tick(context, m.behavior);
    const auto& ai = game.config().managerAi;
    if (m.hp > 0 && m.state != "resting" && m.state != "defeated") {
        // Heal only the part of this tick after the combat grace period has elapsed.
        const double healingTime = std::clamp(game.elapsed - m.lastCombatAt - ai.outOfCombatDelay, 0.0, dt);
        m.hp = std::min(m.maxHp, m.hp + m.maxHp * ai.outOfCombatHealing * healingTime);
    }
}
void LogicEnemy::stop(Game& game) {
    ManagerAiContext context{game, game.m_random, 0};
    ManagerBehavior::tree().halt(context, game.monster.behavior);
    game.monster.behavior = {};
    game.monster.path.clear();
    ManagerBehavior::clearAttack(game);
}
} // namespace snackshop
