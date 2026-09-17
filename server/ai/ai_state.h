#ifndef SNACKSHOP_AI_STATE_H
#define SNACKSHOP_AI_STATE_H
#include "behavior_tree.h"
namespace snackshop {
struct CatAiState {
    bt::Runtime tree;
    bool active = false, ownsMovement = false;
    int danger = 0, targetRoom = -1, targetCell = -1, buildCursor = 0;
    double moveDeadline = 0, repathAt = 0;
};
} // namespace snackshop
#endif
