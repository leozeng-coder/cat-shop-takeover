#include "logic_item_effect.h"
#include "game/logic_economy.h"
#include <algorithm>
#include <cstdint>
#include <limits>
namespace snackshop {
ItemEffectResult LogicItemEffect::apply(Game& game, Player& player, const ItemConfig& item,
                                        const ItemLevelConfig& level, int count) {
    if (count <= 0 || !player.alive || level.amount <= 0) {
        return {};
    }
    switch (item.behavior) {
    case ItemBehavior::Pickup:
    case ItemBehavior::CurrencyProducer: {
        if (item.currency.empty()) {
            return {};
        }
        const auto amount = static_cast<int>(
            std::min<std::int64_t>(static_cast<std::int64_t>(level.amount) * count, std::numeric_limits<int>::max()));
        LogicEconomy::credit(player, game.config(), item.currency, amount);
        if (item.behavior == ItemBehavior::Pickup) {
            return {true, "+" + std::to_string(amount) + " " + game.config().currency(item.currency).name};
        }
        return {true, {}};
    }
    default:
        return {};
    }
}
} // namespace snackshop
