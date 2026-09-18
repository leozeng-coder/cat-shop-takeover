#include "state_stream.h"
#include <utility>
namespace snackshop {
namespace {
std::string encodeState(const Json::Value& value) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    builder["emitUTF8"] = true;
    return Json::writeString(builder, value);
}
bool objectArray(const Json::Value& value) {
    if (!value.isArray() || value.empty()) {
        return false;
    }
    for (const auto& item : value) {
        if (!item.isObject()) {
            return false;
        }
    }
    return true;
}
} // namespace
Json::Value stateDifference(const Json::Value& previous, const Json::Value& current) {
    Json::Value patch(Json::objectValue);
    if (previous == current) {
        return patch;
    }
    if (previous.isObject() && current.isObject()) {
        for (const auto& key : previous.getMemberNames()) {
            if (!current.isMember(key)) {
                patch[key] = Json::nullValue;
            }
        }
        for (const auto& key : current.getMemberNames()) {
            if (!previous.isMember(key)) {
                patch[key] = current[key];
            } else if (previous[key] != current[key]) {
                patch[key] = stateDifference(previous[key], current[key]);
            }
        }
        return patch;
    }
    if (previous.size() == current.size() && objectArray(previous) && objectArray(current)) {
        for (Json::ArrayIndex i = 0; i < current.size(); ++i) {
            if (previous[i] != current[i]) {
                patch[std::to_string(i)] = stateDifference(previous[i], current[i]);
            }
        }
        return patch;
    }
    return current;
}
void StateStream::advance(Json::Value world) {
    m_reset = !m_revision || world["map"]["seed"] != m_world["map"]["seed"] ||
              world["configVersion"] != m_world["configVersion"];
    m_baseRevision = m_revision++;
    m_delta = m_reset ? "{}" : encodeState(stateDifference(m_world, world));
    m_world = std::move(world);
    m_full.clear();
}
StatePacket StateStream::packet(StateCursor& cursor, const Json::Value& personal) {
    const bool full = m_reset || cursor.revision == 0 || cursor.revision != m_baseRevision;
    if (full && m_full.empty()) {
        m_full = encodeState(m_world);
    }
    const auto privatePart = full ? personal : stateDifference(cursor.personal, personal);
    std::string body = "{\"revision\":" + std::to_string(m_revision) +
                       ",\"baseRevision\":" + std::to_string(full ? 0 : m_baseRevision);
    body += ",\"world\":" + (full ? m_full : m_delta) + ",\"personal\":" + encodeState(privatePart) + "}";
    cursor.revision = m_revision;
    cursor.personal = personal;
    return {full, std::move(body)};
}
} // namespace snackshop
