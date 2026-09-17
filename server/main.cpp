#include "config/config_loader.h"
#include "net/net_handler_game.h"
#include "service/game_server.h"
#include <drogon/drogon.h>
#include <filesystem>
#include <iostream>
int main(int argc, char** argv) {
    int port = 8787;
    std::string bind = "127.0.0.1", web = "client/dist", configPath = "data/config";
    bool checkConfig = false;
    for (int i = 1; i < argc; ++i) {
        const std::string key = argv[i];
        if (key == "--check-config") {
            checkConfig = true;
            continue;
        }
        if (i + 1 >= argc) {
            std::cerr << "Missing value for " << key << '\n';
            return 2;
        }
        const char* argument = argv[++i];
        if (key == "--config") {
            configPath = argument;
        } else if (key == "--port") {
            port = std::stoi(argument);
        } else if (key == "--bind") {
            bind = argument;
        } else if (key == "--web") {
            web = argument;
        } else {
            std::cerr << "Unknown option: " << key << '\n';
            return 2;
        }
    }
    if (port < 1 || port > 65535) {
        return 2;
    }
    std::shared_ptr<snackshop::ConfigStore> configs;
    try {
        configs = std::make_shared<snackshop::ConfigStore>(configPath);
    } catch (const std::exception& e) {
        std::cerr << "Invalid game configuration: " << e.what() << std::endl;
        return 2;
    }
    if (checkConfig) {
        std::cout << "Config OK: " << configs->current()->version << std::endl;
        return 0;
    }
    if (!std::filesystem::is_directory(web)) {
        std::cerr << "Build client first: missing " << web << '\n';
        return 2;
    }
    auto gameServer = std::make_shared<snackshop::GameServer>(configs);
    drogon::app().registerController(std::make_shared<snackshop::NetHandlerGame>(gameServer));
    drogon::app().registerHandler(
        "/api/health",
        [gameServer, configs](const drogon::HttpRequestPtr&,
                              std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
            Json::Value value;
            value["rooms"] = gameServer->roomCount();
            value["ok"] = true;
            value["service"] = "cat-shop-cpp";
            value["version"] = "0.3.0";
            value["configVersion"] = configs->current()->version;
            auto response = drogon::HttpResponse::newHttpJsonResponse(value);
            response->addHeader("Cache-Control", "no-store");
            callback(response);
        },
        {drogon::Get});
    drogon::app().setClientMaxWebSocketMessageSize(4096);
    drogon::app().setLogLevel(trantor::Logger::kWarn);
    drogon::app()
        .setThreadNum(1)
        .setDocumentRoot(web)
        .setStaticFilesCacheTime(-1)
        .setHomePage("index.html")
        .addListener(bind, static_cast<std::uint16_t>(port));
    drogon::app().getLoop()->runEvery(.05, [gameServer] { gameServer->update(); });
    std::cout << "Snack Shop Squad: http://127.0.0.1:" << port << " | bind " << bind << std::endl;
    drogon::app().run();
}
