#ifndef SNACKSHOP_MANAGER_BEHAVIOR_H
#define SNACKSHOP_MANAGER_BEHAVIOR_H
#include "behavior_tree.h"
#include "game/game.h"
namespace snackshop {
struct ManagerAiContext {
    Game& game;
    std::mt19937& random;
    double dt;
};
class ManagerBehavior {
public:
    static const bt::Tree<ManagerAiContext>& tree();
    static void clearAttack(Game& game);
};
} // namespace snackshop
#endif
