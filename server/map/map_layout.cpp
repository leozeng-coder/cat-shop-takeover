#include "map_layout.h"
#include <algorithm>
namespace snackshop {
bool roomFloorContains(int shape, int width, int height, int x, int y) {
    switch (shape) {
    case 1:
        return !(x >= width / 2 && y >= height / 2); // L
    case 2:
        return !(x >= width - 2 && y >= height - 2); // Corner recess
    case 3:
        return !((x < 2 && y < 2) || (x >= width - 2 && y >= height - 2)); // Steps
    case 4:
        return !(y >= 2 && (x < 1 || x >= width - 1)); // T
    case 5:
        return !(x >= 2 && x < width - 2 && y < height - 2); // U
    default:
        return true;
    }
}
std::vector<RoomFootprint> roomFootprints(const MapProfileConfig& profile, int plotWidth, int plotHeight) {
    const int shapes = profile.complexity == 0 ? 1 : profile.complexity == 1 ? 3 : profile.complexity == 2 ? 5 : 6;
    std::vector<RoomFootprint> result;
    for (int h = profile.minRoomHeight; h <= std::min(profile.maxRoomHeight, plotHeight); ++h) {
        for (int w = profile.minRoomWidth; w <= std::min(profile.maxRoomWidth, plotWidth); ++w) {
            for (int shape = 0; shape < shapes; ++shape) {
                int area = 0;
                for (int y = 0; y < h - 2; ++y) {
                    for (int x = 0; x < w - 2; ++x) {
                        area += roomFloorContains(shape, w - 2, h - 2, x, y);
                    }
                }
                if (area >= profile.minRoomArea && area <= profile.maxRoomArea) {
                    result.push_back({w, h, shape});
                }
            }
        }
    }
    return result;
}
} // namespace snackshop
