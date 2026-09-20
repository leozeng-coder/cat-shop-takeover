#ifndef SNACKSHOP_WEIGHTED_RANDOM_H
#define SNACKSHOP_WEIGHTED_RANDOM_H
#include <cstdint>
#include <random>
#include <stdexcept>
#include <vector>
namespace snackshop {
inline std::size_t weightedDraw(const std::vector<int>& weights, std::mt19937& random) {
    std::int64_t total = 0;
    for (const auto weight : weights) {
        total += weight;
    }
    if (total <= 0) {
        throw std::logic_error("empty random reward distribution");
    }
    auto ticket = std::uniform_int_distribution<std::int64_t>(1, total)(random);
    for (std::size_t i = 0; i < weights.size(); ++i) {
        ticket -= weights[i];
        if (ticket <= 0) {
            return i;
        }
    }
    throw std::logic_error("empty random reward distribution");
}
} // namespace snackshop
#endif
