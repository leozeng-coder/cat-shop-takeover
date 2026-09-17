#ifndef SNACKSHOP_GAME_SNAPSHOT_H
#define SNACKSHOP_GAME_SNAPSHOT_H
#include "game/game.h"
#include <json/json.h>
namespace snackshop {
namespace GameSnapshot {
Json::Value encode(const Game& game, int viewer);
}
} // namespace snackshop
#endif
