#include "game_snapshot.h"
#include "battle/logic_progression.h"
#include <algorithm>
namespace snackshop {
namespace {
const char* propName(PropKind kind) {
    switch (kind) {
    case PropKind::Crate:
        return "crate";
    case PropKind::Launcher:
        return "launcher";
    case PropKind::Pantry:
        return "pantry";
    case PropKind::Repair:
        return "repair";
    default:
        return "shelf";
    }
}
} // namespace
Json::Value GameSnapshot::encode(const Game& g, int viewer) {
    Json::Value value;
    value["type"] = "state";
    value["code"] = g.code;
    value["capacity"] = g.capacity;
    value["phase"] = g.phase;
    value["host"] = g.host;
    value["you"] = viewer;
    value["elapsed"] = g.elapsed;
    value["duration"] = g.balance.duration;
    value["preparation"] = g.balance.preparation;
    value["minimumHumans"] = g.minimumHumans();
    value["tick"] = Json::UInt64(g.tick);
    auto& map = value["map"];
    map["width"] = MapWidth;
    map["height"] = MapHeight;
    map["tileSize"] = TileSize;
    map["seed"] = g.map.seed;
    map["spawn"] = g.map.spawn;
    for (const auto& row : g.map.rows) {
        map["rows"].append(row);
    }
    for (const auto& p : g.players) {
        Json::Value j;
        j["id"] = p.id;
        j["name"] = p.name;
        j["human"] = p.human;
        j["connected"] = p.connected;
        j["ready"] = p.ready;
        j["bot"] = !p.human || (!p.connected && p.disconnectedFor >= g.balance.reconnectGrace);
        j["alive"] = p.alive;
        j["sleeping"] = p.sleeping;
        j["room"] = p.room;
        j["gold"] = p.gold;
        j["bed"] = p.bed;
        j["income"] = g.income(p);
        j["x"] = p.position.x;
        j["y"] = p.position.y;
        j["repairCooldown"] = std::max(0.0, p.repairAt - g.elapsed);
        j["destination"] = p.path.empty() ? -1 : GridMap::cellAt(p.path.back());
        j["path"] = Json::Value(Json::arrayValue);
        for (const auto& point : p.path) {
            j["path"].append(GridMap::cellAt(point));
        }
        value["players"].append(j);
    }
    for (const auto& d : g.dorms) {
        Json::Value j;
        j["id"] = d.id;
        j["owner"] = d.owner;
        j["level"] = d.level;
        j["hp"] = d.hp;
        j["maxHp"] = DoorHealth[d.level - 1];
        j["door"] = d.door;
        j["closed"] = d.doorClosed();
        j["nest"] = d.nest;
        j["entrance"] = d.entrance;
        j["area"] = static_cast<int>(d.floor.size());
        j["props"] = Json::Value(Json::arrayValue);
        for (const auto& p : d.props) {
            Json::Value prop;
            prop["cell"] = p.cell;
            prop["kind"] = propName(p.kind);
            prop["level"] = p.level;
            prop["lastShot"] = p.lastShot;
            j["props"].append(prop);
        }
        value["dorms"].append(j);
    }
    auto& m = value["monster"];
    m["x"] = g.monster.position.x;
    m["y"] = g.monster.position.y;
    m["hp"] = g.monster.hp;
    m["maxHp"] = g.monster.maxHp;
    m["level"] = g.monster.level;
    m["experience"] = g.monster.experience;
    m["nextExperience"] = LogicProgression::stats(g.monster).nextExperience;
    m["maxLevel"] = static_cast<int>(EnemyLevels.size());
    m["doorHits"] = g.monster.doorHits;
    m["attackingPlayer"] = g.phase == "running" ? g.monster.attackingPlayer : -1;
    m["attackStartedAt"] = g.monster.attackStartedAt;
    m["attackSequence"] = Json::UInt64(g.monster.attackSequence);
    m["doorDamage"] = LogicProgression::stats(g.monster).doorDamage;
    m["target"] = g.monster.target;
    m["prey"] = g.monster.prey;
    m["state"] = g.monster.state;
    m["path"] = Json::Value(Json::arrayValue);
    for (const auto& point : g.monster.path) {
        m["path"].append(GridMap::cellAt(point));
    }
    value["notices"] = Json::Value(Json::arrayValue);
    for (const auto& notice : g.notices) {
        Json::Value n;
        n["id"] = Json::UInt64(notice.id);
        n["time"] = notice.time;
        n["text"] = notice.text;
        value["notices"].append(n);
    }
    auto& costs = value["rules"];
    for (int item : BedIncome) {
        costs["bedIncome"].append(item);
    }
    for (int item : BedCost) {
        costs["bedCost"].append(item);
    }
    for (int item : DoorCost) {
        costs["doorCost"].append(item);
    }
    for (int item : TowerCost) {
        costs["towerCost"].append(item);
    }
    for (int item : PantryCost) {
        costs["pantryCost"].append(item);
    }
    for (int item : RepairCost) {
        costs["repairCost"].append(item);
    }
    costs["repairDoorCost"] = 45;
    costs["enemyTimeExperience"] = EnemyTimeExperience;
    costs["enemyDoorExperience"] = EnemyDoorExperience;
    return value;
}
} // namespace snackshop
