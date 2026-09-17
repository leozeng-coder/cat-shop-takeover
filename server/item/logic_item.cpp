#include "logic_item.h"
#include "common/game_math.h"
#include "game/logic_economy.h"
#include <algorithm>
#include <cmath>
namespace snackshop {
namespace {
int periods(double& elapsed, double dt, int intervalMs) {
    const double interval = intervalMs / 1000.0;
    elapsed += dt;
    const int count = static_cast<int>(std::floor((elapsed + 1e-9) / interval));
    elapsed = std::max(0.0, elapsed - count * interval);
    return count;
}
void produce(Game& game, Dorm& room, const ItemConfig& item, const LevelConfig& level, int count) {
    LogicEconomy::credit(game.players[room.owner], game.config(), item.currency, level.amount * count);
}
void repair(Game& game, Dorm& room, const ItemConfig&, const LevelConfig& level, int count) {
    if (room.hp > 0) {
        room.hp = std::min(static_cast<double>(game.config().door(room.level).health), room.hp + level.amount * count);
    }
}
using PassiveHandler = void (*)(Game&, Dorm&, const ItemConfig&, const LevelConfig&, int);
PassiveHandler passiveHandler(ItemBehavior behavior) {
    switch (behavior) {
    case ItemBehavior::CurrencyProducer:
        return produce;
    case ItemBehavior::DoorRepair:
        return repair;
    default:
        return nullptr;
    }
}
} // namespace
void LogicItem::updatePassive(Game& game, double dt) {
    for (auto& p : game.players) {
        if (!p.alive || p.room < 0 || game.dorms[p.room].owner != p.id) {
            continue;
        }
        const auto& nest = game.config().nest(p.bed);
        const int count = periods(p.productionRemainder, dt, nest.intervalMs);
        if (count) {
            LogicEconomy::credit(p, game.config(), nest.currency, count * nest.amount);
        }
    }
    for (auto& room : game.dorms) {
        if (room.owner < 0 || !game.players[room.owner].alive) {
            continue;
        }
        for (auto& prop : room.props) {
            const auto& item = game.config().item(prop.kind);
            const auto handler = passiveHandler(item.behavior);
            if (!handler) {
                continue;
            }
            const auto& level = item.levels[prop.level - 1];
            const int count = periods(prop.cooldown, dt, level.intervalMs);
            if (count) {
                handler(game, room, item, level, count);
            }
        }
    }
}
void LogicItem::updateAttack(Game& game, double dt) {
    auto& monster = game.monster;
    for (auto& room : game.dorms) {
        if (room.owner < 0 || !game.players[room.owner].alive) {
            continue;
        }
        for (auto& prop : room.props) {
            const auto& item = game.config().item(prop.kind);
            if (item.behavior != ItemBehavior::SingleAttack) {
                continue;
            }
            const auto& level = item.levels[prop.level - 1];
            prop.cooldown = std::max(0.0, prop.cooldown - dt);
            if (prop.cooldown > 1e-9 || monster.hp <= 0 ||
                GameMath::distance(GridMap::center(prop.cell), monster.position) > level.range) {
                continue;
            }
            prop.cooldown = level.intervalMs / 1000.0;
            prop.lastShot = game.elapsed;
            monster.hp = std::max(0.0, monster.hp - level.amount);
            monster.lastCombatAt = game.elapsed;
        }
    }
}
} // namespace snackshop
