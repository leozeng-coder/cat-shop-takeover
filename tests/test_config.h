#ifndef SNACKSHOP_TEST_CONFIG_H
#define SNACKSHOP_TEST_CONFIG_H
#include "config/config_loader.h"
inline std::shared_ptr<const snackshop::GameConfig> testConfig() {
    static auto config = snackshop::ConfigLoader::load(GAME_CONFIG_PATH);
    return config;
}
#endif
