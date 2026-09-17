#ifndef SNACKSHOP_GAME_TYPES_H
#define SNACKSHOP_GAME_TYPES_H
#include "config/combat_config.h"
#include "config/game_config.h"
#include <cstdint>
#include <deque>
#include <string>
#include <vector>
namespace snackshop {
struct Point {
    double x = 0;
    double y = 0;
};
enum class PropKind { Shelf, Crate, Launcher, Pantry, Repair };
struct Prop {
    int cell = -1;
    PropKind kind = PropKind::Shelf;
    int level = 1;
    double cooldown = 0;
    double lastShot = -100;
};
struct Dorm {
    int id = 0, owner = -1, level = 1;
    int door = -1, entrance = -1, nest = -1;
    double hp = DoorHealth[0];
    std::vector<int> floor;
    std::vector<Prop> props;
    bool doorClosed() const { return owner >= 0 && hp > 0; }
};
struct Player {
    int id = 0;
    std::string name;
    bool human = false, connected = false, ready = true, alive = true, sleeping = false;
    int room = -1, gold = 120, bed = 1, personality = 0, nestIntent = -1;
    Point position{};
    std::deque<Point> path;
    double decisionAt = 0, repairAt = 0, disconnectedFor = 0;
};
struct Monster {
    Point position{};
    std::deque<Point> path;
    double hp = EnemyLevels[0].maxHp, maxHp = EnemyLevels[0].maxHp;
    double attackCooldown = 0, restUntil = 0, repathAt = 0, experienceRemainder = 0;
    int experience = 0, doorHits = 0, attackingPlayer = -1;
    double attackStartedAt = -1;
    std::uint64_t attackSequence = 0;
    int target = -1, prey = -1, level = 1, raids = 0, destination = -1;
    std::string state = "waiting";
};
struct Notice {
    std::uint64_t id;
    double time;
    std::string text;
};
enum class GameAction { Move, EnterNest, UpgradeNest, UpgradeBarricade, Build, Repair };
} // namespace snackshop
#endif
