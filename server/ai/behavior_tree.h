#ifndef SNACKSHOP_BEHAVIOR_TREE_H
#define SNACKSHOP_BEHAVIOR_TREE_H
#include <string_view>
#include <utility>
#include <vector>
namespace snackshop::bt {
enum class Status { Success, Failure, Running };
struct Runtime {
    int running = -1;
    int lastAction = -1;
    Status result = Status::Failure;
};
// Reactive composites restart at their first child to recheck higher-priority conditions.
// All mutable execution state belongs to the caller, never to the shared tree definition.
template <class Context> class Tree {
public:
    enum class Kind { Condition, Action, Sequence, Selector };
    struct Node {
        Kind kind;
        std::string_view name;
        bool (*condition)(Context&) = nullptr;
        Status (*action)(Context&) = nullptr;
        void (*onHalt)(Context&) = nullptr;
        std::vector<int> children;
    };
    explicit Tree(std::vector<Node> nodes, int root) : m_nodes(std::move(nodes)), m_root(root) {}
    Status tick(Context& context, Runtime& state) const {
        state.result = visit(m_root, context, state);
        if (state.result != Status::Running) {
            halt(context, state);
        }
        return state.result;
    }
    void halt(Context& context, Runtime& state) const {
        if (state.running < 0) {
            return;
        }
        const auto& node = m_nodes[state.running];
        state.running = -1;
        if (node.onHalt) {
            node.onHalt(context);
        }
    }
    std::string_view lastAction(const Runtime& state) const {
        return state.lastAction < 0 ? std::string_view{} : m_nodes[state.lastAction].name;
    }

private:
    std::vector<Node> m_nodes;
    int m_root;
    Status visit(int index, Context& context, Runtime& state) const {
        const auto& node = m_nodes[index];
        if (node.kind == Kind::Condition) {
            return node.condition(context) ? Status::Success : Status::Failure;
        }
        if (node.kind == Kind::Action) {
            if (state.running != index) {
                // Cancel the old task before the new action writes movement or target state.
                halt(context, state);
            }
            state.lastAction = index;
            const auto result = node.action(context);
            state.running = result == Status::Running ? index : -1;
            return result;
        }
        const bool sequence = node.kind == Kind::Sequence;
        for (int child : node.children) {
            const auto result = visit(child, context, state);
            if (result == Status::Running || result == (sequence ? Status::Failure : Status::Success)) {
                return result;
            }
        }
        return sequence ? Status::Success : Status::Failure;
    }
};
// Builder is used once during static definition construction, never in simulation ticks.
template <class Context> class Builder {
    using TreeType = Tree<Context>;
    std::vector<typename TreeType::Node> m_nodes;

public:
    int condition(std::string_view name, bool (*test)(Context&)) {
        m_nodes.push_back({TreeType::Kind::Condition, name, test});
        return static_cast<int>(m_nodes.size()) - 1;
    }
    int action(std::string_view name, Status (*tick)(Context&), void (*halt)(Context&) = nullptr) {
        m_nodes.push_back({TreeType::Kind::Action, name, nullptr, tick, halt});
        return static_cast<int>(m_nodes.size()) - 1;
    }
    int sequence(std::string_view name, std::vector<int> children) {
        m_nodes.push_back({TreeType::Kind::Sequence, name, nullptr, nullptr, nullptr, std::move(children)});
        return static_cast<int>(m_nodes.size()) - 1;
    }
    int selector(std::string_view name, std::vector<int> children) {
        m_nodes.push_back({TreeType::Kind::Selector, name, nullptr, nullptr, nullptr, std::move(children)});
        return static_cast<int>(m_nodes.size()) - 1;
    }
    TreeType finish(int root) && { return TreeType(std::move(m_nodes), root); }
};
} // namespace snackshop::bt
#endif
