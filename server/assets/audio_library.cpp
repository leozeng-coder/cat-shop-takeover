#include "audio_library.h"
#include <cmath>
#include <drogon/drogon.h>
#include <drogon/utils/Utilities.h>
#include <fstream>
#include <map>
#include <regex>
#include <set>
#include <sstream>

namespace snackshop {
namespace {
const std::set<std::string> categories{"ui", "character", "item", "door", "match", "music"};
void require(bool condition, const char* message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}
void number(const Json::Value& value, double minimum, double maximum, const std::string& field, const char* unit = "") {
    if (value.isNumeric() && std::isfinite(value.asDouble()) && value.asDouble() >= minimum &&
        value.asDouble() <= maximum) {
        return;
    }
    std::ostringstream message;
    message << field << "必须在 " << minimum << "～" << maximum << unit << "之间，当前值：";
    if (value.isNumeric()) {
        message << value.asDouble();
    } else if (value.isNull()) {
        message << "未填写";
    } else {
        message << "非数值";
    }
    throw std::runtime_error(message.str());
}
} // namespace
AudioLibrary::AudioLibrary(std::filesystem::path assets) : m_root(std::filesystem::absolute(assets) / "audio") {
}
Json::Value AudioLibrary::read(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    require(file && file.tellg() >= 0 && file.tellg() <= 2 * 1024 * 1024, "无法读取音效配置");
    file.seekg(0);
    Json::Value value;
    Json::CharReaderBuilder builder;
    builder["rejectDupKeys"] = true;
    builder["failIfExtra"] = true;
    std::string error;
    require(Json::parseFromStream(builder, file, &value, &error), "音效配置 JSON 无效");
    return value;
}
std::string AudioLibrary::hash(const Json::Value& value) {
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    return drogon::utils::getSha256(Json::writeString(writer, value));
}
Json::Value AudioLibrary::events() {
    Json::Value result(Json::arrayValue);
    const char* rows[][3] = {{"ui.click", "点击按钮", "ui"},
                             {"character.meow", "猫叫", "character"},
                             {"character.nest", "入窝", "character"},
                             {"character.wake", "起身", "character"},
                             {"character.caught", "被抓走", "character"},
                             {"item.install", "安装", "item"},
                             {"item.upgrade", "升级", "item"},
                             {"item.fire", "弹射器发射", "item"},
                             {"item.freeze", "冰箱触发", "item"},
                             {"item.reveal", "垃圾桶开奖", "item"},
                             {"door.close", "关门", "door"},
                             {"door.hit", "敲门", "door"},
                             {"door.break", "破门", "door"},
                             {"match.day", "准备结束", "match"},
                             {"match.level", "店长升级", "match"},
                             {"match.won", "胜利", "match"},
                             {"match.lost", "失败", "match"},
                             {"music.home", "首页音乐", "music"},
                             {"music.background", "通用背景音乐", "music"},
                             {"music.night", "夜晚音乐", "music"},
                             {"music.day", "白天音乐", "music"}};
    for (const auto& row : rows) {
        Json::Value event;
        event["id"] = row[0];
        event["name"] = row[1];
        event["category"] = row[2];
        result.append(event);
    }
    return result;
}
Json::Value AudioLibrary::defaults() {
    Json::Value tables;
    tables["clips"] = Json::Value(Json::arrayValue);
    tables["bindings"] = Json::Value(Json::arrayValue);
    for (const auto& event : events()) {
        Json::Value binding;
        binding["event"] = event["id"];
        binding["target"] = "*";
        binding["clip"] = "";
        binding["enabled"] = true;
        binding["volume"] = 1.0;
        binding["playbackRate"] = 1.0;
        binding["cooldownMs"] = event["id"] == "ui.click" ? 60 : 120;
        binding["maxVoices"] = 3;
        binding["range"] =
            event["category"] == "character" || event["category"] == "item" || event["category"] == "door" ? 12 : 0;
        tables["bindings"].append(binding);
    }
    tables["settings"]["enabled"] = true;
    tables["settings"]["masterVolume"] = .8;
    tables["settings"]["effectsVolume"] = .8;
    tables["settings"]["musicVolume"] = .35;
    return tables;
}
bool AudioLibrary::validFile(const std::string& name) {
    static const std::regex pattern("^[a-fA-F0-9]{64}\\.(wav|mp3)$");
    return std::regex_match(name, pattern);
}
void AudioLibrary::validate(const Json::Value& tables) {
    require(tables.isObject() && tables.size() == 3 && tables["clips"].isArray() && tables["bindings"].isArray() &&
                tables["settings"].isObject(),
            "音效配置结构无效");
    require(tables["clips"].size() <= 500 && tables["bindings"].size() <= 2000, "音效配置数量超出限制");
    std::set<std::string> clips, bindings, eventIds;
    std::map<std::string, std::string> eventNames;
    for (const auto& event : events()) {
        eventIds.insert(event["id"].asString());
        eventNames[event["id"].asString()] = event["name"].asString();
    }
    for (const auto& clip : tables["clips"]) {
        require(clip.isObject() && clip["id"].isString() && clip["name"].isString() && clip["category"].isString() &&
                    clip["file"].isString() && clip["enabled"].isBool(),
                "音效信息不完整");
        const auto id = clip["id"].asString();
        require(!id.empty() && id.size() <= 80 && clips.insert(id).second, "音效 ID 重复或无效");
        require(!clip["name"].asString().empty() && clip["name"].asString().size() <= 180, "请填写有效的音效名称");
        require(categories.contains(clip["category"].asString()) && validFile(clip["file"].asString()),
                "音效分类或文件无效");
        const auto label = "音频「" + clip["name"].asString() + "」的";
        number(clip["duration"], .001, 600, label + "时长", " 秒");
        number(clip["bytes"], 1, 20 * 1024 * 1024, label + "文件大小", " 字节");
    }
    for (const auto& binding : tables["bindings"]) {
        require(binding.isObject() && binding["event"].isString() && binding["target"].isString() &&
                    binding["clip"].isString() && binding["enabled"].isBool(),
                "事件绑定不完整");
        const auto event = binding["event"].asString(), target = binding["target"].asString(),
                   clip = binding["clip"].asString();
        require(eventIds.contains(event) && !target.empty() && target.size() <= 100 &&
                    bindings.insert(event + "/" + target).second,
                "事件绑定重复或无效");
        require(clip.empty() || clips.contains(clip), "事件引用的音效不存在，请先解除或修改绑定");
        const auto label = "事件「" + eventNames.at(event) + "」" + (target == "*" ? "" : "（" + target + "）") + "的";
        number(binding["volume"], 0, 4, label + "音量", " 倍");
        if (binding.isMember("playbackRate")) {
            number(binding["playbackRate"], .5, 2, label + "播放速度", " 倍");
        }
        number(binding["cooldownMs"], 0, 60000, label + "最短播放间隔", " 毫秒");
        require(binding["maxVoices"].isInt(), "同时播放数量必须是整数");
        number(binding["maxVoices"], 1, 16, label + "同时播放数量");
        number(binding["range"], 0, 100, label + "听觉范围", " 格");
    }
    const auto& settings = tables["settings"];
    require(settings["enabled"].isBool(), "声音开关无效");
    number(settings["masterVolume"], 0, 1, "总音量");
    number(settings["effectsVolume"], 0, 1, "音效总音量");
    number(settings["musicVolume"], 0, 1, "音乐总音量");
}
Json::Value AudioLibrary::current() {
    std::lock_guard lock(m_mutex);
    try {
        const auto manifest = read(m_root / "manifest.json");
        if (!m_current.isNull() && manifest["revision"] == m_current["revision"]) {
            return m_current;
        }
        Json::Value tables;
        for (const auto* table : {"clips", "bindings", "settings"}) {
            tables[table] = read(m_root / (std::string(table) + ".json"));
        }
        require(hash(tables) == manifest["revision"].asString(), "音效正在发布，请重试");
        validate(tables);
        m_current = tables;
        m_current["revision"] = manifest["revision"];
    } catch (...) {
        if (m_current.isNull()) {
            throw;
        }
        // A publication or damaged resource must not interrupt active games.
    }
    return m_current;
}
std::filesystem::path AudioLibrary::file(const std::string& name) const {
    require(validFile(name), "无效音频路径");
    const auto root = std::filesystem::canonical(m_root / "files");
    const auto path = std::filesystem::canonical(root / name);
    require(path.parent_path() == root && std::filesystem::is_regular_file(path), "音频文件不存在");
    return path;
}
void registerAudioRoutes(const std::filesystem::path& assets) {
    auto library = std::make_shared<AudioLibrary>(assets);
    drogon::app().registerHandler("/api/audio",
                                  [library](const drogon::HttpRequestPtr& request,
                                            std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
                                      try {
                                          auto value = library->current();
                                          const std::string tag = "\"" + value["revision"].asString() + "\"";
                                          auto response = request->getHeader("if-none-match") == tag
                                                              ? drogon::HttpResponse::newHttpResponse()
                                                              : drogon::HttpResponse::newHttpJsonResponse(value);
                                          if (request->getHeader("if-none-match") == tag) {
                                              response->setStatusCode(drogon::k304NotModified);
                                          }
                                          response->addHeader("ETag", tag);
                                          response->addHeader("Cache-Control", "no-cache");
                                          callback(response);
                                      } catch (...) {
                                          auto response = drogon::HttpResponse::newHttpResponse();
                                          response->setStatusCode(drogon::k503ServiceUnavailable);
                                          callback(response);
                                      }
                                  },
                                  {drogon::Get});
    drogon::app().registerHandler(
        "/assets/audio/files/{1}",
        [library](const drogon::HttpRequestPtr&, std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                  std::string name) {
            try {
                const auto response = drogon::HttpResponse::newFileResponse(library->file(name).string());
                response->setContentTypeString(name.ends_with(".wav") ? "audio/wav" : "audio/mpeg");
                response->addHeader("Cache-Control", "public, max-age=31536000, immutable");
                response->addHeader("X-Content-Type-Options", "nosniff");
                callback(response);
            } catch (...) {
                callback(drogon::HttpResponse::newNotFoundResponse());
            }
        },
        {drogon::Get});
}
} // namespace snackshop
