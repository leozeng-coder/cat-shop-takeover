#ifndef SNACKSHOP_NET_HANDLER_GAME_H
#define SNACKSHOP_NET_HANDLER_GAME_H
#include "game_protocol.h"
#include "service/game_server.h"
#include <drogon/HttpAppFramework.h>
#include <drogon/WebSocketController.h>
namespace snackshop {
class NetHandlerGame : public drogon::WebSocketController<NetHandlerGame, false> {
public:
    explicit NetHandlerGame(std::shared_ptr<GameServer> server) : m_server(std::move(server)) {}

    void handleNewMessage(const drogon::WebSocketConnectionPtr& connection, std::string&& message, const drogon::WebSocketMessageType& type) override {
        if (type != drogon::WebSocketMessageType::Text) {
            return;
        }
        if (message.size() > 4096) {
            GameProtocol::error(connection, "消息过长");
            return;
        }
        Json::CharReaderBuilder builder;
        builder["rejectDupKeys"] = true;
        std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
        Json::Value msg;
        std::string parseError;
        if (!reader->parse(message.data(), message.data() + message.size(), &msg, &parseError) || !msg.isObject()) {
            GameProtocol::error(connection, "消息格式无效");
            return;
        }
        const auto request = GameProtocol::decodeRequest(msg);
        if (!request) {
            GameProtocol::error(connection, "协议版本或消息格式无效，请刷新页面");
            return;
        }
        // Commands and simulation ticks must share one sender. Mixing direct I/O-thread
        // sends with queued simulation-thread sends can reorder dependent delta frames.
        drogon::app().getLoop()->queueInLoop([server = m_server, connection, request = *request] {
            if (!connection->connected()) {
                return;
            }
            try {
                server->handle(connection, request);
            } catch (const std::exception&) {
                GameProtocol::reply(connection, request, "操作无效，请重试");
            }
        });
    }
    void handleNewConnection(const drogon::HttpRequestPtr&, const drogon::WebSocketConnectionPtr& connection) override {
        Json::Value hello;
        hello["type"] = "hello";
        hello["version"] = GameProtocol::Version;
        hello["heartbeatMs"] = 10000;
        hello["timeoutMs"] = 30000;
        GameProtocol::send(connection, hello);
    }
    void handleConnectionClosed(const drogon::WebSocketConnectionPtr& connection) override {
        drogon::app().getLoop()->queueInLoop([server = m_server, connection] { server->close(connection); });
    }
    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/ws");
    WS_PATH_LIST_END

private:
    std::shared_ptr<GameServer> m_server;
};
} // namespace snackshop
#endif
