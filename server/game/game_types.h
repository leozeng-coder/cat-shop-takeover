#ifndef SNACKSHOP_GAME_TYPES_H
#define SNACKSHOP_GAME_TYPES_H
#include "ai/ai_state.h"
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
struct Prop {
    int cell = -1;
    std::string kind = "shelf";
    int level = 1;
    double cooldown = 0;
    double lastShot = -100;
    std::string rewardKind;
    int rewardLevel = 0;
    double revealStartedAt = 0, revealAt = 0;
};
struct Dorm {
    int id = 0, owner = -1, level = 1;
    int door = -1, entrance = -1, nest = -1;
    double hp = 0;
    double doorDefenseReadyAt = 0, attackDelayUntil = 0;
    std::vector<int> floor;
    std::vector<Prop> props;
    bool doorClosed() const { return owner >= 0 && hp > 0; }
};
struct Player {
    int id = 0;
    std::string name;
    CharacterSelection character;
    bool human = false, connected = false, ready = true, alive = true, sleeping = false;
    int room = -1, bed = 1, personality = 0, nestIntent = -1;
    Wallet wallet;
    // Successful consumable purchases belong to the seat and survive reconnect/AI takeover.
    std::map<std::string, int> itemPurchases;
    CatAiState ai;
    double productionRemainder = 0;
    Point position{};
    std::deque<Point> path;
    double decisionAt = 0, repairAt = 0, disconnectedFor = 0;
};
struct ManagerLevelUp {
    int level;
    double healed;
};
struct Monster {
    bt::Runtime behavior;
    double targetDecisionAt = 0, targetHoldUntil = 0, lastCombatAt = 0;
    Point position{};
    std::deque<Point> path;
    double hp = 0, maxHp = 0;
    double attackCooldown = 0, restUntil = 0, repathAt = 0, rageRemainder = 0;
    int rage = 0, doorHits = 0, attackingPlayer = -1;
    // One event per level, bounded by the configured level cap. Retained for snapshot catch-up.
    std::vector<ManagerLevelUp> levelUps;
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
