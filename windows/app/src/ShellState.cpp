#include "ShellState.h"

#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

using Json = nlohmann::json;

bool Flag(const Json& object, const char* key) {
    const auto found = object.find(key);
    return found != object.end() && found->is_boolean() && found->get<bool>();
}

bool Ringing(const Json& state) {
    const auto call = state.find("ligacao");
    if (call == state.end() || !call->is_object()) return false;
    const auto top = call->find("top");
    if (top != call->end() && top->is_object()) {
        const auto phase = top->find("phase");
        if (phase != top->end() && phase->is_string() && phase->get<std::string>() == "ringing") return true;
    }
    if (Flag(*call, "conference")) return false;
    const auto kind = call->find("secondKind");
    return kind != call->end() && kind->is_string() && kind->get<std::string>() == "ringing";
}

}  // namespace

std::optional<ShellStatus> ReadShellStatus(const std::string& message) {
    // A maioria das mensagens nao e o estado: nem le o JSON.
    if (message.find("\"state\"") == std::string::npos) return std::nullopt;
    const Json parsed = Json::parse(message, nullptr, /*allow_exceptions=*/false);
    if (!parsed.is_object()) return std::nullopt;
    const auto type = parsed.find("type");
    if (type == parsed.end() || !type->is_string() || type->get<std::string>() != "state") return std::nullopt;
    const auto state = parsed.find("state");
    if (state == parsed.end() || !state->is_object()) return std::nullopt;
    ShellStatus status;
    status.ringing = Ringing(*state);
    const auto call = state->find("ligacao");
    status.inCall = call != state->end() && call->is_object();
    status.doNotDisturb = Flag(*state, "naoPerturbe");
    const auto account = state->find("conta");
    if (account != state->end() && account->is_object()) {
        const auto value = account->find("status");
        status.connected = value != account->end() && value->is_string() && value->get<std::string>() == "conectado";
    }
    const auto missed = state->find("perdidas");
    if (missed != state->end() && missed->is_number_integer()) status.missed = missed->get<int>();
    return status;
}

TrayIcon ChooseTrayIcon(const ShellStatus& status) {
    // Uma ligacao da conta conectada (tocando tambem): "em ligacao", o ponto vermelho (a bolinha da interface).
    if (status.connected && status.inCall) return TrayIcon::InCall;
    if (status.missed > 0) return TrayIcon::Missed;
    if (status.doNotDisturb) return TrayIcon::DoNotDisturb;
    return status.connected ? TrayIcon::Connected : TrayIcon::Offline;
}

bool IsCommand(const std::string& json, const char* name) {
    if (json.find(name) == std::string::npos) return false;
    const Json parsed = Json::parse(json, nullptr, /*allow_exceptions=*/false);
    if (!parsed.is_object()) return false;
    const auto cmd = parsed.find("cmd");
    return cmd != parsed.end() && cmd->is_string() && cmd->get<std::string>() == name;
}

}  // namespace starsonic
