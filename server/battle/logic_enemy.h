#ifndef SNACKSHOP_LOGIC_ENEMY_H
#define SNACKSHOP_LOGIC_ENEMY_H
#include "game/game.h"
namespace snackshop {
class LogicEnemy {
public:
    static void update(Game& game, double dt);
    static void stop(Game& game);
};
} // namespace snackshop
#endif
