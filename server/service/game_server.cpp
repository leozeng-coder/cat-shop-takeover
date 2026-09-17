#include "game_server.h"
#include "net/game_protocol.h"
#include "net/game_snapshot.h"
#include <algorithm>
#include <cctype>
#include <drogon/utils/Utilities.h>
namespace snackshop {
void GameServer::broadcast(const Game& game) {
    for (const auto& [token, session] : m_sessions) {
        if (session->code != game.code) {
            continue;
        }
        if (const auto connection = session->connection.lock()) {
            GameProtocol::send(connection, GameSnapshot::encode(game, session->seat));
        }
    }
}
void GameServer::detach(const drogon::WebSocketConnectionPtr& connection, bool leave) {
    auto it = m_connections.find(connection.get());
    if (it == m_connections.end()) {
        return;
    }
    const auto session = it->second;
    const auto match = m_matches.find(session->code);
    if (match != m_matches.end()) {
        if (leave) {
            match->second.game->removeHuman(session->seat);
        } else {
            match->second.game->setConnected(session->seat, false);
        }
    }
    session->connection.reset();
    session->lastSeen = Clock::now();
    m_connections.erase(it);
    if (leave) {
        m_sessions.erase(session->token);
    }
    if (match != m_matches.end()) {
        broadcast(*match->second.game);
    }
}
void GameServer::attach(const drogon::WebSocketConnectionPtr& connection, const std::shared_ptr<Session>& session) {
    if (auto old = session->connection.lock(); old && old != connection) {
        m_connections.erase(old.get());
        old->shutdown();
    }
    session->connection = connection;
    session->lastSeen = Clock::now();
    m_connections[connection.get()] = session;
    Json::Value joined;
    joined["type"] = "joined";
    joined["token"] = session->token;
    joined["code"] = session->code;
    joined["you"] = session->seat;
    joined["lastSequence"] = Json::UInt64(session->lastSequence);
    GameProtocol::send(connection, joined);
}
void GameServer::handle(const drogon::WebSocketConnectionPtr& connection, const Json::Value& msg) {
    std::lock_guard lock(m_mutex);
    const auto kind = GameProtocol::stringField(msg, "type");
    auto connected = m_connections.find(connection.get());
    if (connected != m_connections.end()) {
        auto& s = *connected->second;
        const auto now = Clock::now();
        if (now - s.rateWindow >= std::chrono::seconds(1)) {
            s.rateWindow = now;
            s.messages = 0;
        }
        if (++s.messages > 60) {
            GameProtocol::error(connection, "操作过于频繁");
            return;
        }
        s.lastSeen = now;
    }
    if (kind == "ping") {
        Json::Value pong;
        pong["type"] = "pong";
        GameProtocol::send(connection, pong);
        return;
    }
    if (kind == "create" || kind == "join" || kind == "resume") {
        if (connected != m_connections.end()) {
            GameProtocol::error(connection, "请先离开当前对局");
            return;
        }
        if (kind == "resume") {
            auto it = m_sessions.find(GameProtocol::stringField(msg, "token"));
            if (it == m_sessions.end() || m_matches.find(it->second->code) == m_matches.end()) {
                Json::Value expired;
                expired["type"] = "expired";
                GameProtocol::send(connection, expired);
                return;
            }
            attach(connection, it->second);
            const auto game = m_matches.at(it->second->code).game;
            game->setConnected(it->second->seat, true);
            broadcast(*game);
            return;
        }
        std::shared_ptr<Game> game;
        if (kind == "create") {
            const int capacity = GameProtocol::intField(msg, "capacity");
            if (capacity != 1 && capacity != 2 && capacity != 6) {
                GameProtocol::error(connection, "请选择有效模式");
                return;
            }
            if (m_matches.size() >= 100) {
                GameProtocol::error(connection, "当前对局较多，请稍后重试");
                return;
            }
            std::string code;
            do {
                code = drogon::utils::getUuid().substr(0, 6);
                std::transform(code.begin(), code.end(), code.begin(),
                               [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
            } while (m_matches.contains(code));
            game = std::make_shared<Game>(code, capacity, std::random_device{}());
            m_matches.emplace(code, Match{game});
        } else {
            std::string code = GameProtocol::stringField(msg, "code");
            std::transform(code.begin(), code.end(), code.begin(),
                           [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
            const auto match = m_matches.find(code);
            if (match == m_matches.end()) {
                GameProtocol::error(connection, "邀请码不存在或对局已结束");
                return;
            }
            game = match->second.game;
        }
        const int seat = game->addHuman(GameProtocol::playerName(msg));
        if (seat < 0) {
            GameProtocol::error(connection, "对局已开始或真人席位已满");
            return;
        }
        auto session = std::make_shared<Session>();
        session->token = drogon::utils::getUuid();
        session->code = game->code;
        session->seat = seat;
        m_sessions[session->token] = session;
        attach(connection, session);
        broadcast(*game);
        return;
    }
    if (connected == m_connections.end()) {
        GameProtocol::error(connection, "请先创建或加入对局");
        return;
    }
    const auto session = connected->second;
    const auto match = m_matches.find(session->code);
    if (match == m_matches.end()) {
        GameProtocol::error(connection, "对局已结束");
        return;
    }
    auto& game = *match->second.game;
    std::string failure;
    if (kind == "leave") {
        detach(connection, true);
        Json::Value left;
        left["type"] = "left";
        GameProtocol::send(connection, left);
        return;
    }
    if (kind == "ready") {
        if (!msg["ready"].isBool()) {
            failure = "准备状态无效";
        } else {
            failure = game.setReady(session->seat, msg["ready"].asBool());
        }
    } else if (kind == "start") {
        failure = game.start(session->seat);
    } else if (kind == "rematch") {
        failure = game.rematch(session->seat);
    } else if (kind == "action") {
        if (!msg["seq"].isUInt64() || msg["seq"].asUInt64() == 0) {
            GameProtocol::error(connection, "操作序号无效");
            return;
        }
        const auto sequence = msg["seq"].asUInt64();
        if (sequence <= session->lastSequence) {
            return;
        }
        if (sequence > session->lastSequence + 10000) {
            GameProtocol::error(connection, "操作序号超出范围");
            return;
        }
        session->lastSequence = sequence;
        const auto action = GameProtocol::parseAction(msg);
        if (!action) {
            failure = "未知操作";
        } else {
            failure = game.command(session->seat, *action, GameProtocol::intField(msg, "room"),
                                   GameProtocol::intField(msg, "cell"),
                                   GameProtocol::stringField(msg, "kind") == "pantry"     ? PropKind::Pantry
                                   : GameProtocol::stringField(msg, "kind") == "repair"   ? PropKind::Repair
                                   : GameProtocol::stringField(msg, "kind") == "launcher" ? PropKind::Launcher
                                                                                          : PropKind::Shelf);
        }
    } else {
        failure = "未知消息";
    }
    if (!failure.empty()) {
        GameProtocol::error(connection, failure);
    }
    broadcast(game);
}
void GameServer::update() {
    std::lock_guard lock(m_mutex);
    const auto now = Clock::now();
    // The OS timer can fire late. Advance fixed simulation steps from actual wall
    // time, rather than slowing every cat and the 30-second clock with the timer.
    m_stepRemainder += std::min(.25, std::chrono::duration<double>(now - m_lastUpdate).count());
    m_lastUpdate = now;
    int steps = 0;
    while (m_stepRemainder >= .05) {
        m_stepRemainder -= .05;
        ++steps;
    }
    const bool snapshotDue = now - m_lastBroadcast >= std::chrono::milliseconds(100);
    if (snapshotDue) {
        m_lastBroadcast = now;
    }
    std::vector<std::string> expired;
    for (auto& [code, match] : m_matches) {
        for (int step = 0; step < steps; ++step) {
            match.game->step(.05);
        }
        bool occupied = false;
        for (const auto& p : match.game->players) {
            if (p.human && p.connected) {
                occupied = true;
            }
        }
        if (occupied) {
            match.lastOccupied = now;
        }
        if (now - match.lastOccupied > std::chrono::seconds(90)) {
            expired.push_back(code);
        } else if (snapshotDue) {
            broadcast(*match.game);
        }
    }
    for (const auto& code : expired) {
        m_matches.erase(code);
        std::erase_if(m_sessions, [&](const auto& item) { return item.second->code == code; });
    }
    std::vector<drogon::WebSocketConnectionPtr> stale;
    for (const auto& [key, session] : m_connections) {
        if (now - session->lastSeen > std::chrono::seconds(35)) {
            if (auto connection = session->connection.lock()) {
                stale.push_back(connection);
            }
        }
    }
    for (const auto& connection : stale) {
        detach(connection, false);
        connection->shutdown();
    }
}
void GameServer::close(const drogon::WebSocketConnectionPtr& connection) {
    std::lock_guard lock(m_mutex);
    detach(connection, false);
}
int GameServer::roomCount() const {
    std::lock_guard lock(m_mutex);
    return static_cast<int>(m_matches.size());
}

} // namespace snackshop
