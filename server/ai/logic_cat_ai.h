#ifndef SNACKSHOP_LOGIC_CAT_AI_H
#define SNACKSHOP_LOGIC_CAT_AI_H
#include "game/game.h"
#include <string_view>
namespace snackshop {
class LogicCatAi {
public:
    static void update(Game& game, Player& player);
    static void stop(Game& game, Player& player);
    static std::string_view currentAction(const Player& player);
};
} // namespace snackshop
#endif
