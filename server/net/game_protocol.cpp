#include "game_protocol.h"
#include <algorithm>
namespace snackshop::GameProtocol {
std::string encode(const Json::Value& value) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    return Json::writeString(builder, value);
}
void send(const drogon::WebSocketConnectionPtr& connection, const Json::Value& value) {
    if (connection && connection->connected()) {
        connection->send(encode(value));
    }
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
