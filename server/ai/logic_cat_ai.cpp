#include "logic_cat_ai.h"
#include "cat_behavior.h"
namespace snackshop {
void LogicCatAi::update(Game& game, Player& p) {
    if (!p.alive || (p.human && (p.connected || p.disconnectedFor < game.balance.reconnectGrace)) ||
        (game.phase != "preparing" && game.phase != "running")) {
        stop(game, p);
        return;
    }
    const auto& rules = game.config().catAi;
    if (game.elapsed < rules.startDelay + p.id * rules.seatDelay) {
        return;
    }
    const int danger = CatBehavior::danger(game, p);
    const bool interrupted = p.ai.active && danger > p.ai.danger;
    if (!interrupted && game.elapsed < p.decisionAt) {
        return;
    }
    p.ai.active = true;
    p.ai.danger = danger;
    p.decisionAt = game.elapsed + (danger > 0 ? rules.dangerInterval
                                              : rules.decisionInterval + std::uniform_real_distribution<double>(
                                                                             0, rules.decisionJitter)(game.m_random));
    CatAiContext context{game, p, game.m_random};
    CatBehavior::tree().tick(context, p.ai.tree);
}
void LogicCatAi::stop(Game& game, Player& p) {
    if (!p.ai.active) {
        return;
    }
    CatAiContext context{game, p, game.m_random};
    CatBehavior::tree().halt(context, p.ai.tree);
    p.ai = {};
    p.decisionAt = 0;
}
std::string_view LogicCatAi::currentAction(const Player& p) {
    return CatBehavior::tree().lastAction(p.ai.tree);
}
} // namespace snackshop
