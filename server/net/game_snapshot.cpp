#include "game_snapshot.h"
#include "battle/logic_progression.h"
#include <algorithm>
namespace snackshop {
namespace {
Json::Value price(const Cost& cost) {
    Json::Value rows(Json::arrayValue);
    for (const auto& c : cost) {
        Json::Value row;
        row["currency"] = c.currency;
        row["amount"] = c.amount;
        rows.append(row);
    }
    return rows;
}
Json::Value requirements(const GameConfig& cfg, const Requirements& r) {
    Json::Value rows(Json::arrayValue);
    if (r.doorStage) {
        rows.append("店门达到" + cfg.door(r.doorStage).displayName());
    }
    if (r.nestLevel) {
        rows.append("罐头窝达到 " + std::to_string(r.nestLevel) + "级");
    }
    return rows;
}
Json::Value level(const GameConfig& cfg, const LevelConfig& l) {
    Json::Value row;
    row["level"] = l.level;
    row["nextLevel"] = l.nextLevel;
    row["cost"] = price(l.cost);
    row["requirements"] = requirements(cfg, l.requirements);
    row["amount"] = l.amount;
    row["intervalMs"] = l.intervalMs;
    row["range"] = l.range;
    return row;
}
Json::Value offer(const std::string& error) {
    Json::Value row;
    row["enabled"] = error.empty();
    row["reason"] = error;
    return row;
}
} // namespace
Json::Value GameSnapshot::catalog(const GameConfig& cfg) {
    Json::Value value;
    value["type"] = "config";
    value["version"] = cfg.version;
    value["catSpeed"] = cfg.catSpeed;
    value["currencies"] = Json::Value(Json::arrayValue);
    for (const auto& c : cfg.currencies) {
        Json::Value row;
        row["id"] = c.id;
        row["name"] = c.name;
        row["symbol"] = c.symbol;
        value["currencies"].append(row);
    }
    value["doors"] = Json::Value(Json::arrayValue);
    for (const auto& d : cfg.doors) {
        Json::Value row;
        row["id"] = d.id;
        row["stage"] = d.stage;
        row["name"] = d.displayName();
        row["appearance"] = d.appearance;
        row["maxHp"] = d.health;
        row["nextStage"] = d.nextStage;
        row["cost"] = price(d.cost);
        row["requirements"] = requirements(cfg, d.requirements);
        value["doors"].append(row);
    }
    value["nests"] = Json::Value(Json::arrayValue);
    for (const auto& n : cfg.nests) {
        auto row = level(cfg, n);
        row["currency"] = n.currency;
        value["nests"].append(row);
    }
    value["items"] = Json::Value(Json::objectValue);
    for (const auto& [id, item] : cfg.items) {
        Json::Value row;
        row["id"] = id;
        row["name"] = item.name;
        row["category"] = item.category;
        row["behavior"] = behaviorName(item.behavior);
        row["appearance"] = item.appearance;
        row["currency"] = item.currency;
        row["buildable"] = item.buildable;
        row["levels"] = Json::Value(Json::arrayValue);
        for (const auto& l : item.levels) {
            row["levels"].append(level(cfg, l));
        }
        value["items"][id] = row;
    }
    value["repair"]["cost"] = price(cfg.repair.cost);
    value["repair"]["amount"] = cfg.repair.amount;
    value["repair"]["cooldown"] = cfg.repair.cooldown;
    value["manager"]["timeRage"] = cfg.enemy.timeRage;
    value["manager"]["doorRage"] = cfg.enemy.doorRage;
    value["manager"]["damageRageMultiplier"] = cfg.enemy.damageRageMultiplier;
    value["manager"]["levelUpHealPercent"] = cfg.enemy.levelUpHealRatio * 100;
    return value;
}
Json::Value GameSnapshot::encode(const Game& g, int viewer) {
    Json::Value value;
    const auto& cfg = g.config();
    value["type"] = "state";
    value["configVersion"] = cfg.version;
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
        for (const auto& [currency, amount] : p.wallet) {
            j["wallet"][currency] = amount;
        }
        for (const auto& c : cfg.currencies) {
            j["incomes"][c.id] = g.income(p, c.id);
        }
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
        const auto& door = cfg.door(d.level);
        j["id"] = d.id;
        j["owner"] = d.owner;
        j["level"] = d.level;
        j["hp"] = d.hp;
        j["maxHp"] = door.health;
        j["doorName"] = door.displayName();
        j["doorAppearance"] = door.appearance;
        j["door"] = d.door;
        j["closed"] = d.doorClosed();
        j["nest"] = d.nest;
        j["entrance"] = d.entrance;
        j["area"] = static_cast<int>(d.floor.size());
        j["repairOffer"] = offer(g.repairError(viewer, d.id));
        j["props"] = Json::Value(Json::arrayValue);
        for (const auto& p : d.props) {
            Json::Value prop;
            prop["cell"] = p.cell;
            prop["kind"] = p.kind;
            prop["level"] = p.level;
            prop["appearance"] = cfg.item(p.kind).appearance;
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
    m["rage"] = g.monster.rage;
    m["nextRage"] = LogicProgression::stats(g.monster, cfg.enemy).nextRage;
    m["maxLevel"] = static_cast<int>(cfg.enemy.levels.size());
    m["levelUps"] = Json::Value(Json::arrayValue);
    for (const auto& event : g.monster.levelUps) {
        Json::Value entry;
        entry["level"] = event.level;
        entry["healed"] = event.healed;
        entry["text"] = cfg.enemy.levels[event.level - 1].levelUpAnnouncement;
        m["levelUps"].append(entry);
    }
    m["doorHits"] = g.monster.doorHits;
    m["attackingPlayer"] = g.phase == "running" ? g.monster.attackingPlayer : -1;
    m["attackStartedAt"] = g.monster.attackStartedAt;
    m["attackSequence"] = Json::UInt64(g.monster.attackSequence);
    m["doorDamage"] = LogicProgression::stats(g.monster, cfg.enemy).doorDamage;
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
    auto& offers = value["offers"];
    offers["nest"] = offer(g.nestUpgradeError(viewer));
    offers["door"] = offer(g.doorUpgradeError(viewer));
    offers["items"] = Json::Value(Json::objectValue);
    for (const auto& [id, item] : cfg.items) {
        if (!item.buildable) {
            continue;
        }
        offers["items"][id] = Json::Value(Json::arrayValue);
        for (const auto& l : item.levels) {
            offers["items"][id].append(offer(g.purchaseError(viewer, l.cost, l.requirements)));
        }
    }
    return value;
}
} // namespace snackshop
