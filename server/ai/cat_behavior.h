#ifndef SNACKSHOP_CAT_BEHAVIOR_H
#define SNACKSHOP_CAT_BEHAVIOR_H
#include "behavior_tree.h"
#include "game/game.h"
namespace snackshop {
struct CatAiContext {
    Game& game;
    Player& cat;
    std::mt19937& random;
    int buildAttempts = 0;
    const AiProfile& profile() const { return game.config().catAi.profiles[cat.personality]; }
};
class CatBehavior {
public:
    static const bt::Tree<CatAiContext>& tree();
    static int danger(const Game& game, const Player& cat);
};
} // namespace snackshop
#endif
