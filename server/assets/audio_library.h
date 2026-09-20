#ifndef CAT_SHOP_AUDIO_LIBRARY_H
#define CAT_SHOP_AUDIO_LIBRARY_H
#include <filesystem>
#include <json/json.h>
#include <mutex>

namespace snackshop {
// Shared presentation data. Game simulation never depends on audio availability.
class AudioLibrary {
public:
    explicit AudioLibrary(std::filesystem::path assets);
    Json::Value current();
    std::filesystem::path file(const std::string& name) const;
    static Json::Value defaults();
    static Json::Value events();
    static std::string hash(const Json::Value& value);
    static bool validFile(const std::string& name);
    static void validate(const Json::Value& tables);
    static Json::Value read(const std::filesystem::path& path);

private:
    std::filesystem::path m_root;
    Json::Value m_current;
    std::mutex m_mutex;
};
void registerAudioRoutes(const std::filesystem::path& assets);
} // namespace snackshop
#endif
