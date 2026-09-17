#ifndef SNACKSHOP_GAME_MATH_H
#define SNACKSHOP_GAME_MATH_H
#include "game/game_types.h"
#include <cmath>
namespace snackshop {
namespace GameMath {

inline double distance(Point a, Point b) {
    return std::hypot(a.x - b.x, a.y - b.y);
}
inline bool approach(Point& from, Point to, double step) {
    const double length = distance(from, to);
    if (length <= step) {
        from = to;
        return true;
    }
    from.x += (to.x - from.x) / length * step;
    from.y += (to.y - from.y) / length * step;
    return false;
}

} // namespace GameMath
} // namespace snackshop
#endif
