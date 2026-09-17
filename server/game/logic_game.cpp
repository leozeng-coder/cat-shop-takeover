#include "ai/logic_cat_ai.h"
#include "battle/logic_enemy.h"
#include "game/game.h"
#include <algorithm>
#include <cmath>
#include <utility>
namespace snackshop {
Game::Game(std::string value, int size, std::uint32_t seed, Balance rules)
    : code(std::move(value)), capacity(size), balance(rules), m_random(seed) {
    map.generate(seed, dorms);
    monster.position = GridMap::center(map.shopkeeperSpawn);
    for (int i = 0; i < Seats; ++i) {
        players[i].id = i;
        players[i].name = "猫队员 " + std::to_string(i + 1);
        players[i].personality = i % 3;
        players[i].position = GridMap::center(map.spawn + (i % 3) - 1 + (i / 3) * MapWidth);
    }
}
int Game::humanCount() const {
    return static_cast<int>(std::count_if(players.begin(), players.end(), [](const Player& p) { return p.human; }));
}
int Game::minimumHumans() const {
    return capacity == 1 ? 1 : 2;
}
bool Game::validPlayer(int id) const {
    return id >= 0 && id < Seats && players[id].human;
}
int Game::addHuman(const std::string& name) {
    if (phase != "lobby" || humanCount() >= capacity) {
        return -1;
    }
    for (auto& p : players) {
        if (p.human) {
            continue;
        }
        p.human = true;
        p.connected = true;
        p.name = name;
        p.ready = host < 0;
        p.disconnectedFor = 0;
        if (host < 0) {
            host = p.id;
        }
        notify(name + " 加入了夺店小队");
        return p.id;
    }
    return -1;
}
void Game::removeHuman(int id) {
    if (!validPlayer(id)) {
        return;
    }
    auto& p = players[id];
    p.connected = false;
    p.human = false;
    p.ready = true;
    p.disconnectedFor = balance.reconnectGrace;
    notify(p.name + " 已离开，AI 接管席位");
    p.name = "猫队员 " + std::to_string(id + 1);
    if (host == id) {
        host = -1;
        for (auto& candidate : players) {
            if (candidate.human) {
                host = candidate.id;
                candidate.ready = true;
                break;
            }
        }
    }
}
void Game::setConnected(int id, bool connected) {
    if (!validPlayer(id)) {
        return;
    }
    players[id].connected = connected;
    players[id].disconnectedFor = 0;
    notify(players[id].name + (connected ? " 已重新连接" : " 暂时离线"));
}
std::string Game::setReady(int id, bool ready) {
    if (!validPlayer(id) || phase != "lobby") {
        return "当前不能更改准备状态";
    }
    players[id].ready = ready;
    return {};
}
std::string Game::start(int id) {
    if (id != host || !validPlayer(id)) {
        return "只有房主可以开始";
    }
    if (phase != "lobby") {
        return "对局已经开始";
    }
    if (humanCount() < minimumHumans()) {
        return "等待好友加入；其余位置自动补齐 AI";
    }
    for (const auto& p : players) {
        if (p.human && (!p.ready || !p.connected)) {
            return "请等待所有好友准备";
        }
    }
    phase = "preparing";
    elapsed = 0;
    notify("夜深了，店长不在！30 秒内找到猫店，点击罐头窝安家");
    return {};
}
std::string Game::rematch(int id) {
    if (id != host || !validPlayer(id)) {
        return "只有房主可以再开一局";
    }
    if (phase != "won" && phase != "lost") {
        return "请等待本局结束";
    }
    resetBoard();
    return {};
}
void Game::resetBoard() {
    elapsed = 0;
    tick = 0;
    m_incomeAccumulator = 0;
    notices.clear();
    phase = "lobby";
    map.generate(m_random(), dorms);
    monster = Monster{};
    monster.position = GridMap::center(map.shopkeeperSpawn);
    for (int i = 0; i < Seats; ++i) {
        const auto old = players[i];
        auto& p = players[i];
        p = Player{};
        p.id = i;
        p.name = old.name;
        p.human = old.human;
        p.connected = old.connected;
        p.ready = !p.human || i == host;
        p.personality = i % 3;
        p.position = GridMap::center(map.spawn + i % 3 - 1 + (i / 3) * MapWidth);
    }
    notify("新街区已经准备好，猫店形状和物资都变了");
}
int Game::income(const Player& player) const {
    if (!player.alive || player.room < 0 || dorms[player.room].owner != player.id) {
        return 0;
    }
    int total = BedIncome[player.bed - 1];
    for (const auto& prop : dorms[player.room].props) {
        if (prop.kind == PropKind::Pantry) {
            total += PantryIncome[prop.level - 1];
        }
    }
    return total;
}
std::string Game::command(int id, GameAction action, int targetRoom, int cell, PropKind kind) {
    if (id < 0 || id >= Seats) {
        return "无效玩家";
    }
    if (phase != "preparing" && phase != "running") {
        return "当前不在游戏中";
    }
    auto& p = players[id];
    if (!p.alive) {
        return "你被店长抱走了，可以继续观战";
    }
    if (action == GameAction::Move || action == GameAction::EnterNest) {
        int intent = -1;
        if (action == GameAction::EnterNest) {
            if (targetRoom < 0 || targetRoom >= Seats) {
                return "无效猫店";
            }
            if (dorms[targetRoom].owner >= 0 && dorms[targetRoom].owner != id) {
                return "这是其他猫的罐头窝";
            }
            if (p.room >= 0 && p.room != targetRoom) {
                return "你已经有自己的猫店了";
            }
            if (p.room < 0) {
                // Reserve the approach through nestIntent, then claim only on arrival.
                // Do not close the door with another cat or the shopkeeper inside an unclaimed shop.
                for (const auto& cat : players) {
                    if (cat.id != id && cat.alive &&
                        (cat.nestIntent == targetRoom || map.roomAt(GridMap::cellAt(cat.position)) == targetRoom)) {
                        return "有猫正在这家店里或前往猫窝，请选择另一家猫店";
                    }
                }
                if (phase == "running" && map.roomAt(GridMap::cellAt(monster.position)) == targetRoom) {
                    return "店长已经进店，请先寻找安全的猫店";
                }
            }
            cell = dorms[targetRoom].nest;
            intent = targetRoom;
        }
        if (!GridMap::valid(cell)) {
            return "请选择地图内的格子";
        }
        auto route = pathTo(p.position, cell, id);
        if (route.empty()) {
            return "这里走不到：墙体、关闭的店门和道具不能穿过，安家后请在屋内活动";
        }
        p.path = std::move(route);
        p.sleeping = false;
        p.nestIntent = intent;
        return {};
    }
    if (p.room < 0) {
        return "先走到罐头窝安家，再安装道具";
    }
    auto& room = dorms[p.room];
    if (action == GameAction::UpgradeNest) {
        if (p.bed >= 3) {
            return "罐头窝已经满级";
        }
        const int cost = BedCost[p.bed - 1];
        if (p.gold < cost) {
            return "罐头不足";
        }
        p.gold -= cost;
        ++p.bed;
    } else if (action == GameAction::UpgradeBarricade) {
        if (room.hp <= 0) {
            return "店门已被拆毁，快躲开店长";
        }
        if (room.level >= 3) {
            return "店门已经满级";
        }
        const int cost = DoorCost[room.level - 1];
        if (p.gold < cost) {
            return "罐头不足";
        }
        p.gold -= cost;
        const int oldMax = DoorHealth[room.level - 1];
        ++room.level;
        room.hp += DoorHealth[room.level - 1] - oldMax;
    } else if (action == GameAction::Build) {
        if (!GridMap::valid(cell) || map.roomAt(cell) != p.room || map.wall(cell) || cell == room.door ||
            cell == room.nest) {
            return "只能在自家猫店的空地格安装";
        }
        if (kind != PropKind::Launcher && kind != PropKind::Pantry && kind != PropKind::Repair) {
            return "无效道具";
        }
        auto existing =
            std::find_if(room.props.begin(), room.props.end(), [&](const Prop& prop) { return prop.cell == cell; });
        const int level = existing == room.props.end() ? 0 : existing->level;
        if (existing != room.props.end() && existing->kind != kind) {
            return "这个格子已有其他道具";
        }
        if (level >= 3) {
            return "道具已经满级";
        }
        const int cost = kind == PropKind::Launcher ? TowerCost[level]
                         : kind == PropKind::Pantry ? PantryCost[level]
                                                    : RepairCost[level];
        if (p.gold < cost) {
            return "罐头不足";
        }
        if (level == 0) {
            for (const auto& cat : players) {
                if (cat.alive && GridMap::cellAt(cat.position) == cell) {
                    return "猫猫正在这个格子上";
                }
            }
            if (!buildKeepsAccess(room, cell)) {
                return "安装后会堵住通道，请留出通往店门和罐头窝的路";
            }
        }
        p.gold -= cost;
        if (level == 0) {
            room.props.push_back({cell, kind});
        } else {
            ++existing->level;
        }
    } else if (action == GameAction::Repair) {
        if (targetRoom < 0 || targetRoom >= Seats) {
            return "请选择店门";
        }
        auto& target = dorms[targetRoom];
        if (target.owner < 0 || !players[target.owner].alive || target.hp <= 0) {
            return "这个店门无法修补";
        }
        if (target.hp >= DoorHealth[target.level - 1]) {
            return "店门状态完好";
        }
        if (elapsed < p.repairAt) {
            return "修补冷却中";
        }
        if (p.gold < 45) {
            return "罐头不足";
        }
        p.gold -= 45;
        target.hp = std::min(target.hp + 140, static_cast<double>(DoorHealth[target.level - 1]));
        p.repairAt = elapsed + 5;
    } else {
        return "未知操作";
    }
    return {};
}
void Game::notify(const std::string& text) {
    notices.push_front({++m_noticeId, elapsed, text});
    while (notices.size() > 12) {
        notices.pop_back();
    }
}
void Game::step(double dt) {
    if (!std::isfinite(dt) || dt <= 0 || dt > .25) {
        return;
    }
    ++tick;
    for (auto& p : players) {
        if (p.human && !p.connected) {
            p.disconnectedFor += dt;
            if (p.disconnectedFor >= 30 && p.id == host) {
                for (auto& candidate : players) {
                    if (candidate.human && candidate.connected) {
                        host = candidate.id;
                        candidate.ready = true;
                        break;
                    }
                }
            }
        }
    }
    if (phase == "lobby") {
        lobbyAge += dt;
        return;
    }
    if (phase == "won" || phase == "lost") {
        return;
    }
    elapsed += dt;
    for (auto& p : players) {
        if (!p.alive) {
            continue;
        }
        if ((!p.human || (!p.connected && p.disconnectedFor >= balance.reconnectGrace)) && elapsed > 1.5 + p.id * .25) {
            LogicCatAi::update(*this, p);
        }
        if (!p.path.empty()) {
            moveAlong(p.position, p.path, CatSpeed * dt, p.id);
        }
        arrive(p);
    }
    m_incomeAccumulator += dt;
    while (m_incomeAccumulator >= 1) {
        m_incomeAccumulator -= 1;
        for (auto& p : players) {
            p.gold = std::min(999999, p.gold + income(p));
        }
        for (auto& room : dorms) {
            if (room.owner < 0 || !players[room.owner].alive || room.hp <= 0) {
                continue;
            }
            for (const auto& prop : room.props) {
                if (prop.kind == PropKind::Repair) {
                    room.hp = std::min(static_cast<double>(DoorHealth[room.level - 1]), room.hp + 2 * prop.level);
                }
            }
        }
    }
    if (phase == "preparing" && elapsed >= balance.preparation) {
        phase = "running";
        monster.state = "hunting";
        notify("天亮了！店长回来了，会拆门进店抓猫。街上的猫快找地方躲起来");
    }
    if (phase == "running") {
        LogicEnemy::update(*this, dt);
        const bool alive = std::any_of(players.begin(), players.end(), [](const Player& p) { return p.alive; });
        if (!alive) {
            phase = "lost";
            notify("所有小猫都被店长抱走了");
        } else if (elapsed >= balance.preparation + balance.duration) {
            phase = "won";
            notify("店长放弃啦，这条街的罐头归猫猫们了！");
        }
    }
}
} // namespace snackshop
