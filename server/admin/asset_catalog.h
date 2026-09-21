#ifndef CAT_SHOP_ASSET_CATALOG_H
#define CAT_SHOP_ASSET_CATALOG_H
#include <filesystem>
#include <json/json.h>

namespace snackshop {
// All clients consume the same source library. Client records describe integrations, not copies.
class AssetCatalog {
public:
    explicit AssetCatalog(std::filesystem::path source = {});
    Json::Value catalog() const;
    Json::Value savePresentation(const Json::Value& request) const;
    Json::Value clients() const;
    std::filesystem::path file(const std::string& relative) const;
    const std::filesystem::path& root() const { return m_source; }

private:
    std::filesystem::path m_source;
};
} // namespace snackshop
#endif
