#include "Protocol.h"

#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

using Json = nlohmann::json;
using Out = nlohmann::ordered_json;   // as chaves saem na ordem do docs/ponte-windows.md

struct Name {
    CommandKind kind;
    const char* name;
};

const Name kNames[] = {
    {CommandKind::Ready, "ready"},
    {CommandKind::Login, "login"},
    {CommandKind::SelectAccount, "selectAccount"},
    {CommandKind::RemoveAccount, "removeAccount"},
    {CommandKind::Dial, "dial"},
    {CommandKind::Answer, "answer"},
    {CommandKind::Reject, "reject"},
    {CommandKind::Hangup, "hangup"},
    {CommandKind::Hold, "hold"},
    {CommandKind::Mute, "mute"},
    {CommandKind::Dtmf, "dtmf"},
    {CommandKind::Transfer, "transfer"},
    {CommandKind::Consult, "consult"},
    {CommandKind::CompleteTransfer, "completeTransfer"},
    {CommandKind::CancelConsult, "cancelConsult"},
    {CommandKind::Swap, "swap"},
    {CommandKind::Join, "join"},
    {CommandKind::Split, "split"},
    {CommandKind::SetDnd, "setDnd"},
    {CommandKind::SetAutoAnswer, "setAutoAnswer"},
    {CommandKind::SaveContact, "saveContact"},
    {CommandKind::RemoveContact, "removeContact"},
    {CommandKind::SetAudio, "setAudio"},
    {CommandKind::SetSetting, "setSetting"},
    {CommandKind::OpenExternal, "openExternal"},
    {CommandKind::SendDiagnostics, "sendDiagnostics"},
    {CommandKind::Minimize, "minimize"},
    {CommandKind::CloseToTray, "closeToTray"},
    {CommandKind::Quit, "quit"},
    {CommandKind::ViewRecents, "viewRecents"},
    {CommandKind::UpdateNow, "updateNow"},
    {CommandKind::UpdateLater, "updateLater"},
    {CommandKind::CancelLogin, "cancelLogin"},
};

// Le os campos de um comando, anotando o primeiro problema (um campo obrigatorio que falta ou um tipo errado).
class Fields {
public:
    explicit Fields(const Json& object) : object_(object) {}

    bool ok() const { return error_.empty(); }
    const std::string& error() const { return error_; }

    void Text(const char* key, std::string* out, bool required) {
        const Json* value = Find(key, required);
        if (!value) return;
        if (!value->is_string()) return Wrong(key, "texto");
        *out = value->get<std::string>();
    }
    void OptionalText(const char* key, std::optional<std::string>* out) {
        std::string text;
        if (!Find(key, false)) return;
        Text(key, &text, true);
        if (ok()) *out = text;
    }
    void Flag(const char* key, bool* out, bool required) {
        const Json* value = Find(key, required);
        if (!value) return;
        if (!value->is_boolean()) return Wrong(key, "booleano");
        *out = value->get<bool>();
    }
    void OptionalFlag(const char* key, std::optional<bool>* out, bool required) {
        bool flag = false;
        if (!Find(key, required)) return;
        Flag(key, &flag, true);
        if (ok()) *out = flag;
    }
    // Um inteiro de 0 a INT_MAX (sem fracao).
    void Count(const char* key, std::optional<int>* out) {
        const Json* value = Find(key, false);
        if (!value) return;
        if (!value->is_number_integer() || value->get<int64_t>() < 0 || value->get<int64_t>() > INT32_MAX) {
            return Wrong(key, "inteiro de 0 para cima");
        }
        *out = static_cast<int>(value->get<int64_t>());
    }
    void Fail(const std::string& message) {
        if (ok()) error_ = message;
    }

private:
    const Json* Find(const char* key, bool required) {
        if (!ok()) return nullptr;
        const auto found = object_.find(key);
        if (found == object_.end()) {
            if (required) error_ = std::string("falta o campo ") + key;
            return nullptr;
        }
        return &*found;
    }
    void Wrong(const char* key, const char* type) {
        if (ok()) error_ = std::string("o campo ") + key + " precisa ser " + type;
    }

    const Json& object_;
    std::string error_;
};

std::optional<Command> Refuse(std::string* error, const std::string& message) {
    if (error) *error = message;
    return std::nullopt;
}

const char* StatusName(AccountStatus status) {
    switch (status) {
        case AccountStatus::Connected:
            return "conectado";
        case AccountStatus::Connecting:
            return "conectando";
        case AccountStatus::NoConnection:
            return "sem_conexao";
        case AccountStatus::Error:
            break;
    }
    return "erro";
}

const char* KindName(Recent::Kind kind) {
    switch (kind) {
        case Recent::Outgoing:
            return "feita";
        case Recent::Incoming:
            return "recebida";
        case Recent::Missed:
            break;
    }
    return "perdida";
}

const char* PhaseName(CallView::Phase phase) {
    switch (phase) {
        case CallView::Ringing:
            return "ringing";
        case CallView::Dialing:
            return "dialing";
        case CallView::Active:
            break;
    }
    return "active";
}

Out CallJson(const CallView& view) {
    Out out;
    out["id"] = view.id;
    out["number"] = view.number;
    out["name"] = view.name;
    out["incoming"] = view.incoming;
    out["phase"] = PhaseName(view.phase);
    out["activeSinceMs"] = view.activeSinceMs;
    out["held"] = view.held;
    return out;
}

// O CallSnapshot com os nomes dos campos do C++. Na conferencia o controlador deixa a segunda como Held (com held
// false): aqui ela sai como "active", e a interface olha o conference antes do secondKind. O endMessage vai como
// toast (DesktopApp), nao no estado.
Out SnapshotJson(const CallSnapshot& call) {
    if (!call.top) return Out();
    Out out;
    out["top"] = CallJson(*call.top);
    out["second"] = call.second ? CallJson(*call.second) : Out();
    const char* kind = "none";
    if (call.second) {
        if (call.secondKind == CallSnapshot::Ringing) {
            kind = "ringing";
        } else if (call.conference) {
            kind = "active";
        } else if (call.secondKind == CallSnapshot::Held) {
            kind = "held";
        }
    }
    out["secondKind"] = kind;
    out["muted"] = call.muted;
    out["conference"] = call.conference;
    out["conferenceSinceMs"] = call.conferenceSinceMs;
    out["consulting"] = call.consulting;
    out["colleagueActive"] = call.colleagueActive;
    return out;
}

Out AccountJson(const AccountView& account, bool current) {
    Out out;
    out["id"] = account.id;
    out["nome"] = account.name;
    out["ramal"] = account.ramal;
    out["servidor"] = account.server;
    out["protocolo"] = account.transport;
    if (current) {
        out["status"] = StatusName(account.status);
        out["texto"] = account.text;
    } else {
        out["emUso"] = account.inUse;
    }
    return out;
}

Out Options(const std::vector<AudioOption>& options) {
    Out out = Out::array();
    for (const AudioOption& option : options) out.push_back(Out{{"id", option.id}, {"nome", option.name}});
    return out;
}

std::string Dump(const Out& message) {
    // Um nome da central com bytes que nao sao UTF-8 vira U+FFFD em vez de impedir a mensagem.
    return message.dump(-1, ' ', false, Out::error_handler_t::replace);
}

}  // namespace

const char* CommandName(CommandKind kind) {
    for (const Name& name : kNames) {
        if (name.kind == kind) return name.name;
    }
    return "";
}

std::optional<Command> ParseCommand(const std::string& text, std::string* error) {
    const Json message = Json::parse(text, nullptr, /*allow_exceptions=*/false);
    if (message.is_discarded()) return Refuse(error, "nao e JSON");
    if (!message.is_object()) return Refuse(error, "nao e um objeto");
    const auto version = message.find("v");
    if (version == message.end() || !version->is_number_integer() || version->get<int64_t>() != kBridgeVersion) {
        return Refuse(error, "versao diferente de 1");
    }
    const auto name = message.find("cmd");
    if (name == message.end() || !name->is_string()) return Refuse(error, "sem cmd");
    const std::string cmd = name->get<std::string>();
    Command command;
    bool known = false;
    for (const Name& entry : kNames) {
        if (cmd == entry.name) {
            command.kind = entry.kind;
            known = true;
            break;
        }
    }
    if (!known) return Refuse(error, "comando desconhecido: " + cmd.substr(0, 40));

    Fields f(message);
    switch (command.kind) {
        case CommandKind::Login:
            f.Text("servidor", &command.server, true);
            f.Text("protocolo", &command.transport, true);
            f.Text("ramal", &command.ramal, true);
            f.Text("senha", &command.password, true);
            f.Text("nome", &command.name, false);
            f.Text("contaId", &command.accountId, false);
            if (f.ok() && command.transport != "udp" && command.transport != "tcp") {
                f.Fail("o protocolo precisa ser udp ou tcp");
            }
            break;
        case CommandKind::SelectAccount:
        case CommandKind::RemoveAccount:
            f.Text("contaId", &command.accountId, true);
            break;
        case CommandKind::Dial:
            f.Text("numero", &command.number, true);
            f.Flag("contato", &command.contact, false);
            break;
        case CommandKind::Transfer:
        case CommandKind::Consult:
            f.Text("numero", &command.number, true);
            break;
        case CommandKind::Hangup:
            f.Count("id", &command.callId);
            break;
        case CommandKind::Hold:
        case CommandKind::Mute:
            f.OptionalFlag("on", &command.on, false);
            break;
        case CommandKind::Dtmf:
            f.Text("digitos", &command.digits, true);
            break;
        case CommandKind::SetDnd:
            f.OptionalFlag("on", &command.on, true);
            break;
        case CommandKind::SetAutoAnswer:
            f.OptionalFlag("on", &command.on, true);
            f.Count("segundos", &command.seconds);
            break;
        case CommandKind::SaveContact:
            f.Text("id", &command.contactId, false);
            f.Text("nome", &command.name, true);
            f.Text("numero", &command.number, true);
            f.Text("observacao", &command.note, false);
            break;
        case CommandKind::RemoveContact:
            f.Text("id", &command.contactId, true);
            break;
        case CommandKind::SetAudio:
            f.OptionalText("microfone", &command.capture);
            f.OptionalText("altoFalante", &command.playback);
            f.OptionalText("toque", &command.ring);
            break;
        case CommandKind::SetSetting:
            f.Text("chave", &command.key, true);
            if (f.ok() && command.key != "iniciarComWindows") f.Fail("chave desconhecida: " + command.key.substr(0, 40));
            f.Flag("valor", &command.value, true);
            break;
        case CommandKind::OpenExternal:
            f.Text("url", &command.url, true);
            break;
        case CommandKind::Ready:
        case CommandKind::Answer:
        case CommandKind::Reject:
        case CommandKind::CompleteTransfer:
        case CommandKind::CancelConsult:
        case CommandKind::Swap:
        case CommandKind::Join:
        case CommandKind::Split:
        case CommandKind::SendDiagnostics:
        case CommandKind::Minimize:
        case CommandKind::CloseToTray:
        case CommandKind::Quit:
        case CommandKind::ViewRecents:
        case CommandKind::UpdateNow:
        case CommandKind::UpdateLater:
        case CommandKind::CancelLogin:
            break;
    }
    if (!f.ok()) return Refuse(error, cmd + ": " + f.error());
    return command;
}

std::string StateMessage(const BridgeState& state) {
    Out s;
    s["tela"] = state.mainScreen ? "principal" : "entrar";
    s["entrar"] = Out{{"servidor", state.login.server},     {"protocolo", state.login.transport},
                      {"ramal", state.login.ramal},         {"nome", state.login.name},
                      {"erro", state.login.error},          {"ocupado", state.login.busy},
                      {"pedeSenha", state.login.needsPassword}, {"podeCancelar", state.login.canCancel},
                      {"contaId", state.login.accountId}};
    s["conta"] = state.account ? AccountJson(*state.account, /*current=*/true) : Out();
    Out accounts = Out::array();
    for (const AccountView& account : state.accounts) accounts.push_back(AccountJson(account, /*current=*/false));
    s["contas"] = accounts;
    s["naoPerturbe"] = state.doNotDisturb;
    s["atenderAutomatico"] = Out{{"on", state.autoAnswer}, {"segundos", state.autoAnswerSeconds}};
    s["ligacao"] = SnapshotJson(state.call);
    Out recents = Out::array();
    for (const RecentView& recent : state.recents) {
        recents.push_back(Out{{"numero", recent.number},
                              {"nome", recent.name},
                              {"tipo", KindName(recent.kind)},
                              {"inicio", recent.startMs},
                              {"duracao", recent.durationMs},
                              {"contatoId", recent.contactId}});
    }
    s["recentes"] = recents;
    s["perdidas"] = state.missed;
    Out contacts = Out::array();
    for (const ContactView& contact : state.contacts) {
        contacts.push_back(Out{
            {"id", contact.id}, {"nome", contact.name}, {"numero", contact.number}, {"observacao", contact.note}});
    }
    s["contatos"] = contacts;
    Out disconnected = Out::array();
    for (const std::string& name : state.audio.disconnected) disconnected.push_back(name);
    s["audio"] = Out{{"microfones", Options(state.audio.captures)},
                     {"altoFalantes", Options(state.audio.playbacks)},
                     {"microfone", state.audio.capture},
                     {"altoFalante", state.audio.playback},
                     {"toque", state.audio.ring},
                     {"desconectados", disconnected}};
    s["iniciarComWindows"] = state.startWithWindows;
    s["versao"] = state.version;
    s["teclado"] = state.keypad;
    s["tecladoVez"] = state.keypadSeq;
    return Dump(Out{{"v", kBridgeVersion}, {"type", "state"}, {"state", s}});
}

std::string ToastMessage(const std::string& text) {
    return Dump(Out{{"v", kBridgeVersion}, {"type", "toast"}, {"texto", text}});
}

std::string UpdateMessage(const std::string& version, const std::string& notes) {
    return Dump(Out{{"v", kBridgeVersion}, {"type", "update"}, {"versao", version}, {"notas", notes}});
}

std::string RingMessage(RingKind kind) {
    const char* name = "parar";
    if (kind == RingKind::Full) name = "completo";
    if (kind == RingKind::Waiting) name = "espera";
    return Dump(Out{{"v", kBridgeVersion}, {"type", "ring"}, {"tipo", name}});
}

}  // namespace starsonic
