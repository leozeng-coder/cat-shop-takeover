#include "game_server.h"
#include "net/game_protocol.h"
#include "net/game_snapshot.h"
#include <algorithm>
#include <cctype>
#include <drogon/utils/Utilities.h>
#include <iostream>
namespace snackshop {
std::shared_ptr<const GameConfig> GameServer::latestConfig() {
    std::string error;
    if (!m_configs->reload(error)) {
        std::cerr << "Config reload rejected, keeping current version: " << error << std::endl;
    }
    return m_configs->current();
}
void GameServer::sendState(Match& match, Session& session) {
    const auto connection = session.connection.lock();
    if (!connection || !connection->connected()) {
        return;
    }
    const auto& game = *match.game;
    if (session.configVersion != game.config().version) {
        GameProtocol::send(connection, GameSnapshot::catalog(game.config()));
        session.configVersion = game.config().version;
    }
    const auto packet = match.stream.packet(session.cursor, match.personal[session.seat]);
    GameProtocol::notifyEncoded(connection,
                                packet.full ? GameProtocol::Notification::Snapshot : GameProtocol::Notification::Delta,
                                packet.body);
}
void GameServer::broadcast(Match& match) {
    // Room-local slots avoid scanning all sessions for every match. World encoding is shared.
    bool connected = false;
    for (const auto& slot : match.sessions) {
        if (const auto session = slot.lock(); session && !session->connection.expired()) {
            connected = true;
        }
    }
    if (!connected) {
        return;
    }
    match.stream.advance(GameSnapshot::world(*match.game));
    for (const auto& slot : match.sessions) {
        if (const auto session = slot.lock(); session && !session->connection.expired()) {
            match.personal[session->seat] = GameSnapshot::personal(*match.game, session->seat);
            sendState(match, *session);
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
        broadcast(match->second);
    }
}
void GameServer::attach(const drogon::WebSocketConnectionPtr& connection, const std::shared_ptr<Session>& session) {
    if (auto old = session->connection.lock(); old && old != connection) {
        m_connections.erase(old.get());
        old->shutdown();
    }
    session->connection = connection;
    session->configVersion.clear();
    session->cursor = {};
    session->lastSeen = Clock::now();
    m_connections[connection.get()] = session;
    m_matches.at(session->code).sessions[session->seat] = session;
    Json::Value joined;
    joined["type"] = "joined";
    joined["token"] = session->token;
    joined["code"] = session->code;
    joined["you"] = session->seat;
    joined["lastSequence"] = Json::UInt64(session->lastSequence);
    GameProtocol::send(connection, joined);
}
void GameServer::handle(const drogon::WebSocketConnectionPtr& connection, const GameProtocol::Request& request) {
    std::lock_guard lock(m_mutex);
    GameProtocol::reply(connection, request, dispatch(connection, request.body));
}
std::string GameServer::dispatch(const drogon::WebSocketConnectionPtr& connection, const Json::Value& msg) {
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
            return "操作过于频繁";
        }
        s.lastSeen = now;
    }
    if (kind == "ping") {
        return {};
    }
    if (kind == "characters") {
        Json::Value value;
        value["type"] = "characters";
        value["characters"] = GameSnapshot::characters(*m_configs->current());
        GameProtocol::send(connection, value);
        return {};
    }
    if (kind == "maps") {
        Json::Value value;
        value["type"] = "maps";
        value["maps"] = GameSnapshot::maps(*latestConfig());
        GameProtocol::send(connection, value);
        return {};
    }
    if (kind == "create" || kind == "join" || kind == "resume") {
        if (connected != m_connections.end()) {
            return "请先离开当前对局";
        }
        if (kind == "resume") {
            auto it = m_sessions.find(GameProtocol::stringField(msg, "token"));
            if (it == m_sessions.end() || m_matches.find(it->second->code) == m_matches.end()) {
                Json::Value expired;
                expired["type"] = "expired";
                GameProtocol::send(connection, expired);
                return {};
            }
            attach(connection, it->second);
            const auto game = m_matches.at(it->second->code).game;
            game->setConnected(it->second->seat, true);
            broadcast(m_matches.at(game->code));
            return {};
        }
        const auto readSelection = [&](const GameConfig& config) {
            const auto& value = msg["character"];
            if (value.isNull() && !msg.isMember("character")) {
                return config.defaultCharacter();
            }
            return CharacterSelection{GameProtocol::stringField(value, "character"),
                                      GameProtocol::stringField(value, "skin")};
        };
        if (msg.isMember("character") && !msg["character"].isObject()) {
            return "角色选择无效";
        }
        std::shared_ptr<Game> game;
        if (kind == "create") {
            const int capacity = GameProtocol::intField(msg, "capacity");
            if (capacity != 1 && capacity != 2 && capacity != 6) {
                return "请选择有效模式";
            }
            if (m_matches.size() >= 100) {
                return "当前对局较多，请稍后重试";
            }
            std::string code;
            do {
                code = drogon::utils::getUuid().substr(0, 6);
                std::transform(code.begin(), code.end(), code.begin(),
                               [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
            } while (m_matches.contains(code));
            const auto config = latestConfig();
            const auto mapId = GameProtocol::stringField(msg, "mapId");
            if ((msg.isMember("mapId") && !msg["mapId"].isString()) || (!mapId.empty() && !config->mapProfile(mapId))) {
                return "地图不存在或暂未开放";
            }
            if (!config->hasCharacter(readSelection(*config))) {
                return "角色或毛色暂未开放";
            }
            game = std::make_shared<Game>(code, capacity, std::random_device{}(), config, mapId);
            m_matches.emplace(code, Match{game});
        } else {
            std::string code = GameProtocol::stringField(msg, "code");
            std::transform(code.begin(), code.end(), code.begin(),
                           [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
            const auto match = m_matches.find(code);
            if (match == m_matches.end()) {
                return "邀请码不存在或对局已结束";
            }
            game = match->second.game;
        }
        const auto selection = readSelection(game->config());
        if (!game->config().hasCharacter(selection)) {
            return "角色或毛色暂未开放";
        }
        const int seat = game->addHuman(GameProtocol::playerName(msg));
        if (seat < 0) {
            return "对局已开始或真人席位已满";
        }
        game->selectCharacter(seat, selection);
        auto session = std::make_shared<Session>();
        session->token = drogon::utils::getUuid();
        session->code = game->code;
        session->seat = seat;
        m_sessions[session->token] = session;
        attach(connection, session);
        broadcast(m_matches.at(game->code));
        return {};
    }
    if (connected == m_connections.end()) {
        return "请先创建或加入对局";
    }
    const auto session = connected->second;
    const auto match = m_matches.find(session->code);
    if (match == m_matches.end()) {
        return "对局已结束";
    }
    auto& game = *match->second.game;
    if (kind == "resync") {
        const auto now = Clock::now();
        if (now - session->lastResync < std::chrono::seconds(1)) {
            return "同步请求过于频繁";
        }
        session->lastResync = now;
        session->cursor = {};
        session->configVersion.clear();
        // Rebase only this peer; subsequent deltas continue from the room's current revision.
        sendState(match->second, *session);
        return {};
    }
    std::string failure;
    if (kind == "leave") {
        detach(connection, true);
        Json::Value left;
        left["type"] = "left";
        GameProtocol::send(connection, left);
        return {};
    }
    if ((kind == "ready" || kind == "start") && msg.isMember("mapSeed") &&
        (!msg["mapSeed"].isUInt() || msg["mapSeed"].asUInt() != game.map.seed)) {
        return "地图已更换，请重新准备";
    }
    if (kind == "select_map") {
        failure = msg["mapId"].isString() ? game.selectMap(session->seat, msg["mapId"].asString()) : "地图选择无效";
    } else if (kind == "select_character") {
        const auto& value = msg["character"];
        if (!value.isObject() || !value["character"].isString() || !value["skin"].isString()) {
            failure = "角色选择无效";
        } else {
            failure = game.selectCharacter(session->seat, {value["character"].asString(), value["skin"].asString()});
        }
    } else if (kind == "ready") {
        if (!msg["ready"].isBool()) {
            failure = "准备状态无效";
        } else {
            failure = game.setReady(session->seat, msg["ready"].asBool());
        }
    } else if (kind == "start") {
        failure = game.start(session->seat);
    } else if (kind == "rematch") {
        if (session->seat == game.host && (game.phase == "won" || game.phase == "lost")) {
            failure = game.rematch(session->seat, latestConfig());
        } else {
            failure = game.rematch(session->seat);
        }
    } else if (kind == "action") {
        if (!msg["seq"].isUInt64() || msg["seq"].asUInt64() == 0 || msg["seq"].asUInt64() > 9007199254740991ULL) {
            return "操作序号无效";
        }
        const auto sequence = msg["seq"].asUInt64();
        if (sequence <= session->lastSequence) {
            return sequence == session->lastSequence ? session->lastActionError : std::string{};
        }
        if (sequence > session->lastSequence + 10000) {
            return "操作序号超出范围";
        }
        session->lastSequence = sequence;
        const auto action = GameProtocol::parseAction(msg);
        if (!action) {
            failure = "未知操作";
        } else {
            failure = game.command(session->seat, *action, GameProtocol::intField(msg, "room"),
                                   GameProtocol::intField(msg, "cell"), GameProtocol::stringField(msg, "kind"));
        }
    } else {
        failure = "未知消息";
    }
    if (kind == "action") {
        session->lastActionError = failure;
    } else if (failure.empty()) {
        broadcast(match->second);
    }
    return failure;
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
            broadcast(match);
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
