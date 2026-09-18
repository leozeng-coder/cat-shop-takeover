#ifndef SNACKSHOP_NET_SESSION_H
#define SNACKSHOP_NET_SESSION_H
#include "game/game.h"
#include "state_stream.h"
#include <array>
#include <chrono>
#include <drogon/WebSocketConnection.h>
#include <memory>
namespace snackshop {
using Clock = std::chrono::steady_clock;
struct Session {
    std::string token, code, configVersion;
    int seat = -1;
    std::uint64_t lastSequence = 0;
    std::string lastActionError;
    StateCursor cursor;
    std::weak_ptr<drogon::WebSocketConnection> connection;
    Clock::time_point lastSeen = Clock::now(), rateWindow = Clock::now();
    Clock::time_point lastResync{};
    int messages = 0;
};
struct Match {
    std::shared_ptr<Game> game;
    StateStream stream;
    std::array<std::weak_ptr<Session>, Seats> sessions;
    std::array<Json::Value, Seats> personal;
    Clock::time_point lastOccupied = Clock::now();
};

} // namespace snackshop
#endif
