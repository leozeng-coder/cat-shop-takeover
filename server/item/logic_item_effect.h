#ifndef SNACKSHOP_LOGIC_ITEM_EFFECT_H
#define SNACKSHOP_LOGIC_ITEM_EFFECT_H
#include "game/game.h"
#include <string>
namespace snackshop {
struct ItemEffectResult {
    bool applied = false;
    std::string description;
};
class LogicItemEffect {
public:
    // Executes the configured effect. The caller owns the prop and decides when to consume it.
    static ItemEffectResult apply(Game& game, Player& player, const ItemConfig& item, const ItemLevelConfig& level,
                                  int count = 1);
};
} // namespace snackshop
#endif
