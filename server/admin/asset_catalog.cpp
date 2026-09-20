#include "asset_catalog.h"
#include "config_repository.h"

namespace snackshop {
namespace {
const std::filesystem::path webConfig = "client/tools/asset-build.json";
const std::filesystem::path cocosConfig = "client-cocos/extensions/shared-game-assets/package.json";

std::filesystem::path contained(const std::filesystem::path& root, const std::string& relative) {
    if (relative.empty() || std::filesystem::path(relative).is_absolute()) {
        throw AdminError(400, "资源路径必须是相对路径");
    }
    const auto path = std::filesystem::canonical(root / relative);
    const auto local = path.lexically_relative(std::filesystem::canonical(root));
    if (local.empty() || *local.begin() == "..") {
        throw AdminError(400, "资源路径超出共享资源目录");
    }
    return path;
}

std::filesystem::path configuredRoot(bool cocos) {
    const auto config = readAdminJson(cocos ? cocosConfig : webConfig);
    const auto relative =
        cocos ? config["contributions"]["asset-db"]["mount"]["path"].asString() : config["source"].asString();
    if (relative.empty()) {
        throw std::runtime_error("未配置共享美术目录");
    }
    return std::filesystem::absolute((cocos ? cocosConfig.parent_path() : std::filesystem::path(".")) / relative)
        .lexically_normal();
}
} // namespace

AssetCatalog::AssetCatalog(std::filesystem::path source)
    : m_source(std::filesystem::canonical(source.empty() ? configuredRoot(false) : source)) {
}

std::filesystem::path AssetCatalog::file(const std::string& relative) const {
    return contained(m_source, relative);
}

Json::Value AssetCatalog::catalog() const {
    Json::Value result;
    result["sourceRoot"] = m_source.generic_string();
    result["urlPrefix"] = "/assets/";
    result["characters"] = Json::Value(Json::arrayValue);
    result["themes"] = Json::Value(Json::arrayValue);
    const auto characters = file("characters/v1");
    const auto characterIndex = readAdminJson(contained(characters, "index.json"));
    for (const auto& entry : characterIndex["characters"]) {
        const auto path = contained(characters, entry["manifest"].asString());
        auto manifest = readAdminJson(path);
        manifest["palettes"] = readAdminJson(contained(path.parent_path(), manifest["palettes"].asString()));
        result["characters"].append(manifest);
    }
    const auto themes = file("themes/v1");
    const auto themeIndex = readAdminJson(contained(themes, "index.json"));
    for (const auto& entry : themeIndex["themes"]) {
        const auto path = contained(themes, entry["manifest"].asString());
        const auto manifest = readAdminJson(path);
        Json::Value theme;
        theme["id"] = entry["id"];
        theme["name"] = entry["name"];
        theme["rendering"] = manifest["rendering"];
        theme["assets"] = Json::Value(Json::arrayValue);
        for (const auto& asset : manifest["assets"]) {
            Json::Value image;
            for (const auto* name : {"id", "name", "width", "height"}) {
                image[name] = asset[name];
            }
            const auto source = contained(path.parent_path(), asset["src"].asString());
            image["src"] = "/assets/" + source.lexically_relative(m_source).generic_string();
            theme["assets"].append(image);
        }
        result["themes"].append(theme);
    }
    return result;
}

Json::Value AssetCatalog::clients() const {
    Json::Value result(Json::arrayValue);
    for (const bool cocos : {false, true}) {
        Json::Value client;
        client["id"] = cocos ? "cocos" : "web";
        client["name"] = cocos ? "Cocos Creator 客户端" : "网页客户端";
        client["integration"] = cocos ? "Asset DB 扩展挂载" : "Vite 构建打包";
        client["configPath"] = (cocos ? cocosConfig : webConfig).generic_string();
        client["assetRoot"] = "";
        client["sourceMatches"] = false;
        client["available"] = false;
        client["problem"] = "";
        try {
            const auto root = configuredRoot(cocos);
            client["assetRoot"] = root.generic_string();
            const bool matches = std::filesystem::equivalent(root, m_source);
            client["sourceMatches"] = matches;
            client["available"] = matches && std::filesystem::exists(root / "characters/v1/index.json") &&
                                  std::filesystem::exists(root / "themes/v1/index.json");
            if (!matches) {
                client["problem"] = "客户端配置指向了另一份资源目录";
            } else if (!client["available"].asBool()) {
                client["problem"] = "共享资源索引不完整";
            }
        } catch (const std::exception& error) {
            client["problem"] = error.what();
        }
        result.append(client);
    }
    return result;
}
} // namespace snackshop
