#include "logic_random_item.h"
#include "common/weighted_random.h"
#include "game/logic_economy.h"
#include <algorithm>
#include <stdexcept>
namespace snackshop {
int LogicRandomItem::purchased(const Player& player, const std::string& item) {
    const auto found = player.itemPurchases.find(item);
    return found == player.itemPurchases.end() ? 0 : found->second;
}
std::vector<const RandomItemReward*> LogicRandomItem::pool(const Game& game, int player, const std::string& source) {
    std::vector<const RandomItemReward*> result;
    for (const auto& reward : game.config().randomItems.at(source).rewards) {
        if (reward.weight == 0) {
            continue;
        }
        const auto& item = game.config().item(reward.item);
        const bool owned =
            item.unique && std::any_of(game.dorms.begin(), game.dorms.end(), [&](const auto& room) {
                return room.owner == player && std::any_of(room.props.begin(), room.props.end(), [&](const auto& prop) {
                           return prop.kind == item.id || prop.rewardKind == item.id;
                       });
            });
        if (!owned) {
            result.push_back(&reward);
        }
    }
    return result;
}
std::string LogicRandomItem::purchaseError(const Game& game, int player, const ItemConfig& item) {
    const auto& rule = game.config().randomItems.at(item.id);
    const int count = purchased(game.players.at(player), item.id);
    if (count >= static_cast<int>(rule.purchaseCosts.size())) {
        return "本局翻找次数已用完";
    }
    const auto error = game.purchaseError(player, rule.purchaseCosts[count]);
    if (!error.empty()) {
        return error;
    }
    return pool(game, player, item.id).empty() ? "暂时没有可获得的道具" : std::string{};
}
std::string LogicRandomItem::purchase(Game& game, int player, int cell, const ItemConfig& item, std::mt19937& random) {
    const auto error = purchaseError(game, player, item);
    if (!error.empty()) {
        return error;
    }
    auto& cat = game.players[player];
    const auto& rule = game.config().randomItems.at(item.id);
    const auto candidates = pool(game, player, item.id);
    // Pick the item first: items with more levels must not get more tickets.
    std::vector<int> weights;
    for (const auto* candidate : candidates) {
        weights.push_back(candidate->weight);
    }
    const auto& reward = *candidates[weightedDraw(weights, random)];
    weights.clear();
    for (const auto& level : reward.levels) {
        weights.push_back(level.weight);
    }
    const int level = reward.levels[weightedDraw(weights, random)].level;
    const int count = purchased(cat, item.id);
    LogicEconomy::pay(cat, rule.purchaseCosts[count]);
    Prop prop{cell, item.id};
    prop.rewardKind = reward.item;
    prop.rewardLevel = level;
    prop.revealStartedAt = game.elapsed;
    prop.revealAt = game.elapsed + rule.revealDuration;
    game.dorms[cat.room].props.push_back(std::move(prop));
    cat.itemPurchases[item.id] = count + 1;
    game.emitEvent("item.install", item.id, game.map.center(cell), player);
    return {};
}
void LogicRandomItem::update(Game& game) {
    for (auto& room : game.dorms) {
        for (auto& prop : room.props) {
            if (prop.rewardKind.empty() || game.elapsed + 1e-9 < prop.revealAt) {
                continue;
            }
            const auto source = game.config().item(prop.kind).name;
            game.emitEvent("item.reveal", prop.kind, game.map.center(prop.cell), room.owner);
            prop.kind = std::move(prop.rewardKind);
            prop.rewardKind.clear();
            prop.level = prop.rewardLevel;
            prop.rewardLevel = 0;
            prop.revealStartedAt = prop.revealAt = 0;
            const auto& reward = game.config().item(prop.kind).levels[prop.level - 1];
            game.notify(game.players[room.owner].name + " 翻找" + source + "，获得「" + reward.name + " · " +
                        std::to_string(prop.level) + "级」！");
        }
    }
}
} // namespace snackshop
