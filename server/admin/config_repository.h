#ifndef CAT_SHOP_CONFIG_REPOSITORY_H
#define CAT_SHOP_CONFIG_REPOSITORY_H
#include <filesystem>
#include <json/json.h>
#include <mutex>
#include <stdexcept>

namespace snackshop {
struct AdminError : std::runtime_error {
    int status;
    AdminError(int code, const std::string& message) : std::runtime_error(message), status(code) {}
};

// One durable draft; optimistic revisions protect multiple browser tabs and external edits.
class ConfigRepository {
public:
    ConfigRepository(std::filesystem::path config, std::filesystem::path storage);
    Json::Value workspace();
    Json::Value save(const Json::Value& request);
    Json::Value validate(const Json::Value& request);
    Json::Value publish(const Json::Value& request);
    Json::Value rollback(const Json::Value& request);
    Json::Value reset(const Json::Value& request);
    Json::Value history();

private:
    std::filesystem::path m_config, m_storage;
    std::mutex m_mutex;
    Json::Value current() const;
    Json::Value draft();
    Json::Value workspaceUnlocked();
    void checkRevision(const Json::Value& request, const Json::Value& draft) const;
    Json::Value makeDraft(const Json::Value& current);
    std::string snapshot(const Json::Value& tables, const std::string& note, const std::string& from = "");
    Json::Value activate(Json::Value tables, const std::string& note, const std::string& from = "");
};
Json::Value readAdminJson(const std::filesystem::path& path);
void writeAdminJson(const std::filesystem::path& path, const Json::Value& value);
} // namespace snackshop
#endif
