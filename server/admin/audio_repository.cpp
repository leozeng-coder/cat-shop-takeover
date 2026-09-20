#include "audio_repository.h"
#include <cmath>
#include <drogon/utils/Utilities.h>
#include <fstream>
#include <set>
#include <string_view>

namespace snackshop {
namespace {
void require(bool condition, const char* message) {
    if (!condition) {
        throw AdminError(422, message);
    }
}
unsigned byte(std::string_view bytes, std::size_t at) {
    return static_cast<unsigned char>(bytes[at]);
}
unsigned le16(std::string_view bytes, std::size_t at) {
    return byte(bytes, at) | (byte(bytes, at + 1) << 8);
}
std::uint32_t le32(std::string_view bytes, std::size_t at) {
    return le16(bytes, at) | (le16(bytes, at + 2) << 16);
}
double duration(std::string_view bytes, const std::string& extension) {
    require(bytes.size() <= 20 * 1024 * 1024 && bytes.size() >= 16, "音频大小须为 16 字节至 20 MB");
    double seconds = 0;
    if (extension == "wav") {
        require(bytes.substr(0, 4) == "RIFF" && bytes.substr(8, 4) == "WAVE" &&
                    std::uint64_t(le32(bytes, 4)) + 8 == bytes.size(),
                "请上传完整的 WAV 音频");
        unsigned rate = 0, align = 0, data = 0;
        for (std::size_t offset = 12; offset + 8 <= bytes.size();) {
            const std::size_t size = le32(bytes, offset + 4), start = offset + 8;
            require(size <= bytes.size() - start, "WAV 音频已损坏");
            if (bytes.substr(offset, 4) == "fmt ") {
                require(size >= 16, "WAV 格式信息不完整");
                const auto format = le16(bytes, start), channels = le16(bytes, start + 2),
                           bits = le16(bytes, start + 14);
                const auto samples = le32(bytes, start + 4);
                rate = le32(bytes, start + 8);
                align = le16(bytes, start + 12);
                require((format == 1 || format == 3) && channels >= 1 && channels <= 2 && samples >= 8000 &&
                            samples <= 192000 && (bits == 8 || bits == 16 || bits == 24 || bits == 32) &&
                            (format != 3 || bits == 32) && align == channels * bits / 8 && rate == samples * align,
                        "WAV 请使用单声道或双声道 PCM / Float 格式");
            } else if (bytes.substr(offset, 4) == "data") {
                data = static_cast<unsigned>(size);
            }
            offset = start + size + (size & 1);
        }
        require(rate > 0 && data > 0 && data % align == 0, "WAV 缺少有效音频数据");
        seconds = static_cast<double>(data) / rate;
    } else if (extension == "mp3") {
        std::size_t offset = 0;
        if (bytes.substr(0, 3) == "ID3") {
            require(bytes.size() >= 10, "MP3 标签不完整");
            std::size_t length = 0;
            for (int i = 6; i < 10; ++i) {
                require(byte(bytes, i) < 128, "MP3 标签无效");
                length = (length << 7) | byte(bytes, i);
            }
            offset = 10 + length + ((byte(bytes, 5) & 16) ? 10 : 0);
        }
        int frames = 0;
        while (offset + 4 <= bytes.size()) {
            if (bytes.size() - offset == 128 && bytes.substr(offset, 3) == "TAG") {
                offset += 128;
                break;
            }
            const auto b1 = byte(bytes, offset + 1), b2 = byte(bytes, offset + 2);
            const auto version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, bitrateIndex = b2 >> 4,
                       rateIndex = (b2 >> 2) & 3;
            require(byte(bytes, offset) == 255 && (b1 & 224) == 224 && version != 1 && layer == 1 && bitrateIndex > 0 &&
                        bitrateIndex < 15 && rateIndex < 3,
                    "MP3 音频帧无效，请重新导出");
            const int rates[]{44100, 48000, 32000};
            const int high[]{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320};
            const int low[]{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160};
            const int rate = rates[rateIndex] / (version == 3 ? 1 : version == 2 ? 2 : 4);
            const auto length = static_cast<std::size_t>(
                (version == 3 ? 144000 : 72000) * (version == 3 ? high[bitrateIndex] : low[bitrateIndex]) / rate +
                ((b2 >> 1) & 1));
            require(length >= 4 && length <= bytes.size() - offset, "MP3 音频帧不完整");
            seconds += (version == 3 ? 1152.0 : 576.0) / rate;
            offset += length;
            ++frames;
        }
        require(frames >= 2 && offset == bytes.size(), "请上传完整的 MP3 音频");
    } else {
        throw AdminError(415, "仅支持 MP3 和 WAV 音频");
    }
    require(seconds > 0 && seconds <= 600, "音频时长须在 10 分钟以内");
    return seconds;
}
std::string readBytes(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    require(file && file.tellg() > 0 && file.tellg() <= 20 * 1024 * 1024, "音频文件不存在或过大");
    std::string bytes(static_cast<std::size_t>(file.tellg()), '\0');
    file.seekg(0);
    require(static_cast<bool>(file.read(bytes.data(), bytes.size())), "无法读取音频");
    return bytes;
}
Json::Value newDraft(const Json::Value& current) {
    Json::Value value;
    value["baseRevision"] = current["revision"];
    value["tables"] = current;
    value["tables"].removeMember("revision");
    value["revision"] = drogon::utils::getUuid();
    return value;
}
} // namespace
AudioRepository::AudioRepository(std::filesystem::path assets, std::filesystem::path storage)
    : m_root(std::filesystem::absolute(assets) / "audio"), m_storage(std::filesystem::absolute(storage) / "audio"),
      m_library(assets) {
    std::filesystem::create_directories(m_root / "files");
    std::filesystem::create_directories(m_storage / "files");
    std::filesystem::create_directories(m_storage / "releases");
    if (std::filesystem::exists(m_storage / "pending.json")) {
        activate(readAdminJson(m_storage / "pending.json"));
        storeDraft(newDraft(m_library.current()));
        std::filesystem::remove(m_storage / "pending.json");
    } else if (!std::filesystem::exists(m_root / "manifest.json")) {
        activate(AudioLibrary::defaults());
    }
}
void AudioRepository::storeDraft(Json::Value value) {
    value["revision"] = drogon::utils::getUuid();
    writeAdminJson(m_storage / "draft.json", value);
}
Json::Value AudioRepository::draft() {
    if (!std::filesystem::exists(m_storage / "draft.json")) {
        storeDraft(newDraft(m_library.current()));
    }
    return readAdminJson(m_storage / "draft.json");
}
Json::Value AudioRepository::workspaceUnlocked() {
    Json::Value value;
    value["current"] = m_library.current();
    value["draft"] = draft();
    value["events"] = AudioLibrary::events();
    value["conflict"] = value["draft"]["baseRevision"] != value["current"]["revision"];
    return value;
}
Json::Value AudioRepository::workspace() {
    std::lock_guard lock(m_mutex);
    return workspaceUnlocked();
}
void AudioRepository::checkRevision(const Json::Value& request, const Json::Value& value) {
    if (request["revision"] != value["revision"]) {
        throw AdminError(409, "音效草稿已更新，请刷新后重试");
    }
    if (value["baseRevision"] != m_library.current()["revision"]) {
        throw AdminError(409, "正式音效已变化，请重新载入");
    }
}
Json::Value AudioRepository::save(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    auto value = draft();
    checkRevision(request, value);
    try {
        AudioLibrary::validate(request["tables"]);
    } catch (const std::exception& error) {
        throw AdminError(422, error.what());
    }
    // Files and measured metadata can only originate from the upload endpoint.
    for (const auto& clip : request["tables"]["clips"]) {
        bool found = false;
        for (const auto& previous : value["tables"]["clips"]) {
            if (previous["id"] == clip["id"]) {
                found = previous["file"] == clip["file"] &&
                        previous["duration"].asDouble() == clip["duration"].asDouble() &&
                        previous["bytes"].asUInt64() == clip["bytes"].asUInt64();
            }
        }
        require(found, "音频文件与时长只能通过上传或替换更新");
    }
    value["tables"] = request["tables"];
    storeDraft(value);
    return workspaceUnlocked();
}
std::filesystem::path AudioRepository::previewFile(const std::string& file) const {
    require(AudioLibrary::validFile(file), "音频路径无效");
    const auto staged = m_storage / "files" / file;
    const auto path = std::filesystem::exists(staged) ? staged : m_root / "files" / file;
    const auto resolved = std::filesystem::canonical(path);
    require(resolved.parent_path() == std::filesystem::canonical(path.parent_path()) &&
                std::filesystem::is_regular_file(resolved),
            "音频路径无效");
    return resolved;
}
void AudioRepository::checkFiles(const Json::Value& tables) const {
    for (const auto& clip : tables["clips"]) {
        const auto file = clip["file"].asString(), bytes = readBytes(previewFile(file));
        require(drogon::utils::getSha256(bytes) == file.substr(0, 64) && bytes.size() == clip["bytes"].asUInt64(),
                "音频文件已改变，请重新上传");
    }
}
Json::Value AudioRepository::validate(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    auto value = draft();
    checkRevision(request, value);
    try {
        AudioLibrary::validate(value["tables"]);
    } catch (const std::exception& error) {
        throw AdminError(422, error.what());
    }
    checkFiles(value["tables"]);
    Json::Value result;
    result["ok"] = true;
    return result;
}
Json::Value AudioRepository::upload(const std::string& bytes, const std::string& extension,
                                    const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    auto value = draft();
    checkRevision(request, value);
    const auto seconds = duration(bytes, extension), size = static_cast<double>(bytes.size());
    const auto file = drogon::utils::getSha256(bytes) + "." + extension;
    const auto id = request.get("id", "").asString();
    auto& clips = value["tables"]["clips"];
    Json::Value* clip = nullptr;
    if (!id.empty()) {
        for (auto& entry : clips) {
            if (entry["id"] == id) {
                clip = &entry;
            }
        }
    }
    require(id.empty() || clip, "要替换的音效不存在");
    if (!clip) {
        Json::Value entry;
        entry["id"] = "audio_" + drogon::utils::getUuid();
        entry["name"] = request["name"];
        entry["category"] = request["category"];
        if (request.isMember("group")) {
            entry["group"] = request["group"];
        }
        entry["enabled"] = true;
        clips.append(entry);
        clip = &clips[clips.size() - 1];
    }
    (*clip)["file"] = file;
    (*clip)["duration"] = seconds;
    (*clip)["bytes"] = size;
    try {
        AudioLibrary::validate(value["tables"]);
    } catch (const std::exception& error) {
        throw AdminError(422, error.what());
    }
    const auto target = m_storage / "files" / file;
    if (!std::filesystem::exists(target)) {
        std::ofstream output(target, std::ios::binary | std::ios::trunc);
        output.write(bytes.data(), bytes.size());
        output.flush();
        require(static_cast<bool>(output), "音频写入失败");
    }
    storeDraft(value);
    return workspaceUnlocked();
}
void AudioRepository::activate(const Json::Value& tables) {
    const auto version = AudioLibrary::hash(tables);
    std::set<std::string> files;
    for (const auto& clip : tables["clips"]) {
        const auto name = clip["file"].asString();
        files.insert(name);
        const auto destination = m_root / "files" / name;
        if (!std::filesystem::exists(destination)) {
            std::filesystem::copy_file(previewFile(name), destination);
        }
    }
    for (const auto* name : {"clips", "bindings", "settings"}) {
        writeAdminJson(m_root / (std::string(name) + ".json"), tables[name]);
    }
    if (tables.isMember("groups")) {
        writeAdminJson(m_root / "groups.json", tables["groups"]);
    }
    Json::Value manifest;
    manifest["schema"] = tables.isMember("groups") ? 2 : 1;
    manifest["revision"] = version;
    writeAdminJson(m_root / "manifest.json", manifest);
    // Production assets contain the latest set only. Drafts/history live in client-admin.
    for (const auto& entry : std::filesystem::directory_iterator(m_root / "files")) {
        const auto name = entry.path().filename().string();
        if (entry.is_regular_file() && AudioLibrary::validFile(name) && !files.contains(name)) {
            const auto archive = m_storage / "files" / name;
            if (!std::filesystem::exists(archive)) {
                std::filesystem::copy_file(entry.path(), archive);
            }
            std::filesystem::remove(entry.path());
        }
    }
}
Json::Value AudioRepository::publish(const Json::Value& request) {
    std::lock_guard lock(m_mutex);
    auto value = draft();
    checkRevision(request, value);
    try {
        AudioLibrary::validate(value["tables"]);
    } catch (const std::exception& error) {
        throw AdminError(422, error.what());
    }
    checkFiles(value["tables"]);
    auto current = m_library.current();
    current.removeMember("revision");
    writeAdminJson(m_storage / "releases" / (AudioLibrary::hash(current) + ".json"), current);
    writeAdminJson(m_storage / "pending.json", value["tables"]);
    activate(value["tables"]);
    storeDraft(newDraft(m_library.current()));
    std::filesystem::remove(m_storage / "pending.json");
    return workspaceUnlocked();
}
} // namespace snackshop
