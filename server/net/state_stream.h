#ifndef SNACKSHOP_STATE_STREAM_H
#define SNACKSHOP_STATE_STREAM_H
#include <cstdint>
#include <json/json.h>
#include <string>
namespace snackshop {
// Objects merge recursively; unchanged-size object arrays use sparse index patches.
// Primitive/resized arrays replace atomically. Null removes an object member.
Json::Value stateDifference(const Json::Value& previous, const Json::Value& current);
struct StateCursor {
    std::uint64_t revision = 0;
    Json::Value personal;
};
struct StatePacket {
    bool full;
    std::string body;
};
class StateStream {
public:
    void advance(Json::Value world);
    StatePacket packet(StateCursor& cursor, const Json::Value& personal);
    std::uint64_t revision() const { return m_revision; }

private:
    Json::Value m_world;
    std::uint64_t m_revision = 0, m_baseRevision = 0;
    bool m_reset = true;
    std::string m_delta, m_full;
};
} // namespace snackshop
#endif
