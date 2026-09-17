#ifndef SNACKSHOP_GAME_CONFIG_H
#define SNACKSHOP_GAME_CONFIG_H
#include <array>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>
namespace snackshop {
constexpr int Seats = 6;
constexpr int MapWidth = 44;
constexpr int MapHeight = 36;
constexpr int TileSize = 32;
struct Balance {
    double preparation = 30, duration = 300, reconnectGrace = 5;
};
struct CurrencyAmount {
    std::string currency;
    int amount = 0;
};
using Cost = std::vector<CurrencyAmount>;
using Wallet = std::map<std::string, int>;
struct CurrencyConfig {
    std::string id, name, symbol;
    int initial = 0, limit = 999999;
};
struct Requirements {
    int doorStage = 0, nestLevel = 0;
};
struct LevelConfig {
    int level = 1, nextLevel = 0;
    Cost cost;
    Requirements requirements;
    int amount = 0, intervalMs = 1000;
    double range = 0;
};
struct DoorConfig {
    std::string id, name, appearance;
    int stage = 1, displayLevel = 1, nextStage = 0, health = 0;
    Cost cost;
    Requirements requirements;
    std::string displayName() const;
};
struct NestConfig : LevelConfig {
    std::string currency;
};
enum class ItemBehavior { Obstacle, Pickup, CurrencyProducer, SingleAttack, DoorRepair };
struct ItemConfig {
    std::string id, name, category, appearance, currency;
    ItemBehavior behavior = ItemBehavior::Obstacle;
    bool buildable = false;
    std::vector<LevelConfig> levels;
};
struct EnemyLevelStats {
    int maxHp = 0, doorDamage = 0;
    double speed = 0;
    int nextRage = 0;
    std::string levelUpAnnouncement;
};
struct EnemyConfig {
    int timeRage = 0, doorRage = 0;
    double damageRageMultiplier = 0, levelUpHealRatio = 0;
    double attackInterval = 0, captureRange = 0, restDuration = 0, recoveryDuration = 0;
    Cost retreatReward;
    std::vector<EnemyLevelStats> levels;
};
struct RepairConfig {
    Cost cost;
    int amount = 0;
    double cooldown = 0;
};
enum class AiPreference { Economy, Defense, Attack };
struct AiProductionTarget {
    std::string currency;
    int count = 0;
};
struct AiProfile {
    std::string id;
    AiPreference preference = AiPreference::Economy;
    Cost reserve;
    int attackCount = 0, repairCount = 0;
    std::vector<AiProductionTarget> producers;
};
struct CatAiConfig {
    double decisionInterval = 0, decisionJitter = 0, dangerInterval = 0;
    double startDelay = 0, seatDelay = 0, moveTimeout = 0, escapeRepath = 0;
    double repairThreshold = 0, dangerRadius = 0;
    int escapeCandidates = 0, buildAttempts = 0;
    std::vector<AiProfile> profiles;
};
struct ManagerAiConfig {
    double targetInterval = 0, targetHold = 0, switchMargin = 0;
    double attackWeight = 0, doorHealthWeight = 0, distanceWeight = 0, randomWeight = 0;
    double retreatHealth = 0, resumeHealth = 0, outOfCombatDelay = 0, outOfCombatHealing = 0;
    double retreatSpeed = 0, repathInterval = 0;
};
struct GameConfig {
    std::string version;
    Balance balance;
    double catSpeed = 0;
    std::vector<CurrencyConfig> currencies;
    std::vector<DoorConfig> doors;
    std::vector<NestConfig> nests;
    std::map<std::string, ItemConfig> items;
    std::vector<std::string> initialItems;
    std::string pickupItem;
    EnemyConfig enemy;
    RepairConfig repair;
    CatAiConfig catAi;
    ManagerAiConfig managerAi;
    const CurrencyConfig& currency(const std::string& id) const;
    const DoorConfig& door(int stage) const;
    const NestConfig& nest(int level) const;
    const ItemConfig& item(const std::string& id) const;
};
const char* behaviorName(ItemBehavior behavior);
} // namespace snackshop
#endif
