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
    std::filesystem::create_directories(m_config / ".releases");
}
Json::Value ConfigRepository::current() const {
    const auto source = ConfigLoader::sourceDirectory(m_config);
    const auto bundle = readTables(source);
    const auto config = validateTables(bundle);
    // Never build a candidate out of files that changed during reading.
    if (bundle != readTables(source) || source != ConfigLoader::sourceDirectory(m_config)) {
        throw AdminError(409, "正式配置正在变化，请刷新后重试");
    }
    Json::Value result;
    result["tables"] = bundle;
    result["revision"] = revision(bundle);
    result["version"] = config->version;
    result["release"] = source == m_config ? "source" : source.filename().string();
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
std::string ConfigRepository::snapshot(const Json::Value& bundle, const std::string& note, const std::string& from) {
    const auto id = drogon::utils::getUuid();
    const auto target = m_config / ".releases" / id;
    std::filesystem::create_directory(target);
    for (const auto* name : tables) {
        writeAdminJson(target / (std::string(name) + ".json"), bundle[name]);
    }
    // Validate the serialized files through the exact loader used by the game.
    const auto verified = ConfigLoader::load(target);
    Json::Value meta;
    meta["id"] = id;
    meta["version"] = verified->version;
    meta["createdAt"] = now();
    meta["note"] = note;
    meta["rollbackFrom"] = from;
    writeAdminJson(target / "release.json", meta);
    return id;
}
Json::Value ConfigRepository::activate(Json::Value bundle, const std::string& note, const std::string& from) {
    const auto before = current();
    validateTables(bundle);
    if (before["release"] == "source") {
        snapshot(before["tables"], "首次发布前的原始配置");
    }
    bundle["manifest"]["version"] = "admin-" + drogon::utils::getUuid().substr(0, 8);
    const auto id = snapshot(bundle, note, from);
    if (current()["revision"] != before["revision"]) {
        throw AdminError(409, "发布期间正式配置已变化，请刷新后重试");
    }
    Json::Value pointer;
    pointer["release"] = id;
    writeAdminJson(m_config / "active.json", pointer);
    makeDraft(current());
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
    if (id.empty() || id.size() > 80 ||
        id.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789-_") != std::string::npos) {
        throw AdminError(400, "无效的版本编号");
    }
    const auto target = m_config / ".releases" / id;
    if (!std::filesystem::exists(target / "release.json")) {
        throw AdminError(404, "找不到这个版本");
    }
    if (std::filesystem::canonical(target).parent_path() != std::filesystem::canonical(m_config / ".releases")) {
        throw AdminError(400, "无效的版本目录");
    }
    return activate(readTables(target), message(request, "回滚数值配置"), id);
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
    for (const auto& entry : std::filesystem::directory_iterator(m_config / ".releases")) {
        if (entry.is_directory() && std::filesystem::exists(entry.path() / "release.json")) {
            records.push_back(readAdminJson(entry.path() / "release.json"));
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
