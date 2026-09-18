#include "game_protocol.h"
#include <algorithm>
#include <utility>
namespace snackshop::GameProtocol {
std::optional<Request> decodeRequest(const Json::Value& value) {
    if (!value.isObject() || value["v"] != Version || value["kind"] != 1 || !value["cmd"].isInt() ||
        !value["id"].isUInt() || value["id"].asUInt() == 0 || !value["body"].isObject()) {
        return std::nullopt;
    }
    static constexpr const char* names[] = {"",      "ping",  "create",  "join",   "resume", "ready",
                                            "start", "leave", "rematch", "action", "resync"};
    const int command = value["cmd"].asInt();
    if (command < 1 || command > static_cast<int>(Command::Resync)) {
        return std::nullopt;
    }
    auto body = value["body"];
    body["type"] = names[command];
    return Request{static_cast<Command>(command), value["id"].asUInt(), std::move(body)};
}
std::string encode(const Json::Value& value) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    builder["emitUTF8"] = true;
    return Json::writeString(builder, value);
}
void notifyEncoded(const drogon::WebSocketConnectionPtr& connection, Notification command, const std::string& body) {
    if (connection && connection->connected()) {
        connection->send("{\"v\":2,\"kind\":3,\"cmd\":" + std::to_string(static_cast<int>(command)) +
                         ",\"body\":" + body + "}");
    }
}
void send(const drogon::WebSocketConnectionPtr& connection, const Json::Value& value) {
    const auto type = stringField(value, "type");
    Notification command;
    if (type == "hello") {
        command = Notification::Hello;
    } else if (type == "joined") {
        command = Notification::Joined;
    } else if (type == "config") {
        command = Notification::Config;
    } else if (type == "left") {
        command = Notification::Left;
    } else if (type == "expired") {
        command = Notification::Expired;
    } else if (type == "error") {
        command = Notification::Error;
    } else {
        return;
    }
    auto body = value;
    body.removeMember("type");
    notifyEncoded(connection, command, encode(body));
}
void reply(const drogon::WebSocketConnectionPtr& connection, const Request& request, const std::string& error) {
    if (!connection || !connection->connected()) {
        return;
    }
    Json::Value packet;
    packet["v"] = Version;
    packet["kind"] = 2;
    packet["cmd"] = static_cast<int>(request.command);
    packet["id"] = request.requestId;
    packet["code"] = error.empty() ? 0 : 1;
    packet["message"] = error;
    connection->send(encode(packet));
}
void error(const drogon::WebSocketConnectionPtr& connection, const std::string& message) {
    Json::Value value;
    value["type"] = "error";
    value["message"] = message;
    send(connection, value);
}
std::string stringField(const Json::Value& value, const char* key, const std::string& fallback) {
    return value[key].isString() ? value[key].asString() : fallback;
}
int intField(const Json::Value& value, const char* key, int fallback) {
    return value[key].isInt() ? value[key].asInt() : fallback;
}
std::string playerName(const Json::Value& value) {
    auto name = stringField(value, "name", "访客");
    if (name.empty() || name.size() > 48) {
        name = "访客";
    }
    name.erase(std::remove_if(name.begin(), name.end(), [](unsigned char c) { return c < 32 || c == 127; }),
               name.end());
    return name.empty() ? "访客" : name;
}

std::optional<GameAction> parseAction(const Json::Value& value) {
    const auto action = stringField(value, "action");
    if (action == "move") {
        return GameAction::Move;
    }
    if (action == "nest") {
        return GameAction::EnterNest;
    }
    if (action == "bed") {
        return GameAction::UpgradeNest;
    }
    if (action == "door") {
        return GameAction::UpgradeBarricade;
    }
    if (action == "build") {
        return GameAction::Build;
    }
    if (action == "repair") {
        return GameAction::Repair;
    }
    return std::nullopt;
}

} // namespace snackshop::GameProtocol
