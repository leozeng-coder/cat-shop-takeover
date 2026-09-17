#ifndef SNACKSHOP_LOGIC_CAT_AI_H
#define SNACKSHOP_LOGIC_CAT_AI_H
#include "game/game.h"
namespace snackshop {
class LogicCatAi {
public:
    static void update(Game& game, Player& player);
};
} // namespace snackshop
#endif
