#include "logic_combat.h"
#include "ai/logic_cat_ai.h"
#include "common/game_math.h"
#include "item/logic_item.h"
#include "logic_progression.h"
#include <algorithm>
namespace snackshop {
bool LogicCombat::active(const Game& game) {
    const auto& monster = game.monster;
    return game.phase == "running" && monster.hp > 0 && monster.state != "retreating" && monster.state != "defeated" &&
           monster.state != "resting";
}
bool LogicCombat::hitDoor(Game& game, int id) {
    if (!game.validRoom(id) || !active(game)) {
        return false;
    }
    auto& room = game.dorms[id];
    auto& monster = game.monster;
    if (!room.doorClosed() || GameMath::distance(monster.position, GridMap::center(room.entrance)) >= 2) {
        return false;
    }
    LogicItem::updateDoorDefense(game, room);
    if (monster.attackCooldown > 1e-9 || game.elapsed + 1e-9 < room.attackDelayUntil) {
        return false;
    }
    room.attackDelayUntil = 0;
    monster.attackCooldown = game.config().enemy.attackInterval;
    room.hp = std::max(0.0, room.hp - LogicProgression::stats(monster, game.config().enemy).doorDamage);
    monster.lastCombatAt = game.elapsed;
    ++monster.doorHits;
    ++monster.attackSequence;
    if (LogicProgression::grant(monster, game.config().enemy.doorRage, game.config().enemy) > 0) {
        game.notify("店长敲门积累怒气值，升至 Lv." + std::to_string(monster.level));
    }
    if (room.hp == 0) {
        auto& owner = game.players[room.owner];
        const bool returningToNest = owner.nestIntent >= 0;
        LogicCatAi::stop(game, owner);
        owner.sleeping = false;
        owner.nestIntent = -1;
        owner.decisionAt = 0;
        if (returningToNest) {
            owner.path.clear();
        }
        // Connected humans keep control; bots choose their escape on the next AI tick.
        game.notify(std::to_string(room.id + 1) + " 号猫店的店门被打破了，店长正在进屋抓猫");
        monster.repathAt = 0;
        monster.state = "chasing";
    }
    return true;
}
bool LogicCombat::catInRange(const Game& game, int id) {
    if (id < 0 || id >= Seats) {
        return false;
    }
    const auto& cat = game.players[id];
    const auto& monster = game.monster;
    const int from = GridMap::cellAt(monster.position), to = GridMap::cellAt(cat.position);
    if (!cat.alive || !GridMap::valid(from) || !game.walkable(to) ||
        GameMath::distance(monster.position, cat.position) >= game.config().enemy.captureRange) {
        return false;
    }
    const auto adjacent = game.map.neighbors(from);
    return from == to || std::find(adjacent.begin(), adjacent.end(), to) != adjacent.end();
}
bool LogicCombat::catchCat(Game& game, int id) {
    const auto& monster = game.monster;
    if (game.phase != "running" || monster.hp <= 0 || monster.state == "retreating" || monster.state == "defeated" ||
        monster.state == "resting" || !catInRange(game, id)) {
        return false;
    }
    game.monster.lastCombatAt = game.elapsed;
    capture(game, id);
    return true;
}
void LogicCombat::capture(Game& game, int id) {
    if (id < 0 || id >= Seats || !game.players[id].alive) {
        return;
    }
    auto& cat = game.players[id];
    LogicCatAi::stop(game, cat);
    cat.alive = false;
    cat.sleeping = false;
    cat.path.clear();
    cat.nestIntent = -1;
    game.notify(cat.name + " 被店长抱出了猫店");
}
} // namespace snackshop
