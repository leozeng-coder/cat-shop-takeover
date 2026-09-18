#ifndef SNACKSHOP_GAME_PROTOCOL_H
#define SNACKSHOP_GAME_PROTOCOL_H
#include "game/game_types.h"
#include <drogon/WebSocketConnection.h>
#include <json/json.h>
#include <optional>
namespace snackshop {
namespace GameProtocol {
inline constexpr int Version = 2;
enum class Command : int { Ping = 1, Create, Join, Resume, Ready, Start, Leave, Rematch, Action, Resync };
enum class Notification : int { Hello = 100, Joined, Config, Snapshot, Delta, Left, Expired, Error };
struct Request {
    Command command;
    std::uint32_t requestId;
    Json::Value body;
};
std::optional<Request> decodeRequest(const Json::Value& value);
std::string encode(const Json::Value& value);
void notifyEncoded(const drogon::WebSocketConnectionPtr& connection, Notification command, const std::string& body);
void reply(const drogon::WebSocketConnectionPtr& connection, const Request& request, const std::string& error);
void send(const drogon::WebSocketConnectionPtr& connection, const Json::Value& value);
void error(const drogon::WebSocketConnectionPtr& connection, const std::string& message);
std::string stringField(const Json::Value& value, const char* key, const std::string& fallback = "");
int intField(const Json::Value& value, const char* key, int fallback = -1);
std::string playerName(const Json::Value& value);
std::optional<GameAction> parseAction(const Json::Value& value);

} // namespace GameProtocol
} // namespace snackshop
#endif
