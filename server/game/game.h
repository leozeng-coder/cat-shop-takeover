#ifndef SNACKSHOP_GAME_H
#define SNACKSHOP_GAME_H
#include "map/grid_map.h"
#include <random>
namespace snackshop {
class Game {
public:
    explicit Game(std::string code, int capacity, std::uint32_t seed, std::shared_ptr<const GameConfig> config, std::string selectedMap = "");
    std::string code;
    std::string selectedMap;
    int capacity, host = -1;
    std::string phase = "lobby";
    GridMap map;
    std::array<Player, Seats> players;
    std::vector<Dorm> dorms;
    Monster monster;
    std::deque<Notice> notices;
    double elapsed = 0, lobbyAge = 0;
    std::uint64_t tick = 0;
    Balance balance;
    int humanCount() const;
    int minimumHumans() const;
    int addHuman(const std::string& name);
    void removeHuman(int id);
    void setConnected(int id, bool connected);
    std::string setReady(int id, bool ready);
    std::string selectMap(int id, const std::string& mapId);
    std::string start(int id);
    std::string rematch(int id, std::shared_ptr<const GameConfig> nextConfig = {});
    std::string command(int id, GameAction action, int room = -1, int cell = -1, const std::string& kind = "launcher");
    void step(double dt);
    void notify(const std::string& message);
    double income(const Player& player, const std::string& currency = "cans") const;
    bool isEscaping(const Player& player) const;
    bool validRoom(int id) const { return id >= 0 && id < static_cast<int>(dorms.size()); }
    const GameConfig& config() const { return *m_config; }
    std::string purchaseError(int player, const Cost& cost, const Requirements& requirements = {}) const;
    std::string itemPurchaseError(int player, const ItemConfig& item, int level) const;
    std::string nestUpgradeError(int player) const;
    std::string doorUpgradeError(int player) const;
    std::string repairError(int player, int room) const;
    bool walkable(int cell, int player = -1, int startingRoom = -1) const;
    const Prop* propAt(int cell) const;
    std::deque<Point> pathTo(Point from, int cell, int player = -1) const;
    bool moveAlong(Point& position, std::deque<Point>& path, double distance, int player = -1) const;

private:
    friend class LogicCatAi;
    friend class LogicEnemy;
    std::shared_ptr<const GameConfig> m_config;
    std::mt19937 m_random;
    std::uint64_t m_noticeId = 0;
    bool validPlayer(int id) const;
    void resetBoard();
    void arrive(Player& player);
};
} // namespace snackshop
#endif
