#ifndef SNACKSHOP_LOGIC_ECONOMY_H
#define SNACKSHOP_LOGIC_ECONOMY_H
#include "game_types.h"
namespace snackshop {
class LogicEconomy {
public:
    static void initialize(Player& player, const GameConfig& config);
    static int balance(const Player& player, const std::string& currency);
    static bool canPay(const Player& player, const Cost& cost);
    static bool pay(Player& player, const Cost& cost);
    static void credit(Player& player, const GameConfig& config, const std::string& currency, int amount);
    static void reward(Player& player, const GameConfig& config, const Cost& amounts);
};
} // namespace snackshop
#endif
