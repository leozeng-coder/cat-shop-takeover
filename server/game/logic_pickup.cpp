#include "game.h"
#include "item/logic_item_effect.h"
#include <algorithm>
namespace snackshop {
void Game::tryPickup(Player& player) {
    const int cell = map.cellAt(player.position), roomId = map.roomAt(cell);
    if (roomId < 0) {
        return;
    }
    auto& props = dorms[roomId].props;
    const auto found = std::find_if(props.begin(), props.end(), [&](const Prop& prop) {
        return prop.cell == cell && config().item(prop.kind).behavior == ItemBehavior::Pickup;
    });
    if (found == props.end()) {
        return;
    }
    const auto& item = config().item(found->kind);
    const auto result = LogicItemEffect::apply(*this, player, item, item.levels[found->level - 1]);
    if (!result.applied) {
        return;
    }
    props.erase(found);
    notify(player.name + " 找到" + item.name + " " + result.description);
}
} // namespace snackshop
