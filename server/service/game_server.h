#ifndef SNACKSHOP_GAME_SERVER_H
#define SNACKSHOP_GAME_SERVER_H
#include "net/net_session.h"
#include <json/json.h>
#include <mutex>
#include <unordered_map>
namespace snackshop {
class GameServer {
public:
    void handle(const drogon::WebSocketConnectionPtr& connection, const Json::Value& message);
    void close(const drogon::WebSocketConnectionPtr& connection);
    void update();
    int roomCount() const;

private:
    void broadcast(const Game& game);
    void detach(const drogon::WebSocketConnectionPtr& connection, bool leave);
    void attach(const drogon::WebSocketConnectionPtr& connection, const std::shared_ptr<Session>& session);
    mutable std::mutex m_mutex;
    std::unordered_map<std::string, Match> m_matches;
    std::unordered_map<std::string, std::shared_ptr<Session>> m_sessions;
    std::unordered_map<const drogon::WebSocketConnection*, std::shared_ptr<Session>> m_connections;
    Clock::time_point m_lastUpdate = Clock::now();
    Clock::time_point m_lastBroadcast = Clock::now();
    double m_stepRemainder = 0;
};
} // namespace snackshop
#endif
