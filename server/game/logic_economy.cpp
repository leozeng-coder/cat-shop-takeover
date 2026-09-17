#include "logic_economy.h"
#include "game.h"
#include <algorithm>
namespace snackshop {
void LogicEconomy::initialize(Player& player, const GameConfig& config) {
    player.wallet.clear();
    for (const auto& currency : config.currencies) {
        player.wallet.emplace(currency.id, currency.initial);
    }
}
int LogicEconomy::balance(const Player& player, const std::string& currency) {
    const auto it = player.wallet.find(currency);
    return it == player.wallet.end() ? 0 : it->second;
}
bool LogicEconomy::canPay(const Player& player, const Cost& cost) {
    return std::all_of(cost.begin(), cost.end(),
                       [&](const auto& c) { return balance(player, c.currency) >= c.amount; });
}
bool LogicEconomy::pay(Player& player, const Cost& cost) {
    // Costs are validated, positive and unique by currency. Debit all currencies only after checking all.
    if (!canPay(player, cost)) {
        return false;
    }
    for (const auto& c : cost) {
        player.wallet.at(c.currency) -= c.amount;
    }
    return true;
}
void LogicEconomy::credit(Player& player, const GameConfig& config, const std::string& currency, int amount) {
    auto& balance = player.wallet.at(currency);
    const int room = config.currency(currency).limit - balance;
    balance += std::min(room, amount);
}
void LogicEconomy::reward(Player& player, const GameConfig& config, const Cost& amounts) {
    for (const auto& c : amounts) {
        credit(player, config, c.currency, c.amount);
    }
}
std::string Game::purchaseError(int id, const Cost& cost, const Requirements& required) const {
    const auto& p = players.at(id);
    if (!p.alive) {
        return "你被店长抱走了";
    }
    if (p.room < 0) {
        return "先走到罐头窝安家";
    }
    if (dorms[p.room].level < required.doorStage) {
        return "需要店门达到" + config().door(required.doorStage).displayName();
    }
    if (p.bed < required.nestLevel) {
        return "需要罐头窝达到 " + std::to_string(required.nestLevel) + "级";
    }
    for (const auto& c : cost) {
        if (LogicEconomy::balance(p, c.currency) < c.amount) {
            return config().currency(c.currency).name + "不足";
        }
    }
    return {};
}
std::string Game::nestUpgradeError(int id) const {
    const auto& p = players.at(id);
    const int next = config().nest(p.bed).nextLevel;
    if (!next) {
        return "罐头窝已经满级";
    }
    const auto& level = config().nest(next);
    return purchaseError(id, level.cost, level.requirements);
}
std::string Game::doorUpgradeError(int id) const {
    const auto& p = players.at(id);
    if (p.room < 0) {
        return "先走到罐头窝安家";
    }
    const auto& room = dorms[p.room];
    if (room.hp <= 0) {
        return "店门已被拆毁，快躲开店长";
    }
    const int next = config().door(room.level).nextStage;
    if (!next) {
        return "店门已经满级";
    }
    const auto& level = config().door(next);
    return purchaseError(id, level.cost, level.requirements);
}
std::string Game::repairError(int id, int targetRoom) const {
    if (targetRoom < 0 || targetRoom >= Seats) {
        return "请选择店门";
    }
    const auto& room = dorms[targetRoom];
    if (room.owner < 0 || !players[room.owner].alive || room.hp <= 0) {
        return "这个店门无法修补";
    }
    if (room.hp >= config().door(room.level).health) {
        return "店门状态完好";
    }
    if (elapsed < players.at(id).repairAt) {
        return "修补冷却中";
    }
    return purchaseError(id, config().repair.cost);
}
} // namespace snackshop
