#include "logic_combat.h"
#include "common/game_math.h"
#include "logic_progression.h"
#include <algorithm>
namespace snackshop {
bool LogicCombat::ready(const Game& game) {
    const auto& monster = game.monster;
    return game.phase == "running" && monster.hp > 0 && monster.attackCooldown <= 1e-9 &&
           monster.state != "retreating" && monster.state != "resting";
}
bool LogicCombat::hitDoor(Game& game, int id) {
    if (id < 0 || id >= Seats || !ready(game)) {
        return false;
    }
    auto& room = game.dorms[id];
    auto& monster = game.monster;
    if (!room.doorClosed() || GameMath::distance(monster.position, GridMap::center(room.entrance)) >= 2) {
        return false;
    }
    monster.attackCooldown = EnemyAttackInterval;
    room.hp = std::max(0.0, room.hp - LogicProgression::stats(monster).doorDamage);
    ++monster.doorHits;
    ++monster.attackSequence;
    if (LogicProgression::grant(monster, EnemyDoorExperience) > 0) {
        game.notify("店长敲门积累经验，升至 Lv." + std::to_string(monster.level));
    }
    if (room.hp == 0) {
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
        GameMath::distance(monster.position, cat.position) >= EnemyAttackRange) {
        return false;
    }
    const auto adjacent = game.map.neighbors(from);
    return from == to || std::find(adjacent.begin(), adjacent.end(), to) != adjacent.end();
}
bool LogicCombat::catchCat(Game& game, int id) {
    const auto& monster = game.monster;
    if (game.phase != "running" || monster.hp <= 0 || monster.state == "retreating" || monster.state == "resting" ||
        !catInRange(game, id)) {
        return false;
    }
    capture(game, id);
    return true;
}
void LogicCombat::capture(Game& game, int id) {
    if (id < 0 || id >= Seats || !game.players[id].alive) {
        return;
    }
    auto& cat = game.players[id];
    cat.alive = false;
    cat.sleeping = false;
    cat.path.clear();
    cat.nestIntent = -1;
    game.notify(cat.name + " 被店长抱出了猫店");
}
} // namespace snackshop
