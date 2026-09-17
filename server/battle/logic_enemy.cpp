#include "logic_enemy.h"
#include "common/game_math.h"
#include "logic_combat.h"
#include "logic_progression.h"
#include <algorithm>
#include <limits>
namespace snackshop {
namespace {
void setAttackingPlayer(Game& game, int player) {
    auto& monster = game.monster;
    if (monster.attackingPlayer != player) {
        monster.attackingPlayer = player;
        monster.attackStartedAt = player >= 0 ? game.elapsed : -1;
    }
}
} // namespace
void LogicEnemy::update(Game& game, double dt) {
    if (game.phase != "running") {
        setAttackingPlayer(game, -1);
        return;
    }
    auto& m = game.monster;
    const double combatTime = std::min(dt, std::max(0.0, game.elapsed - game.balance.preparation));
    if (LogicProgression::advanceTime(m, combatTime) > 0) {
        game.notify("店长随时间成长，升至 Lv." + std::to_string(m.level));
    }
    m.attackCooldown = std::max(0.0, m.attackCooldown - dt);
    const double speed = LogicProgression::stats(m).speed;
    if (m.state == "retreating") {
        setAttackingPlayer(game, -1);
        if (m.path.empty()) {
            m.path = game.pathTo(m.position, game.map.shopkeeperSpawn);
        }
        game.moveAlong(m.position, m.path, speed * 1.6 * dt);
        if (GameMath::distance(m.position, GridMap::center(game.map.shopkeeperSpawn)) < 2) {
            m.state = "resting";
            m.restUntil = game.elapsed + EnemyRestDuration;
        }
        return;
    }
    if (m.state == "resting") {
        setAttackingPlayer(game, -1);
        m.hp = std::min(m.maxHp, m.hp + m.maxHp / EnemyRecoveryDuration * dt);
        if (game.elapsed >= m.restUntil) {
            m.state = "hunting";
            ++m.raids;
            m.prey = -1;
            game.notify("店长整理好围裙，再次回来抓猫");
        }
        return;
    }
    if (m.prey < 0 || !game.players[m.prey].alive) {
        double best = std::numeric_limits<double>::max();
        m.prey = -1;
        for (const auto& cat : game.players) {
            if (!cat.alive) {
                continue;
            }
            const int room = game.map.roomAt(GridMap::cellAt(cat.position));
            const int destination =
                room >= 0 && game.dorms[room].doorClosed() ? game.dorms[room].entrance : GridMap::cellAt(cat.position);
            const auto route = game.pathTo(m.position, destination);
            if (route.empty()) {
                continue;
            }
            const double score = static_cast<double>(route.size()) + cat.id * .03;
            if (score < best) {
                best = score;
                m.prey = cat.id;
            }
        }
        m.repathAt = 0;
        if (m.prey < 0) {
            setAttackingPlayer(game, -1);
            return;
        }
    }
    auto& prey = game.players[m.prey];
    const int preyCell = GridMap::cellAt(prey.position), roomId = game.map.roomAt(preyCell);
    const bool locked =
        roomId >= 0 && game.dorms[roomId].doorClosed() && game.map.roomAt(GridMap::cellAt(m.position)) != roomId;
    m.target = roomId;
    const int destination = locked ? game.dorms[roomId].entrance : preyCell;
    if (game.elapsed >= m.repathAt || m.destination != destination) {
        m.path = game.pathTo(m.position, destination);
        m.destination = destination;
        m.repathAt = game.elapsed + .6;
    }
    int attackedPlayer = -1;
    if (locked && GameMath::distance(m.position, GridMap::center(destination)) < 2) {
        attackedPlayer = game.dorms[roomId].owner;
        m.state = "attacking";
        LogicCombat::hitDoor(game, roomId);
        if (!game.dorms[roomId].doorClosed()) {
            attackedPlayer = -1;
        }
    } else {
        m.state = locked ? "hunting" : "chasing";
        game.moveAlong(m.position, m.path, speed * dt);
        if (!locked && LogicCombat::catchCat(game, prey.id)) {
            m.prey = -1;
            m.target = -1;
            m.path.clear();
            m.state = "hunting";
        }
    }
    for (auto& room : game.dorms) {
        if (room.owner < 0 || !game.players[room.owner].alive) {
            continue;
        }
        for (auto& prop : room.props) {
            if (prop.kind != PropKind::Launcher) {
                continue;
            }
            prop.cooldown = std::max(0.0, prop.cooldown - dt);
            if (prop.cooldown > 0 || GameMath::distance(GridMap::center(prop.cell), m.position) > 235) {
                continue;
            }
            prop.cooldown = .85;
            prop.lastShot = game.elapsed;
            m.hp = std::max(0.0, m.hp - TowerDamage[prop.level - 1]);
        }
    }
    if (m.hp <= 0) {
        for (auto& cat : game.players) {
            if (cat.alive) {
                cat.gold += 35;
            }
        }
        game.notify("毛线弹赶退了店长！每只留守猫获得 35 罐头");
        m.state = "retreating";
        attackedPlayer = -1;
        m.prey = -1;
        m.target = -1;
        m.path.clear();
    }
    setAttackingPlayer(game, attackedPlayer);
}
} // namespace snackshop
