#include "ai/logic_cat_ai.h"
#include "config/config_loader.h"
#include "game/game.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
using namespace snackshop;
namespace {
bool invest(Game& game, int id) {
    auto& p = game.players[id];
    const auto& room = game.dorms[p.room];
    for (const auto& prop : room.props) {
        if (prop.kind == "pantry" && game.command(id, GameAction::Build, -1, prop.cell, prop.kind).empty()) {
            return true;
        }
    }
    for (int cell : room.floor) {
        if (!game.propAt(cell) && game.command(id, GameAction::Build, -1, cell, "pantry").empty()) {
            return true;
        }
    }
    return false;
}
// Offline player proxy: one ordinary command per second, no extra income or immunity.
bool buyItem(Game& g, Player& p, const std::string& kind, int count, int level) {
    const auto& item = g.config().item(kind);
    auto& room = g.dorms[p.room];
    int owned = 0;
    for (const auto& prop : room.props) {
        if (prop.kind != kind) {
            continue;
        }
        ++owned;
        const int next = item.levels[prop.level - 1].nextLevel;
        if (next && prop.level < level && g.command(p.id, GameAction::Build, -1, prop.cell, kind).empty()) {
            return true;
        }
    }
    if (owned >= count || !g.itemPurchaseError(p.id, item, 1).empty()) {
        return false;
    }
    auto cells = room.floor;
    const auto distance = [&](int cell) {
        return std::abs(cell % g.map.width - room.door % g.map.width) +
               std::abs(cell / g.map.width - room.door / g.map.width);
    };
    std::sort(cells.begin(), cells.end(),
              [&](int a, int b) { return distance(a) == distance(b) ? a < b : distance(a) < distance(b); });
    for (int cell : cells) {
        if (!g.propAt(cell) && g.command(p.id, GameAction::Build, -1, cell, kind).empty()) {
            return true;
        }
    }
    return false;
}
void defend(Game& g, Player& p) {
    if (!p.alive) {
        return;
    }
    if (p.room < 0) {
        if (!p.path.empty()) {
            return;
        }
        std::vector<std::pair<std::size_t, int>> rooms;
        for (const auto& room : g.dorms) {
            if (room.owner >= 0) {
                continue;
            }
            const auto route = g.pathTo(p.position, room.nest, p.id);
            if (!route.empty()) {
                rooms.emplace_back(route.size(), room.id);
            }
        }
        std::sort(rooms.begin(), rooms.end());
        for (const auto& candidate : rooms) {
            if (g.command(p.id, GameAction::EnterNest, candidate.second).empty()) {
                return;
            }
        }
        return;
    }
    const auto& room = g.dorms[p.room];
    if (room.hp <= 0) {
        // Reuse normal escape planning after a breach; movement remains collision checked.
        p.human = false;
        LogicCatAi::update(g, p);
        p.human = true;
        return;
    }
    if (g.monster.target == room.id && g.command(p.id, GameAction::UpgradeBarricade).empty()) {
        return;
    }
    if (room.hp < g.config().door(room.level).health * .7 && g.command(p.id, GameAction::Repair, room.id).empty()) {
        return;
    }
    if (buyItem(g, p, "launcher", 1, 1)) {
        return;
    }
    const auto grow = [&] {
        const int next = g.config().nest(p.bed).nextLevel;
        if (!next) {
            return g.command(p.id, GameAction::UpgradeBarricade).empty();
        }
        if (room.level < g.config().nest(next).requirements.doorStage) {
            return g.command(p.id, GameAction::UpgradeBarricade).empty();
        }
        return g.command(p.id, GameAction::UpgradeNest).empty();
    };
    if (p.bed < 2 && grow()) {
        return;
    }
    // Early low-level weapons offer better damage per can than immediately upgrading one.
    if (p.bed >= 2 && buyItem(g, p, "launcher", 4, 1)) {
        return;
    }
    if (buyItem(g, p, "mini_fridge", 1, std::min(p.bed, 5))) {
        return;
    }
    if (buyItem(g, p, "repair", 1, std::min(3, std::max(1, p.bed / 2)))) {
        return;
    }
    if (buyItem(g, p, "fish_rack", 1, 1)) {
        return;
    }
    if (buyItem(g, p, "launcher", std::min(4, p.bed + 1), p.bed)) {
        return;
    }
    if (buyItem(g, p, "pantry", 1, 1)) {
        return;
    }
    if (grow()) {
        return;
    }
    // Friends can spend their own cans on a threatened door through the normal repair command.
    for (const auto& other : g.dorms) {
        if (other.owner >= 0 && g.players[other.owner].human && other.hp < g.config().door(other.level).health * .35 &&
            g.command(p.id, GameAction::Repair, other.id).empty()) {
            return;
        }
    }
}
void simulate(std::shared_ptr<const GameConfig> config, unsigned seed, const std::string& scenario, double total) {
    const int defenders = scenario == "solo_defense"    ? 1
                          : scenario == "duo_defense"   ? 2
                          : scenario == "trio_defense"  ? 3
                          : scenario == "party_defense" ? 6
                                                        : 0;
    Game g("BALANCE", std::max(1, defenders), seed, config);
    for (int id = 0; id < std::max(1, defenders); ++id) {
        g.addHuman("Probe");
        g.setReady(id, true);
    }
    if (const auto error = g.start(0); !error.empty()) {
        throw std::runtime_error(error);
    }
    g.balance.duration = total - g.balance.preparation;
    for (auto& p : g.players) {
        p.human = p.id < defenders;
        p.connected = p.human;
    }
    std::array<bool, Seats> settled{}, breached{}, caught{};
    std::array<double, Seats> capturedAt;
    capturedAt.fill(-1);
    double firstBreach = -1, firstCapture = -1, maxEconomy = -1;
    // Sample 10%, 20%, 40%, 70% and the end of the requested round.
    std::array<double, 5> marks{total * .1, total * .2, total * .4, total * .7, total - .1};
    std::array<double, 5> meanDoors{}, meanNests{};
    std::array<int, 5> managerLevels{};
    std::size_t mark = 0;
    double nextInvestment = 0, nextDefense = 0;
    for (int frame = 0; frame <= static_cast<int>(std::ceil(total / .05)); ++frame) {
        if (g.elapsed >= nextDefense) {
            for (int id = 0; id < defenders; ++id) {
                defend(g, g.players[id]);
            }
            nextDefense = g.elapsed + 1;
        }
        for (auto& p : g.players) {
            const bool controlled =
                scenario == "idle" || scenario == "greedy_team" || (scenario == "greedy_one" && p.id == 0);
            const bool greedy = scenario != "idle";
            if (controlled && p.room >= 0 && (!greedy || g.elapsed < 180)) {
                if (!p.human) {
                    LogicCatAi::stop(g, p);
                    p.human = p.connected = true;
                }
                if (greedy && p.alive && g.elapsed >= nextInvestment) {
                    invest(g, p.id);
                }
            } else if (controlled && greedy && g.elapsed >= 180) {
                p.human = false;
            }
        }
        if (g.elapsed >= nextInvestment) {
            nextInvestment = g.elapsed + 2;
        }
        g.step(.05);
        for (const auto& p : g.players) {
            settled[p.id] = settled[p.id] || p.room >= 0;
            if (p.room >= 0 && g.dorms[p.room].hp <= 0 && !breached[p.id]) {
                breached[p.id] = true;
                if (firstBreach < 0) {
                    firstBreach = g.elapsed;
                }
            }
            if (!p.alive && !caught[p.id]) {
                caught[p.id] = true;
                capturedAt[p.id] = g.elapsed;
                if (firstCapture < 0) {
                    firstCapture = g.elapsed;
                }
            }
            if (p.room >= 0 && p.bed == static_cast<int>(config->nests.size()) &&
                g.dorms[p.room].level == static_cast<int>(config->doors.size()) && maxEconomy < 0) {
                maxEconomy = g.elapsed;
            }
        }
        if (mark < marks.size() && g.elapsed >= marks[mark]) {
            for (const auto& p : g.players) {
                meanDoors[mark] += p.room >= 0 ? static_cast<double>(g.dorms[p.room].level) / Seats : 0;
                meanNests[mark] += static_cast<double>(p.bed) / Seats;
            }
            managerLevels[mark] = g.monster.level;
            ++mark;
        }
        if (g.phase == "won" || g.phase == "lost") {
            break;
        }
    }
    const auto alive = std::count_if(g.players.begin(), g.players.end(), [](const auto& p) { return p.alive; });
    std::cout << scenario << ',' << seed << ',' << g.elapsed << ',' << g.phase << ',' << alive << ','
              << std::count(breached.begin(), breached.end(), true) << ',' << firstBreach << ',' << firstCapture << ','
              << maxEconomy << ',' << g.monster.level << ',' << g.monster.raids << ',' << g.players[0].alive << ','
              << std::count(settled.begin(), settled.end(), true);
    for (std::size_t i = 0; i < marks.size(); ++i) {
        std::cout << ',' << meanDoors[i] << ',' << meanNests[i] << ',' << managerLevels[i];
    }
    for (const double at : {180.0, 420.0}) {
        int botCaptures = 0;
        for (int id = std::max(1, defenders); id < Seats; ++id) {
            botCaptures += capturedAt[id] >= 0 && capturedAt[id] <= at;
        }
        std::cout << ',' << botCaptures << ',' << (capturedAt[0] < 0 || capturedAt[0] > at);
    }
    std::cout << ',' << defenders << ','
              << std::count_if(g.players.begin(), g.players.begin() + defenders, [](const auto& p) { return p.alive; });
    for (double at : capturedAt) {
        std::cout << ',' << at;
    }
    std::cout << '\n';
}
} // namespace
int main(int argc, char** argv) {
    try {
        const auto config = ConfigLoader::load(argc > 1 ? argv[1] : "data/config");
        const int seeds = argc > 2 ? std::stoi(argv[2]) : 24;
        const double total = argc > 3 ? std::stod(argv[3]) : config->balance.preparation + config->balance.duration;
        if (seeds < 1 || seeds > 1000 || !std::isfinite(total) || total < 1 || total <= config->balance.preparation ||
            total > 3600) {
            throw std::runtime_error("Expected 1..1000 seeds and total seconds after preparation, at most 3600");
        }
        std::cout << "scenario,seed,seconds,result,survivors,breaches,first_breach,first_capture,max_economy,manager_"
                     "level,raids,probe_alive,settled";
        for (int i = 0; i < 5; ++i) {
            std::cout << ",door_" << i << ",nest_" << i << ",manager_" << i;
        }
        std::cout << ",bot_caught_180,probe_alive_180,bot_caught_420,probe_alive_420";
        std::cout << ",scripted_players,scripted_survivors";
        for (int id = 0; id < Seats; ++id) {
            std::cout << ",caught_at_" << id;
        }
        std::cout << '\n';
        const std::string selected = argc > 4 ? argv[4] : "all";
        if (selected != "all" && selected != "all_ai" && selected != "greedy_one" && selected != "greedy_team" &&
            selected != "idle" && selected != "solo_defense" && selected != "duo_defense" &&
            selected != "trio_defense" && selected != "party_defense") {
            throw std::runtime_error("Unknown simulation scenario");
        }
        for (const std::string scenario : {"all_ai", "greedy_one", "greedy_team", "idle", "solo_defense", "duo_defense",
                                           "trio_defense", "party_defense"}) {
            if (selected != "all" && selected != scenario) {
                continue;
            }
            for (int seed = 0; seed < seeds; ++seed) {
                simulate(config, seed, scenario, total);
            }
        }
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
