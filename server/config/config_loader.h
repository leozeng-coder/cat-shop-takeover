#ifndef SNACKSHOP_CONFIG_LOADER_H
#define SNACKSHOP_CONFIG_LOADER_H
#include "game_config.h"
#include <filesystem>
#include <mutex>
namespace snackshop {
class ConfigLoader {
public:
    static std::filesystem::path sourceDirectory(const std::filesystem::path& path);
    static std::shared_ptr<const GameConfig> parse(const std::string& text);
    static std::shared_ptr<const GameConfig> load(const std::filesystem::path& path);
};
// A complete validated bundle is published atomically. Existing games retain their snapshot.
class ConfigStore {
public:
    explicit ConfigStore(std::filesystem::path path);
    std::shared_ptr<const GameConfig> current() const;
    bool reload(std::string& error);

private:
    std::filesystem::path m_path;
    mutable std::mutex m_mutex;
    std::shared_ptr<const GameConfig> m_current;
};
} // namespace snackshop
#endif
