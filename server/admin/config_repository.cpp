#include "config_repository.h"
#include "config/config_loader.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <drogon/utils/Utilities.h>
#include <fstream>
#include <iomanip>
#include <sstream>
#ifdef _WIN32
#include <Windows.h>
#endif

namespace snackshop {
namespace {
constexpr std::array<const char*, 14> tables{"manifest",   "currencies",     "match",      "doors",       "nests",
                                             "items",      "manager",        "repair",     "map_items",   "cat_ai",
                                             "manager_ai", "map_generation", "characters", "random_items"};
std::string json(const Json::Value& value) {
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "  ";
    writer["emitUTF8"] = true;
    return Json::writeString(writer, value);
}
std::string revision(const Json::Value& value) {
    return drogon::utils::getSha256(json(value));
}
std::string now() {
    const auto stamp = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &stamp);
#else
    gmtime_r(&stamp, &utc);
#endif
    std::ostringstream text;
    text << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return text.str();
}
void checkTables(const Json::Value& bundle) {
    if (!bundle.isObject() || bundle.size() != tables.size() || json(bundle).size() > 1024 * 1024) {
        throw AdminError(400, "草稿必须包含完整的 14 张配表，且总大小不超过 1 MiB");
    }
    for (const auto* table : tables) {
        if (!bundle.isMember(table)) {
            throw AdminError(400, std::string("缺少配表：") + table);
        }
        const std::string name(table);
        const bool list = name == "currencies" || name == "doors" || name == "nests" || name == "items" ||
                          name == "characters" || name == "random_items";
        if (list ? !bundle[table].isArray() : !bundle[table].isObject()) {
            throw AdminError(400, name + (list ? " 必须是数组" : " 必须是对象"));
        }
        if (list) {
            for (const auto& row : bundle[table]) {
                if (!row.isObject()) {
                    throw AdminError(400, name + " 的每一行必须是对象");
                }
            }
        }
    }
}
std::shared_ptr<const GameConfig> validateTables(const Json::Value& bundle) {
    checkTables(bundle);
    auto root = bundle["manifest"];
    if (!root.isObject()) {
        throw AdminError(422, "manifest 必须是对象");
    }
    for (const auto* table : tables) {
        if (std::string(table) != "manifest" && std::string(table) != "map_items") {
            root[table] = bundle[table];
        }
    }
    root["initial_items"] = bundle["map_items"]["initial_items"];
    root["pickup_item"] = bundle["map_items"]["pickup_item"];
    try {
        return ConfigLoader::parse(Json::writeString(Json::StreamWriterBuilder{}, root));
    } catch (const std::exception& error) {
        throw AdminError(422, error.what());
    }
}
Json::Value readTables(const std::filesystem::path& directory) {
    Json::Value bundle(Json::objectValue);
    for (const auto* table : tables) {
        bundle[table] = readAdminJson(directory / (std::string(table) + ".json"));
    }
    return bundle;
}
std::string message(const Json::Value& request, const char* fallback) {
    const auto value = request.get("note", fallback).asString();
    if (value.size() > 1000) {
        throw AdminError(400, "发布备注过长");
    }
    return value.empty() ? fallback : value;
}
} // namespace

Json::Value readAdminJson(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file || file.tellg() < 0 || file.tellg() > 2 * 1024 * 1024) {
        throw AdminError(500, "无法读取配置文件：" + path.filename().string());
    }
    std::string text(static_cast<std::size_t>(file.tellg()), '\0');
    file.seekg(0);
    if (!file.read(text.data(), text.size())) {
        throw AdminError(500, "配置文件读取不完整");
    }
    Json::CharReaderBuilder builder;
    builder["rejectDupKeys"] = true;
    builder["failIfExtra"] = true;
    builder["stackLimit"] = 64;
    Json::Value value;
    std::string error;
    const auto reader = std::unique_ptr<Json::CharReader>(builder.newCharReader());
    if (!reader->parse(text.data(), text.data() + text.size(), &value, &error)) {
        throw AdminError(400, error);
    }
    return value;
}
void writeAdminJson(const std::filesystem::path& path, const Json::Value& value) {
    const auto temp = path.parent_path() / (path.filename().string() + "." + drogon::utils::getUuid() + ".tmp");
    try {
        {
            std::ofstream file(temp, std::ios::binary | std::ios::trunc);
            file << json(value) << '\n';
            file.flush();
            if (!file) {
                throw AdminError(500, "配置写入失败");
            }
        }
#ifdef _WIN32
        if (!MoveFileExW(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
            throw AdminError(500, "配置文件暂时被占用，请重试");
        }
#else
        std::filesystem::rename(temp, path);
#endif
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove(temp, ignored);
        throw;
    }
}
ConfigRepository::ConfigRepository(std::filesystem::path config, std::filesystem::path storage)
    : m_config(std::filesystem::canonical(config)), m_storage(std::filesystem::absolute(storage)) {
    std::filesystem::create_directories(m_storage);
    m_storage = std::filesystem::canonical(m_storage);
    const auto relative = m_storage.lexically_relative(m_config);
    if (relative.empty() || (!relative.is_absolute() && *relative.begin() != "..")) {
        throw AdminError(400, "管理端历史目录不能放在游戏配置目录内");
    }
    if (std::filesystem::exists(m_config / "active.json")) {
        throw AdminError(409, "请先将旧版发布快照迁移到管理端，并恢复最新正式配表");
    }
    std::filesystem::create_directories(m_storage / "releases");
    recoverPublication();
}
Json::Value ConfigRepository::current() const {
    if (std::filesystem::exists(m_config / ".publishing.json")) {
        throw AdminError(409, "配置发布未完成，请重启管理服务恢复");
    }
    const auto bundle = readTables(m_config);
    const auto config = ConfigLoader::load(m_config);
    if (bundle != readTables(m_config) || std::filesystem::exists(m_config / ".publishing.json")) {
        throw AdminError(409, "正式配置正在变化，请刷新后重试");
    }
    Json::Value result;
    result["tables"] = bundle;
    result["revision"] = revision(bundle);
    result["version"] = config->version;
    result["release"] = "source";
    if (std::filesystem::exists(m_storage / "current.json")) {
        const auto record = readAdminJson(m_storage / "current.json");
        if (record["revision"] == result["revision"]) {
            result["release"] = record["release"];
        }
    }
    return result;
}
Json::Value ConfigRepository::makeDraft(const Json::Value& active) {
    Json::Value value;
    value["revision"] = drogon::utils::getUuid();
    value["baseRevision"] = active["revision"];
    value["tables"] = active["tables"];
    value["updatedAt"] = now();
    writeAdminJson(m_storage / "draft.json", value);
    return value;
}
Json::Value ConfigRepository::draft() {
    return std::filesystem::exists(m_storage / "draft.json") ? readAdminJson(m_storage / "draft.json")
                                                             : makeDraft(current());
}
Json::Value ConfigRepository::workspaceUnlocked() {
    Json::Value value;
    value["current"] = current();
    value["draft"] = draft();
    value["conflict"] = value["draft"]["baseRevision"] != value["current"]["revision"];
    return value;
}
Json::Value ConfigRepository::workspace() {
    std::lock_guard lock(m_mutex);
    return workspaceUnlocked();
}
void ConfigRepository::checkRevision(const Json::Value& request, const Json::Value& value) const {
    if (!request["revision"].isString() || request["revision"] != value["revision"]) {
        throw AdminError(409, "草稿已在其他窗口修改，请刷新后再编辑");
    }
}
Json::Value ConfigRepository::save(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    auto value = draft();
    checkRevision(request, value);
    checkTables(request["tables"]);
    value["tables"] = request["tables"];
    value["revision"] = drogon::utils::getUuid();
    value["updatedAt"] = now();
    writeAdminJson(m_storage / "draft.json", value);
    return workspaceUnlocked();
}
Json::Value ConfigRepository::validate(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    const auto value = draft();
    checkRevision(request, value);
    const auto config = validateTables(value["tables"]);
    Json::Value result;
    result["ok"] = true;
    result["version"] = config->version;
    result["revision"] = value["revision"];
    return result;
}
std::filesystem::path ConfigRepository::releasePath(const std::string& id) const {
    if (id.empty() || id.size() > 80 ||
        id.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789-_") != std::string::npos) {
        throw AdminError(400, "无效的版本编号");
    }
    const auto root = std::filesystem::canonical(m_storage / "releases");
    const auto target = root / id;
    if (!std::filesystem::exists(target / "release.json")) {
        throw AdminError(404, "找不到这个版本");
    }
    if (std::filesystem::canonical(target).parent_path() != root) {
        throw AdminError(400, "无效的版本目录");
    }
    return target;
}
Json::Value ConfigRepository::readSnapshot(const std::string& id) const {
    const auto target = releasePath(id);
    const auto bundle = readTables(target);
    const auto meta = readAdminJson(target / "release.json");
    if (meta["revision"].asString() != revision(bundle)) {
        throw AdminError(409, "历史版本内容已被修改");
    }
    ConfigLoader::load(target);
    return bundle;
}
std::string ConfigRepository::snapshot(const Json::Value& bundle, const std::string& note, const std::string& from,
                                       bool published) {
    const auto id = drogon::utils::getUuid();
    const auto target = m_storage / "releases" / id;
    std::filesystem::create_directory(target);
    for (const auto* name : tables) {
        writeAdminJson(target / (std::string(name) + ".json"), bundle[name]);
    }
    const auto verified = ConfigLoader::load(target);
    Json::Value meta;
    meta["id"] = id;
    meta["version"] = verified->version;
    meta["revision"] = revision(bundle);
    meta["createdAt"] = now();
    meta["note"] = note;
    meta["rollbackFrom"] = from;
    meta["published"] = published;
    writeAdminJson(target / "release.json", meta);
    return id;
}
void ConfigRepository::writeCurrent(const Json::Value& bundle, const std::string& id) {
    for (const auto* name : tables) {
        if (std::string(name) != "manifest") {
            writeAdminJson(m_config / (std::string(name) + ".json"), bundle[name]);
        }
    }
    writeAdminJson(m_config / "manifest.json", bundle["manifest"]);
    if (readTables(m_config) != bundle) {
        throw AdminError(409, "写入期间配表被外部修改");
    }
    Json::Value current;
    current["release"] = id;
    current["revision"] = revision(bundle);
    writeAdminJson(m_storage / "current.json", current);
}
void ConfigRepository::finishPublication(const Json::Value& bundle, const std::string& id) {
    const auto path = releasePath(id) / "release.json";
    auto meta = readAdminJson(path);
    meta["published"] = true;
    writeAdminJson(path, meta);
    Json::Value active;
    active["tables"] = bundle;
    active["revision"] = revision(bundle);
    makeDraft(active);
    std::filesystem::remove(m_config / ".publishing.json");
    std::filesystem::remove(m_storage / "pending.json");
}
void ConfigRepository::recoverPublication() {
    const auto pendingPath = m_storage / "pending.json";
    if (!std::filesystem::exists(pendingPath)) {
        if (std::filesystem::exists(m_config / ".publishing.json")) {
            throw AdminError(409, "发布恢复记录缺失，请使用原管理端数据目录启动");
        }
        return;
    }
    const auto pending = readAdminJson(pendingPath);
    if (pending["configRoot"].asString() != m_config.generic_string() ||
        (pending["phase"] != "applying" && pending["phase"] != "committed")) {
        throw AdminError(409, "发布恢复记录不匹配");
    }
    const bool committed = pending["phase"] == "committed";
    const auto id = pending[committed ? "after" : "before"].asString();
    const auto bundle = readSnapshot(id);
    Json::Value marker;
    marker["release"] = id;
    writeAdminJson(m_config / ".publishing.json", marker);
    writeCurrent(bundle, id);
    if (committed) {
        finishPublication(bundle, id);
    } else {
        // Keep the user's draft when rolling back an interrupted write.
        std::filesystem::remove(m_config / ".publishing.json");
        std::filesystem::remove(pendingPath);
    }
}
Json::Value ConfigRepository::activate(Json::Value bundle, const std::string& note, const std::string& from) {
    recoverPublication();
    const auto before = current();
    validateTables(bundle);
    const auto previous =
        before["release"] == "source" ? snapshot(before["tables"], "发布前的正式配置") : before["release"].asString();
    // Check the recovery source before modifying any live files.
    readSnapshot(previous);
    bundle["manifest"]["version"] = "admin-" + drogon::utils::getUuid().substr(0, 8);
    const auto id = snapshot(bundle, note, from, false);
    if (current()["revision"] != before["revision"]) {
        throw AdminError(409, "发布期间正式配置已变化，请刷新后重试");
    }
    Json::Value pending;
    pending["configRoot"] = m_config.generic_string();
    pending["before"] = previous;
    pending["after"] = id;
    pending["phase"] = "applying";
    writeAdminJson(m_storage / "pending.json", pending);
    try {
        Json::Value marker;
        marker["release"] = id;
        writeAdminJson(m_config / ".publishing.json", marker);
        writeCurrent(bundle, id);
        pending["phase"] = "committed";
        writeAdminJson(m_storage / "pending.json", pending);
        finishPublication(bundle, id);
    } catch (...) {
        recoverPublication();
        throw;
    }
    return workspaceUnlocked();
}
Json::Value ConfigRepository::publish(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    const auto value = draft();
    checkRevision(request, value);
    if (current()["revision"] != value["baseRevision"]) {
        throw AdminError(409, "正式配置已变化，请先导出草稿，再从正式版重新载入");
    }
    return activate(value["tables"], message(request, "发布数值调整"));
}
Json::Value ConfigRepository::rollback(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    checkRevision(request, draft());
    if (request["currentRevision"] != current()["revision"]) {
        throw AdminError(409, "正式版本已变化，请刷新发布历史");
    }
    const auto id = request["release"].asString();
    if (!readAdminJson(releasePath(id) / "release.json")["published"].asBool()) {
        throw AdminError(400, "这个版本尚未发布");
    }
    return activate(readSnapshot(id), message(request, "回滚数值配置"), id);
}
Json::Value ConfigRepository::reset(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    checkRevision(request, draft());
    makeDraft(current());
    return workspaceUnlocked();
}
Json::Value ConfigRepository::history() {
    std::lock_guard lock(m_mutex);
    std::vector<Json::Value> records;
    for (const auto& entry : std::filesystem::directory_iterator(m_storage / "releases")) {
        if (entry.is_directory() && std::filesystem::exists(entry.path() / "release.json")) {
            const auto meta = readAdminJson(releasePath(entry.path().filename().string()) / "release.json");
            if (meta["published"].asBool()) {
                records.push_back(meta);
            }
        }
    }
    std::sort(records.begin(), records.end(),
              [](const auto& a, const auto& b) { return a["createdAt"].asString() > b["createdAt"].asString(); });
    Json::Value result(Json::arrayValue);
    for (const auto& record : records) {
        result.append(record);
    }
    return result;
}
} // namespace snackshop
