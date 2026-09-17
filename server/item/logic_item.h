#ifndef SNACKSHOP_LOGIC_ITEM_H
#define SNACKSHOP_LOGIC_ITEM_H
#include "game/game.h"
namespace snackshop {
class LogicItem {
public:
    static void updatePassive(Game& game, double dt);
    static void updateAttack(Game& game, double dt);
    // Called for a validated closed door within the manager's attack range.
    static void updateDoorDefense(Game& game, Dorm& room);
};
} // namespace snackshop
#endif
