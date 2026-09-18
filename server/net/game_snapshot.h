#ifndef SNACKSHOP_GAME_SNAPSHOT_H
#define SNACKSHOP_GAME_SNAPSHOT_H
#include "game/game.h"
#include <json/json.h>
namespace snackshop {
namespace GameSnapshot {
Json::Value catalog(const GameConfig& config);
Json::Value maps(const GameConfig& config);
Json::Value world(const Game& game);
Json::Value personal(const Game& game, int viewer);
} // namespace GameSnapshot
} // namespace snackshop
#endif
