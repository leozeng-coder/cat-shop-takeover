#ifndef SNACKSHOP_GAME_PROTOCOL_H
#define SNACKSHOP_GAME_PROTOCOL_H
#include "game/game_types.h"
#include <drogon/WebSocketConnection.h>
#include <json/json.h>
#include <optional>
namespace snackshop {
namespace GameProtocol {
std::string encode(const Json::Value& value);
void send(const drogon::WebSocketConnectionPtr& connection, const Json::Value& value);
void error(const drogon::WebSocketConnectionPtr& connection, const std::string& message);
std::string stringField(const Json::Value& value, const char* key, const std::string& fallback = "");
int intField(const Json::Value& value, const char* key, int fallback = -1);
std::string playerName(const Json::Value& value);
std::optional<GameAction> parseAction(const Json::Value& value);

} // namespace GameProtocol
} // namespace snackshop
#endif
