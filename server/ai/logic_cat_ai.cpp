#include "logic_cat_ai.h"
#include <algorithm>
namespace snackshop {
void LogicCatAi::update(Game& game, Player& p) {
    if (!p.alive || game.elapsed < p.decisionAt) {
        return;
    }
    p.decisionAt = game.elapsed + 1.4 + std::uniform_real_distribution<double>(0, .8)(game.m_random);
    if (!p.path.empty()) {
        return;
    }
    if (!p.sleeping) {
        if (p.room >= 0) {
            game.command(p.id, GameAction::EnterNest, p.room);
            return;
        }
        std::vector<int> free;
        for (const auto& room : game.dorms) {
            if (room.owner < 0) {
                free.push_back(room.id);
            }
        }
        std::shuffle(free.begin(), free.end(), game.m_random);
        for (int room : free) {
            if (game.command(p.id, GameAction::EnterNest, room).empty()) {
                return;
            }
        }
        return;
    }
    auto& room = game.dorms[p.room];
    if (room.hp < DoorHealth[room.level - 1] * .65 && game.command(p.id, GameAction::Repair, room.id).empty()) {
        return;
    }
    const bool threatened = game.monster.target == p.room && game.phase == "running";
    if (threatened && room.level < 3 && game.command(p.id, GameAction::UpgradeBarricade).empty()) {
        return;
    }
    if (p.bed < 3 && (!threatened || p.personality == 0) && game.command(p.id, GameAction::UpgradeNest).empty()) {
        return;
    }
    if (p.personality == 1 && room.level < 3 && game.command(p.id, GameAction::UpgradeBarricade).empty()) {
        return;
    }
    int launchers = 0;
    for (const auto& prop : room.props) {
        if (prop.kind == PropKind::Launcher) {
            ++launchers;
        }
    }
    if (launchers < 4 && p.gold >= TowerCost[0]) {
        auto cells = room.floor;
        std::sort(cells.begin(), cells.end(), [&](int a, int b) {
            auto dist = [&](int c) {
                return std::abs(c % MapWidth - room.door % MapWidth) + std::abs(c / MapWidth - room.door / MapWidth);
            };
            return dist(a) < dist(b);
        });
        for (int cell : cells) {
            if (!game.propAt(cell) && game.command(p.id, GameAction::Build, -1, cell).empty()) {
                return;
            }
        }
    }
    if (p.bed < 3 && game.command(p.id, GameAction::UpgradeNest).empty()) {
        return;
    }
    if (room.level < 3 && game.command(p.id, GameAction::UpgradeBarricade).empty()) {
        return;
    }
    for (const auto& prop : room.props) {
        if (prop.kind == PropKind::Launcher && prop.level < 3 &&
            game.command(p.id, GameAction::Build, -1, prop.cell, prop.kind).empty()) {
            return;
        }
    }
}
} // namespace snackshop
