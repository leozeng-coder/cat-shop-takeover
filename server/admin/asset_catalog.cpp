#include "asset_catalog.h"
#include "config_repository.h"
#include <cmath>
#include <drogon/utils/Utilities.h>
#include <regex>
#include <set>

namespace snackshop {
namespace {
const std::filesystem::path webConfig = "client/tools/asset-build.json";
const std::filesystem::path cocosConfig = "client-cocos/extensions/shared-game-assets/package.json";
const std::filesystem::path presentationPath = "visuals/v1/index.json";

Json::Value presentation(const std::filesystem::path& root) {
    const auto path = root / presentationPath;
    if (!std::filesystem::exists(path)) {
        Json::Value empty;
        empty["version"] = 1;
        empty["entries"] = Json::Value(Json::objectValue);
        return empty;
    }
    return readAdminJson(path);
}

std::string revision(const Json::Value& value) {
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    return drogon::utils::getSha256(Json::writeString(writer, value));
}

void validatePresentation(const Json::Value& value) {
    if (!value.isObject() || value.get("version", 0).asInt() != 1 || !value["entries"].isObject() ||
        value["entries"].size() > 1024) {
        throw AdminError(400, "资源展示配置格式无效");
    }
    const std::regex key("^(characters|scenes|items)/[a-z0-9_/-]{1,120}$");
    for (const auto& id : value["entries"].getMemberNames()) {
        const auto& row = value["entries"][id];
        if (!std::regex_match(id, key) || !row.isObject() || row.size() != 6) {
            throw AdminError(400, "资源展示项无效：" + id);
        }
        const auto number = [&](const char* name, double low, double high) {
            const auto& field = row[name];
            if (!field.isNumeric() || !std::isfinite(field.asDouble()) || field.asDouble() < low ||
                field.asDouble() > high) {
                throw AdminError(400, "资源参数超出范围：" + id + "." + name);
            }
        };
        number("scale", 0.1, 4);
        number("offsetX", -128, 128);
        number("offsetY", -128, 128);
        number("opacity", 0, 1);
        number("speed", 0.1, 4);
        const auto& curve = row["curve"];
        if (!curve.isArray() || curve.size() != 4) {
            throw AdminError(400, "动画曲线必须有四个控制值");
        }
        for (const auto& point : curve) {
            if (!point.isNumeric() || !std::isfinite(point.asDouble()) || point.asDouble() < 0 ||
                point.asDouble() > 1) {
                throw AdminError(400, "动画曲线超出范围");
            }
        }
    }
}

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
    result["doors"] = Json::Value(Json::arrayValue);
    result["items"] = Json::Value(Json::arrayValue);
    const auto display = presentation(m_source);
    validatePresentation(display);
    result["presentation"] = display;
    result["presentationRevision"] = revision(display);
    const auto characters = file("characters/v1");
    const auto characterIndex = readAdminJson(contained(characters, "index.json"));
    for (const auto& entry : characterIndex["characters"]) {
        const auto path = contained(characters, entry["manifest"].asString());
        auto manifest = readAdminJson(path);
        if (entry.isMember("name")) {
            manifest["name"] = entry["name"];
        }
        manifest["assetBaseUrl"] = "/assets/" + path.parent_path().lexically_relative(m_source).generic_string() + "/";
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
    const auto doorIndex = m_source / "item/v2/door/index.json";
    if (std::filesystem::exists(doorIndex)) {
        const auto index = readAdminJson(doorIndex);
        for (const auto& door : index["doors"]) {
            for (const auto& state : index["states"]) {
                const auto relative = "item/v2/door/" + door["id"].asString() + "/" + state.asString() + ".png";
                Json::Value image;
                image["id"] = door["id"].asString() + "/" + state.asString();
                image["name"] = door["name"].asString() + " · " + state.asString();
                image["src"] = std::filesystem::exists(m_source / relative) ? "/assets/" + relative : "";
                result["doors"].append(image);
            }
        }
    }
    const auto itemIndex = m_source / "item/v2/index.json";
    if (std::filesystem::exists(itemIndex)) {
        const auto index = readAdminJson(itemIndex);
        for (const auto& row : index["items"]) {
            Json::Value image;
            image["id"] = row["id"];
            image["name"] = row["name"];
            const auto relative = "item/v2/" + row["src"].asString();
            image["src"] = std::filesystem::exists(m_source / relative) ? "/assets/" + relative : "";
            for (const auto* name : {"columns", "frameCount", "frameWidth", "frameHeight", "frameDurationMs"}) {
                image[name] = row[name];
            }
            result["items"].append(image);
        }
    }
    return result;
}

Json::Value AssetCatalog::savePresentation(const Json::Value& request) const {
    const auto current = presentation(m_source);
    if (!request["revision"].isString() || request["revision"].asString() != revision(current)) {
        throw AdminError(409, "资源展示配置已变化，请刷新后重试");
    }
    Json::Value next;
    next["version"] = 1;
    next["entries"] = request["entries"];
    validatePresentation(next);
    const auto path = m_source / presentationPath;
    std::filesystem::create_directories(path.parent_path());
    writeAdminJson(path, next);
    Json::Value result;
    result["presentation"] = next;
    result["presentationRevision"] = revision(next);
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
