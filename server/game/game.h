#ifndef SNACKSHOP_GAME_H
#define SNACKSHOP_GAME_H
#include "map/grid_map.h"
#include <random>
namespace snackshop {
class Game {
public:
    explicit Game(std::string code, int capacity, std::uint32_t seed, Balance balance = {});
    std::string code;
    int capacity, host = -1;
    std::string phase = "lobby";
    GridMap map;
    std::array<Player, Seats> players;
    std::array<Dorm, Seats> dorms;
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
    std::string start(int id);
    std::string rematch(int id);
    std::string command(int id, GameAction action, int room = -1, int cell = -1, PropKind kind = PropKind::Launcher);
    void step(double dt);
    void notify(const std::string& message);
    int income(const Player& player) const;
    bool walkable(int cell, int player = -1, int startingRoom = -1) const;
    const Prop* propAt(int cell) const;
    std::deque<Point> pathTo(Point from, int cell, int player = -1) const;
    bool moveAlong(Point& position, std::deque<Point>& path, double distance, int player = -1) const;

private:
    friend class LogicCatAi;
    friend class LogicEnemy;
    std::mt19937 m_random;
    double m_incomeAccumulator = 0;
    std::uint64_t m_noticeId = 0;
    bool validPlayer(int id) const;
    void resetBoard();
    void arrive(Player& player);
    bool buildKeepsAccess(const Dorm& room, int cell) const;
};
} // namespace snackshop
#endif
