#include "ai/logic_cat_ai.h"
#include "battle/logic_enemy.h"
#include "common/game_math.h"
#include "game/game.h"
#include "game/logic_economy.h"
#include "item/logic_item.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>
namespace snackshop {
Game::Game(std::string value, int size, std::uint32_t seed, std::shared_ptr<const GameConfig> rules, std::string mapId)
    : code(std::move(value)), selectedMap(std::move(mapId)), capacity(size), balance(rules->balance),
      m_config(std::move(rules)), m_random(seed) {
    map.generate(seed, dorms, config(), selectedMap);
    monster.hp = monster.maxHp = config().enemy.levels.front().maxHp;
    monster.position = map.center(map.shopkeeperSpawn);
    for (int i = 0; i < Seats; ++i) {
        LogicEconomy::initialize(players[i], config());
        players[i].id = i;
        players[i].character = config().defaultCharacter(i);
        players[i].name = "猫队员 " + std::to_string(i + 1);
        players[i].personality = i % static_cast<int>(config().catAi.profiles.size());
        players[i].position = map.center(map.spawn + (i % 3) - 1 + (i / 3) * map.width);
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
    if (connected) {
        LogicCatAi::stop(*this, players[id]);
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
std::string Game::selectMap(int id, const std::string& mapId) {
    if (id != host || !validPlayer(id)) {
        return "只有房主可以选择地图";
    }
    if (phase != "lobby") {
        return "开局后不能更换地图";
    }
    if (!mapId.empty() && !config().mapProfile(mapId)) {
        return "地图不存在或暂未开放";
    }
    if (selectedMap == mapId) {
        return {};
    }
    selectedMap = mapId;
    resetBoard();
    notify("房主选择了" + map.name + "，请重新准备");
    return {};
}
std::string Game::selectCharacter(int id, const CharacterSelection& selection) {
    if (!validPlayer(id) || phase != "lobby") {
        return "只能在出发前选择自己的猫猫";
    }
    if (!config().hasCharacter(selection)) {
        return "角色或毛色暂未开放";
    }
    auto& player = players[id];
    if (player.character.character == selection.character && player.character.skin == selection.skin) {
        return {};
    }
    player.character = selection;
    player.ready = id == host;
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
    notify("夜深了，店长不在！" + std::to_string(static_cast<int>(balance.preparation)) +
           " 秒内找到猫店，点击罐头窝安家");
    return {};
}
std::string Game::rematch(int id, std::shared_ptr<const GameConfig> nextConfig) {
    if (id != host || !validPlayer(id)) {
        return "只有房主可以再开一局";
    }
    if (phase != "won" && phase != "lost") {
        return "请等待本局结束";
    }
    if (nextConfig) {
        m_config = std::move(nextConfig);
        balance = config().balance;
        if (!selectedMap.empty() && !config().mapProfile(selectedMap)) {
            selectedMap.clear();
        }
    }
    resetBoard();
    return {};
}
void Game::resetBoard() {
    elapsed = 0;
    tick = 0;
    notices.clear();
    phase = "lobby";
    map.generate(m_random(), dorms, config(), selectedMap);
    monster = Monster{};
    monster.hp = monster.maxHp = config().enemy.levels.front().maxHp;
    monster.position = map.center(map.shopkeeperSpawn);
    for (int i = 0; i < Seats; ++i) {
        const auto old = players[i];
        auto& p = players[i];
        p = Player{};
        LogicEconomy::initialize(p, config());
        p.id = i;
        p.name = old.name;
        p.character = config().hasCharacter(old.character) ? old.character : config().defaultCharacter(i);
        p.human = old.human;
        p.connected = old.connected;
        p.ready = !p.human || i == host;
        p.personality = i % static_cast<int>(config().catAi.profiles.size());
        p.position = map.center(map.spawn + i % 3 - 1 + (i / 3) * map.width);
    }
    notify("新街区已经准备好，猫店形状和物资都变了");
}
bool Game::isEscaping(const Player& player) const {
    return player.alive && player.room >= 0 && dorms[player.room].hp <= 0;
}
double Game::income(const Player& player, const std::string& currency) const {
    if (!player.alive || player.room < 0 || dorms[player.room].owner != player.id) {
        return 0;
    }
    const auto& nest = config().nest(player.bed);
    double total = nest.currency == currency ? nest.amount * 1000.0 / nest.intervalMs : 0;
    for (const auto& prop : dorms[player.room].props) {
        const auto& item = config().item(prop.kind);
        if (item.behavior == ItemBehavior::CurrencyProducer && item.currency == currency) {
            const auto& level = item.levels[prop.level - 1];
            total += level.amount * 1000.0 / level.intervalMs;
        }
    }
    return total;
}
std::string Game::command(int id, GameAction action, int targetRoom, int cell, const std::string& kind) {
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
    if (isEscaping(p) && action != GameAction::Move) {
        return "店门已被打破，现在只能移动逃跑";
    }
    if (action == GameAction::Move || action == GameAction::EnterNest) {
        int intent = -1;
        if (action == GameAction::EnterNest) {
            if (!validRoom(targetRoom)) {
                return "无效猫店";
            }
            if (dorms[targetRoom].owner >= 0 && dorms[targetRoom].owner != id) {
                return "这是其他猫的罐头窝";
            }
            if (p.room >= 0 && p.room != targetRoom) {
                return "你已经有自己的猫店了";
            }
            if (p.room < 0) {
                // A movement intent never reserves an unclaimed nest or blocks another cat.
                if (phase == "running" && map.roomAt(map.cellAt(monster.position)) == targetRoom) {
                    return "店长已经进店，请先寻找安全的猫店";
                }
            }
            cell = dorms[targetRoom].nest;
            intent = targetRoom;
        }
        if (!map.valid(cell)) {
            return "请选择地图内的格子";
        }
        auto route = pathTo(p.position, cell, id);
        if (route.empty()) {
            return "这里走不到：墙体、关闭的店门和固定货架不能穿过，安家后请在屋内活动";
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
        const auto error = nestUpgradeError(id);
        if (!error.empty()) {
            return error;
        }
        const auto& next = config().nest(config().nest(p.bed).nextLevel);
        LogicEconomy::pay(p, next.cost);
        p.bed = next.level;
        p.productionRemainder = 0;
    } else if (action == GameAction::UpgradeBarricade) {
        const auto error = doorUpgradeError(id);
        if (!error.empty()) {
            return error;
        }
        const auto& previous = config().door(room.level);
        const auto& next = config().door(previous.nextStage);
        LogicEconomy::pay(p, next.cost);
        room.level = next.stage;
        room.hp += next.health - previous.health;
    } else if (action == GameAction::Build) {
        if (!map.valid(cell) || map.roomAt(cell) != p.room || map.wall(cell) || cell == room.door ||
            cell == room.nest) {
            return "只能在自家猫店的空地格安装";
        }
        if (!config().items.contains(kind) || !config().item(kind).buildable) {
            return "无效道具";
        }
        auto existing =
            std::find_if(room.props.begin(), room.props.end(), [&](const Prop& prop) { return prop.cell == cell; });
        const int level = existing == room.props.end() ? 0 : existing->level;
        if (existing != room.props.end() && existing->kind != kind) {
            return "这个格子已有其他道具";
        }
        const auto& item = config().item(kind);
        const int next = level == 0 ? 1 : item.levels[level - 1].nextLevel;
        if (!next) {
            return "道具已经满级";
        }
        const auto& target = item.levels[next - 1];
        const auto error = itemPurchaseError(id, item, next);
        if (!error.empty()) {
            return error;
        }
        LogicEconomy::pay(p, target.cost);
        if (level == 0) {
            room.props.push_back({cell, kind});
        } else {
            existing->level = next;
            existing->cooldown = 0;
        }
    } else if (action == GameAction::Repair) {
        const auto error = repairError(id, targetRoom);
        if (!error.empty()) {
            return error;
        }
        auto& target = dorms[targetRoom];
        LogicEconomy::pay(p, config().repair.cost);
        target.hp =
            std::min(target.hp + config().repair.amount, static_cast<double>(config().door(target.level).health));
        p.repairAt = elapsed + config().repair.cooldown;
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
        for (auto& p : players) {
            LogicCatAi::stop(*this, p);
        }
        LogicEnemy::stop(*this);
        return;
    }
    elapsed += dt;
    for (auto& p : players) {
        if (p.alive && (!p.human || (!p.connected && p.disconnectedFor >= balance.reconnectGrace))) {
            LogicCatAi::update(*this, p);
        }
    }
    // Move everyone against the same board, then resolve arrivals by distance
    // traveled within this tick, not by seat order or human/AI role.
    std::array<std::pair<double, int>, Seats> arrivals;
    const double budget = config().catSpeed * dt;
    for (auto& p : players) {
        auto& arrival = arrivals[p.id];
        arrival = {std::numeric_limits<double>::infinity(), p.id};
        if (!p.alive) {
            continue;
        }
        if (p.nestIntent >= 0) {
            double distance = 0;
            Point previous = p.position;
            for (const auto& next : p.path) {
                distance += GameMath::distance(previous, next);
                previous = next;
                if (distance > budget) {
                    break;
                }
            }
            arrival.first = distance;
        }
        if (!p.path.empty()) {
            moveAlong(p.position, p.path, budget, p.id);
        }
    }
    const int firstSeat = static_cast<int>(tick % Seats);
    std::sort(arrivals.begin(), arrivals.end(), [&](const auto& a, const auto& b) {
        if (a.first != b.first) {
            return a.first < b.first;
        }
        // Exactly simultaneous arrivals use a deterministic rotating tie-break.
        return (a.second + Seats - firstSeat) % Seats < (b.second + Seats - firstSeat) % Seats;
    });
    for (const auto& arrival : arrivals) {
        auto& p = players[arrival.second];
        if (p.alive) {
            arrive(p);
        }
    }
    LogicItem::updatePassive(*this, dt);
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
