#include "game/game.h"
#include "test_config.h"
#include <algorithm>
#include <chrono>
#include <iostream>
#include <vector>
using namespace snackshop;
using Clock = std::chrono::steady_clock;
int main() {
    double largest = 0, total = 0;
    for (unsigned seed = 0; seed < 5; ++seed) {
        Game g("PERF", 1, seed, testConfig());
        g.addHuman("Test");
        g.start(0);
        g.setConnected(0, false);
        for (int frame = 0; frame < 600; ++frame) {
            g.step(.05);
        }
        g.phase = "preparing";
        g.elapsed = 20;
        for (auto& room : g.dorms) {
            room.level = 3;
            room.hp = 950;
            room.props.clear();
        }
        for (auto& p : g.players) {
            p.bed = 3;
            p.wallet["cans"] = 0;
            p.decisionAt = 0;
        }
        auto start = Clock::now();
        g.step(.05);
        const double ms = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
        largest = std::max(largest, ms);
        total += ms;
    }
    std::cout << "Six low-budget AI: max tick " << largest << " ms; mean " << total / 5 << " ms\n";
    double burstMax = 0;
    for (unsigned seed = 0; seed < 40; ++seed) {
        Game burst("BURST", 1, seed, testConfig());
        burst.addHuman("Test");
        burst.start(0);
        burst.phase = "running";
        burst.elapsed = 40;
        burst.monster.position = GridMap::center(burst.map.spawn + 2);
        burst.monster.state = "chasing";
        burst.monster.prey = 0;
        for (auto& p : burst.players) {
            p.human = false;
            p.decisionAt = 0;
        }
        const auto start = Clock::now();
        burst.step(.05);
        burstMax = std::max(burstMax, std::chrono::duration<double, std::milli>(Clock::now() - start).count());
    }
    std::cout << "Six simultaneous escape decisions plus manager targeting: max tick " << burstMax << " ms\n";
    Game g("PATH", 1, 42, testConfig());
    g.addHuman("Test");
    g.start(0);
    std::vector<double> commands;
    commands.reserve(500);
    for (int i = 0; i < 500; ++i) {
        auto start = Clock::now();
        g.command(0, GameAction::Move, -1, i % 2 ? MapWidth + 1 : MapWidth + MapWidth - 2);
        commands.push_back(std::chrono::duration<double, std::milli>(Clock::now() - start).count());
    }
    std::sort(commands.begin(), commands.end());
    std::cout << "Movement path p95 " << commands[475] << " ms; max " << commands.back() << " ms\n";
    if (largest >= 50 || burstMax >= 50 || commands[475] >= 10) {
        std::cerr << "Simulation exceeded the real-time update budget" << std::endl;
        return 1;
    }
    return 0;
}
