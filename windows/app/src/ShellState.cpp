#include "ShellState.h"

#include <climits>
#include <cstdint>

#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

using Json = nlohmann::json;

bool Flag(const Json& object, const char* key) {
    const auto found = object.find(key);
    return found != object.end() && found->is_boolean() && found->get<bool>();
}

// O id do motor de uma ligacao do estado (0: sem o campo, ou fora de um id valido).
int CallIdOf(const Json& call) {
    const auto id = call.find("id");
    if (id == call.end() || !id->is_number_integer()) return 0;
    const int64_t value = id->get<int64_t>();
    return value > 0 && value <= INT_MAX ? static_cast<int>(value) : 0;
}

// Uma recebida tocando: a de cima, ou a segunda (fora da conferencia). *ringingId: o id dela (0 sem ele).
// *doorphoneSecond: (0.3.0-rc.2) a que toca e a segunda, com o video.cedo dela true (a imagem de um Porteiro chegando).
bool Ringing(const Json& state, int* ringingId, bool* doorphoneSecond) {
    *ringingId = 0;
    *doorphoneSecond = false;
    const auto call = state.find("ligacao");
    if (call == state.end() || !call->is_object()) return false;
    const auto top = call->find("top");
    if (top != call->end() && top->is_object()) {
        const auto phase = top->find("phase");
        if (phase != top->end() && phase->is_string() && phase->get<std::string>() == "ringing") {
            *ringingId = CallIdOf(*top);
            return true;
        }
    }
    if (Flag(*call, "conference")) return false;
    const auto kind = call->find("secondKind");
    if (kind == call->end() || !kind->is_string() || kind->get<std::string>() != "ringing") return false;
    const auto second = call->find("second");
    if (second != call->end() && second->is_object()) {
        *ringingId = CallIdOf(*second);
        const auto video = second->find("video");
        *doorphoneSecond = video != second->end() && video->is_object() && Flag(*video, "cedo");
    }
    return true;
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
    status.ringing = Ringing(*state, &status.ringingCallId, &status.doorphoneSecond);
    const auto call = state->find("ligacao");
    status.inCall = call != state->end() && call->is_object();
    if (status.inCall) {
        const auto top = call->find("top");
        if (top != call->end() && top->is_object()) status.topCallId = CallIdOf(*top);
    }
    status.doNotDisturb = Flag(*state, "naoPerturbe");
    const auto account = state->find("conta");
    if (account != state->end() && account->is_object()) {
        const auto value = account->find("status");
        status.connected = value != account->end() && value->is_string() && value->get<std::string>() == "conectado";
        const auto internet = account->find("internet");
        status.internet = !(internet != account->end() && internet->is_boolean() && !internet->get<bool>());
        const auto server = account->find("servidor");
        if (server != account->end() && server->is_string()) status.server = server->get<std::string>();
    }
    const auto missed = state->find("perdidas");
    if (missed != state->end() && missed->is_number_integer()) status.missed = missed->get<int>();
    const auto admin = state->find("admin");
    if (admin != state->end() && admin->is_object()) {
        const auto shown = admin->find("naoPerturbe");
        status.doNotDisturbShown = !(shown != admin->end() && shown->is_boolean() && !shown->get<bool>());
    }
    return status;
}

bool ShowsNotice(const ShellStatus& status, bool inFront) {
    return status.ringing && (!inFront || status.doorphoneSecond);
}

TrayIcon ChooseTrayIcon(const ShellStatus& status) {
    // Sem internet, conectando, o erro no cadastro, sem conexao e sem conta: nem a ligacao nem o Nao perturbe ficam
    // vermelhos (a bolinha da interface fica cinza ou ciana).
    if (!status.internet || !status.connected) return TrayIcon::Offline;
    // Uma ligacao (tocando tambem): "em ligacao", o ponto vermelho.
    if (status.inCall) return TrayIcon::InCall;
    if (status.missed > 0) return TrayIcon::Missed;
    if (status.doNotDisturb) return TrayIcon::DoNotDisturb;
    return TrayIcon::Connected;
}

const char* TrayIconName(TrayIcon icon) {
    switch (icon) {
        case TrayIcon::Connected:
            return "conectado";
        case TrayIcon::Offline:
            return "sem conexao";
        case TrayIcon::DoNotDisturb:
            return "nao perturbe";
        case TrayIcon::Missed:
            return "perdida";
        case TrayIcon::InCall:
            return "em ligacao";
    }
    return "?";
}

bool IsCommand(const std::string& json, const char* name) {
    if (json.find(name) == std::string::npos) return false;
    const Json parsed = Json::parse(json, nullptr, /*allow_exceptions=*/false);
    if (!parsed.is_object()) return false;
    const auto cmd = parsed.find("cmd");
    return cmd != parsed.end() && cmd->is_string() && cmd->get<std::string>() == name;
}

}  // namespace starsonic
