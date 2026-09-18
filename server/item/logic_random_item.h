#ifndef SNACKSHOP_LOGIC_RANDOM_ITEM_H
#define SNACKSHOP_LOGIC_RANDOM_ITEM_H
#include "game/game.h"
namespace snackshop {
class LogicRandomItem {
public:
    static int purchased(const Player& player, const std::string& item);
    static std::vector<const ItemConfig*> pool(const Game& game, int player);
    static std::string purchaseError(const Game& game, int player, const ItemConfig& item);
    // The command handler validates the empty owned cell before invoking the transaction.
    static std::string purchase(Game& game, int player, int cell, const ItemConfig& item, std::mt19937& random);
    static void update(Game& game);
};
} // namespace snackshop
#endif
