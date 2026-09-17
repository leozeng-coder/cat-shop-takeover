#ifndef SNACKSHOP_LOGIC_COMBAT_H
#define SNACKSHOP_LOGIC_COMBAT_H
#include "game/game.h"
namespace snackshop {
class LogicCombat {
public:
    static bool hitDoor(Game& game, int room);
    static bool catchCat(Game& game, int player);
    static bool catInRange(const Game& game, int player);

private:
    static bool active(const Game& game);
    static void capture(Game& game, int player);
};
} // namespace snackshop
#endif
