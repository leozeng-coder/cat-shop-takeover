#ifndef CAT_SHOP_AUDIO_REPOSITORY_H
#define CAT_SHOP_AUDIO_REPOSITORY_H
#include "assets/audio_library.h"
#include "config_repository.h"

namespace snackshop {
class AudioRepository {
public:
    AudioRepository(std::filesystem::path assets, std::filesystem::path storage);
    Json::Value workspace();
    Json::Value save(const Json::Value& request);
    Json::Value publish(const Json::Value& request);
    Json::Value validate(const Json::Value& request);
    Json::Value upload(const std::string& bytes, const std::string& extension, const Json::Value& request);
    std::filesystem::path previewFile(const std::string& file) const;

private:
    std::filesystem::path m_root, m_storage;
    AudioLibrary m_library;
    std::mutex m_mutex;
    Json::Value draft();
    Json::Value workspaceUnlocked();
    void checkRevision(const Json::Value& request, const Json::Value& draft);
    void storeDraft(Json::Value value);
    void checkFiles(const Json::Value& tables) const;
    void activate(const Json::Value& tables);
};
} // namespace snackshop
#endif
