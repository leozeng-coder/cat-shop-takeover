#include "asset_catalog.h"
#include "config_repository.h"
#include <drogon/drogon.h>
#include <drogon/utils/Utilities.h>
#include <fstream>
#include <iostream>
#ifdef _WIN32
#include <Windows.h>
#else
#include <fcntl.h>
#include <sys/file.h>
#endif

namespace {
using namespace snackshop;
bool sameSecret(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) {
        return false;
    }
    unsigned char difference = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        difference |= static_cast<unsigned char>(a[i] ^ b[i]);
    }
    return difference == 0;
}
} // namespace
int main(int argc, char** argv) {
    try {
        int port = 8790;
        std::filesystem::path web = "client-admin/dist", config = "data/config", storage = "client-admin/data",
                              tokenFile = ".run/admin-access.key";
        std::filesystem::path assetSource;
        for (int i = 1; i < argc; ++i) {
            const std::string key = argv[i];
            if (++i >= argc) {
                throw std::runtime_error("Missing option value");
            }
            if (key == "--port") {
                port = std::stoi(argv[i]);
            } else if (key == "--web") {
                web = argv[i];
            } else if (key == "--config") {
                config = argv[i];
            } else if (key == "--store") {
                storage = argv[i];
            } else if (key == "--token-file") {
                tokenFile = argv[i];
            } else if (key == "--assets") {
                assetSource = argv[i];
            } else {
                throw std::runtime_error("Unknown option: " + key);
            }
        }
        if (port < 1 || port > 65535) {
            throw std::runtime_error("Invalid port");
        }
        const auto canonicalConfig = std::filesystem::canonical(config);
        // Only one publisher may own a configuration root, even on different ports.
#ifdef _WIN32
        const auto name = "Local\\CatShopAdmin-" + drogon::utils::getSha256(canonicalConfig.string());
        const auto publisherLock = CreateMutexA(nullptr, FALSE, name.c_str());
        if (!publisherLock || GetLastError() == ERROR_ALREADY_EXISTS) {
            throw std::runtime_error("An admin service already owns this config directory");
        }
#else
        const int publisherLock = open((canonicalConfig / ".admin.lock").c_str(), O_CREAT | O_RDWR, 0600);
        if (publisherLock < 0 || flock(publisherLock, LOCK_EX | LOCK_NB) != 0) {
            throw std::runtime_error("An admin service already owns this config directory");
        }
#endif
        if (!std::filesystem::exists(web / "index.html")) {
            throw std::runtime_error("Build client-admin first");
        }
        std::filesystem::create_directories(tokenFile.parent_path());
        std::string token;
        if (std::filesystem::exists(tokenFile)) {
            std::ifstream input(tokenFile);
            input >> token;
        }
        if (token.size() < 32) {
            token = drogon::utils::getUuid() + drogon::utils::getUuid();
            std::ofstream output(tokenFile, std::ios::trunc);
            output << token;
            output.flush();
            if (!output) {
                throw std::runtime_error("Cannot save local access key");
            }
        }
        auto repository = std::make_shared<ConfigRepository>(config, storage);
        repository->workspace();
        auto art = std::make_shared<AssetCatalog>(assetSource);
        drogon::app().registerHandler(
            "/api/admin/health",
            [](const drogon::HttpRequestPtr&, std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
                Json::Value value;
                value["service"] = "cat-shop-admin";
                value["ok"] = true;
                callback(drogon::HttpResponse::newHttpJsonResponse(value));
            },
            {drogon::Get});
        drogon::app().registerHandler(
            "/api/admin/{1}",
            [repository, token, art, port](const drogon::HttpRequestPtr& request,
                                           std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                                           const std::string& action) {
                Json::Value value;
                int status = 200;
                try {
                    const auto origin = request->getHeader("origin");
                    if (!origin.empty() && origin != "http://127.0.0.1:" + std::to_string(port) &&
                        origin != "http://localhost:" + std::to_string(port)) {
                        throw AdminError(403, "请从本机管理页面访问");
                    }
                    if (!sameSecret(request->getHeader("authorization"), "Bearer " + token)) {
                        throw AdminError(401, "请使用本机访问密钥登录工作台");
                    }
                    if (request->method() == drogon::Get) {
                        if (action == "workspace") {
                            value = repository->workspace();
                        } else if (action == "history") {
                            value = repository->history();
                        } else if (action == "assets") {
                            value = art->catalog();
                        } else if (action == "clients") {
                            value = art->clients();
                        } else {
                            throw AdminError(404, "找不到这个管理接口");
                        }
                    } else {
                        if (request->getHeader("content-type").find("application/json") != 0) {
                            throw AdminError(415, "请使用 JSON 请求");
                        }
                        const auto body = request->getJsonObject();
                        if (!body || !body->isObject()) {
                            throw AdminError(400, "请求内容不是有效的 JSON 对象");
                        }
                        if (action == "draft") {
                            value = repository->save(*body);
                        } else if (action == "validate") {
                            value = repository->validate(*body);
                        } else if (action == "publish") {
                            value = repository->publish(*body);
                        } else if (action == "rollback") {
                            value = repository->rollback(*body);
                        } else if (action == "reset") {
                            value = repository->reset(*body);
                        } else {
                            throw AdminError(404, "找不到这个管理接口");
                        }
                    }
                } catch (const AdminError& error) {
                    status = error.status;
                    value["error"] = error.what();
                } catch (const std::exception& error) {
                    status = 500;
                    value["error"] = error.what();
                }
                auto response = drogon::HttpResponse::newHttpJsonResponse(value);
                response->setStatusCode(static_cast<drogon::HttpStatusCode>(status));
                response->addHeader("Cache-Control", "no-store");
                response->addHeader("X-Content-Type-Options", "nosniff");
                callback(response);
            },
            {drogon::Get, drogon::Post});
        // Serve the source library directly; drafts, keys and Cocos metadata stay private.
        drogon::app().registerHandlerViaRegex(
            "/assets/.*",
            [art](const drogon::HttpRequestPtr& request,
                  std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
                try {
                    const auto path = art->file(request->path().substr(std::string("/assets/").size()));
                    const auto extension = path.extension().string();
                    if (!std::filesystem::is_regular_file(path) ||
                        (extension != ".png" && extension != ".json" && extension != ".webp" && extension != ".jpg" &&
                         extension != ".jpeg")) {
                        throw AdminError(404, "Not found");
                    }
                    auto response = drogon::HttpResponse::newFileResponse(path.string());
                    response->addHeader("Cache-Control", "no-store");
                    response->addHeader("X-Content-Type-Options", "nosniff");
                    callback(response);
                } catch (...) {
                    callback(drogon::HttpResponse::newNotFoundResponse());
                }
            },
            {drogon::Get});
        drogon::app().setLogLevel(trantor::Logger::kWarn);
        drogon::app().setClientMaxBodySize(2 * 1024 * 1024);
        drogon::app()
            .setThreadNum(2)
            .setDocumentRoot(web.string())
            .setFileTypes({"html", "js", "css", "json", "png", "jpg", "jpeg", "webp", "svg", "woff2", "ico"})
            .setStaticFilesCacheTime(-1)
            .setHomePage("index.html")
            .addListener("127.0.0.1", static_cast<std::uint16_t>(port));
        std::cout << "Cat Shop Workbench: http://127.0.0.1:" << port << "/" << std::endl;
        drogon::app().run();
    } catch (const std::exception& error) {
        std::cerr << error.what() << std::endl;
        return 1;
    }
}
