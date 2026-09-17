#include "game_config.h"
#include <algorithm>
#include <stdexcept>
namespace snackshop {
std::string DoorConfig::displayName() const {
    return name + " " + std::to_string(displayLevel) + "级";
}
const CurrencyConfig& GameConfig::currency(const std::string& id) const {
    const auto it = std::find_if(currencies.begin(), currencies.end(), [&](const auto& c) { return c.id == id; });
    if (it == currencies.end()) {
        throw std::out_of_range("Unknown currency: " + id);
    }
    return *it;
}
const DoorConfig& GameConfig::door(int stage) const {
    return doors.at(stage - 1);
}
const NestConfig& GameConfig::nest(int level) const {
    return nests.at(level - 1);
}
const ItemConfig& GameConfig::item(const std::string& id) const {
    return items.at(id);
}
const char* behaviorName(ItemBehavior behavior) {
    switch (behavior) {
    case ItemBehavior::Obstacle:
        return "obstacle";
    case ItemBehavior::Pickup:
        return "pickup";
    case ItemBehavior::CurrencyProducer:
        return "currency_producer";
    case ItemBehavior::SingleAttack:
        return "single_attack";
    case ItemBehavior::DoorRepair:
        return "door_repair";
    }
    throw std::logic_error("Unregistered item behavior");
}
} // namespace snackshop
