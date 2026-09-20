#include "logic_random_item.h"
#include "game/logic_economy.h"
#include <algorithm>
namespace snackshop {
int LogicRandomItem::purchased(const Player& player, const std::string& item) {
    const auto found = player.itemPurchases.find(item);
    return found == player.itemPurchases.end() ? 0 : found->second;
}
std::vector<const ItemConfig*> LogicRandomItem::pool(const Game& game, int player) {
    std::vector<const ItemConfig*> result;
    for (const auto& [id, item] : game.config().items) {
        if (!item.buildable || item.behavior == ItemBehavior::RandomItem) {
            continue;
        }
        const bool owned =
            item.unique && std::any_of(game.dorms.begin(), game.dorms.end(), [&](const auto& room) {
                return room.owner == player && std::any_of(room.props.begin(), room.props.end(), [&](const auto& prop) {
                           return prop.kind == id || prop.rewardKind == id;
                       });
            });
        if (!owned) {
            result.push_back(&item);
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
    return pool(game, player).empty() ? "暂时没有可获得的道具" : std::string{};
}
std::string LogicRandomItem::purchase(Game& game, int player, int cell, const ItemConfig& item, std::mt19937& random) {
    const auto error = purchaseError(game, player, item);
    if (!error.empty()) {
        return error;
    }
    auto& cat = game.players[player];
    const auto& rule = game.config().randomItems.at(item.id);
    const auto candidates = pool(game, player);
    // Pick the item first: items with more levels must not get more tickets.
    const auto& reward = *candidates[std::uniform_int_distribution<std::size_t>(0, candidates.size() - 1)(random)];
    std::vector<double> weights;
    double weight = 1;
    for (std::size_t i = 0; i < reward.levels.size(); ++i) {
        weights.push_back(weight);
        weight *= rule.levelWeightDecay;
    }
    const int level = 1 + std::discrete_distribution<int>(weights.begin(), weights.end())(random);
    const int count = purchased(cat, item.id);
    LogicEconomy::pay(cat, rule.purchaseCosts[count]);
    Prop prop{cell, item.id};
    prop.rewardKind = reward.id;
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
