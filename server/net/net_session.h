#ifndef SNACKSHOP_NET_SESSION_H
#define SNACKSHOP_NET_SESSION_H
#include "game/game.h"
#include <chrono>
#include <drogon/WebSocketConnection.h>
#include <memory>
namespace snackshop {
using Clock = std::chrono::steady_clock;
struct Session {
    std::string token, code;
    int seat = -1;
    std::uint64_t lastSequence = 0;
    std::weak_ptr<drogon::WebSocketConnection> connection;
    Clock::time_point lastSeen = Clock::now(), rateWindow = Clock::now();
    int messages = 0;
};
struct Match {
    std::shared_ptr<Game> game;
    Clock::time_point lastOccupied = Clock::now();
};

} // namespace snackshop
#endif
