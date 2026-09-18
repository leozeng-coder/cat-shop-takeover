#ifndef SNACKSHOP_MAP_LAYOUT_H
#define SNACKSHOP_MAP_LAYOUT_H
#include "config/game_config.h"
namespace snackshop {
struct RoomFootprint {
    int width, height, shape;
};
// Shared by table validation and generation, so every accepted plot has a legal footprint.
bool roomFloorContains(int shape, int width, int height, int x, int y);
std::vector<RoomFootprint> roomFootprints(const MapProfileConfig& profile, int plotWidth, int plotHeight);
} // namespace snackshop
#endif
