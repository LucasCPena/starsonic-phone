#pragma once
// O protocolo da ponte, versao 1, entre a interface (TypeScript, no WebView2) e o C++ do app de PC: os comandos que
// a interface manda ({"v":1,"cmd":...}) e as mensagens que o C++ manda ({"v":1,"type":"state"|"toast"|"ring"|"update",
// ...}).
// O contrato, com cada campo e um exemplo, e o docs/ponte-windows.md: uma mudanca aqui muda o documento junto (e
// o kBridgeVersion, se o formato deixa de ser compativel). Os textos sao UTF-8.
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "CallController.h"   // CallSnapshot, Recent, RingKind

namespace starsonic {

constexpr int kBridgeVersion = 1;

enum class CommandKind {
    Ready,
    Login,
    SelectAccount,
    RemoveAccount,
    Dial,
    Answer,
    Reject,
    Hangup,
    Hold,
    Mute,
    Dtmf,
    Transfer,
    Consult,
    CompleteTransfer,
    CancelConsult,
    Swap,
    Join,
    Split,
    SetDnd,
    SetAutoAnswer,
    SaveContact,
    RemoveContact,
    SetAudio,
    SetSetting,
    OpenExternal,
    SendDiagnostics,
    Minimize,
    CloseToTray,
    Quit,
    ViewRecents,
    UpdateNow,     // a pergunta da atualizacao: "Atualizar agora"
    UpdateLater,   // e "Depois"
};

// Um comando lido. So os campos do comando valem; os outros ficam vazios.
struct Command {
    CommandKind kind = CommandKind::Ready;
    // login: servidor, protocolo ("udp" | "tcp"), ramal, senha, nome (opcional) e contaId (opcional: "" = conta nova).
    // selectAccount e removeAccount: contaId.
    std::string server;
    std::string transport;
    std::string ramal;
    std::string password;
    std::string name;
    std::string accountId;
    // dial (com contact: o numero de um contato, pela regra dos contatos), transfer, consult; saveContact: numero.
    std::string number;
    bool contact = false;
    // hangup: o id do cartao (ausente: a ligacao ativa; 0: a feita que ainda nao tem id).
    std::optional<int> callId;
    // hold e mute (ausente: troca); setDnd e setAutoAnswer (sempre presente).
    std::optional<bool> on;
    // setAutoAnswer (ausente: o tempo de agora).
    std::optional<int> seconds;
    // dtmf
    std::string digits;
    // saveContact: id (opcional: "" = contato novo), nome (em name), numero (em number), observacao; removeContact: id.
    std::string contactId;
    std::string note;
    // setAudio: os nomes escolhidos ("" = o padrao do Windows) e o dispositivo de toque da interface; ausente: fica.
    std::optional<std::string> capture;
    std::optional<std::string> playback;
    std::optional<std::string> ring;
    // setSetting: so a chave "iniciarComWindows", com um valor booleano.
    std::string key;
    bool value = false;
    // openExternal
    std::string url;
};

// O comando do JSON, ou nada (com o motivo em *error, se error nao e nullptr): texto que nao e JSON, sem "v":1,
// comando desconhecido, campo obrigatorio ausente ou campo com o tipo errado. Campos a mais sao ignorados.
std::optional<Command> ParseCommand(const std::string& json, std::string* error = nullptr);

// O nome do comando no protocolo ("ready", "login"...).
const char* CommandName(CommandKind kind);

// O estado que a interface desenha (a mensagem "state"). Os textos em UTF-8.
struct LoginView {                  // entrar
    std::string server;             // servidor
    std::string transport = "udp";  // protocolo
    std::string ramal;
    std::string name;               // nome
    std::string error;              // erro ("" sem erro)
    bool busy = false;              // ocupado: esperando o resultado do registro (ou o fim da ligacao)
    bool needsPassword = false;     // pedeSenha: a conta veio sem senha (a migracao): so falta ela
    std::string accountId;          // contaId: a conta que esta tela edita ("" = conta nova)
};

enum class AccountStatus { Connected, Connecting, NoConnection, Error };

struct AccountView {                // conta e contas[]
    std::string id;
    std::string name;
    std::string ramal;
    std::string server;
    std::string transport = "udp";
    bool inUse = false;             // emUso (so em contas[])
    AccountStatus status = AccountStatus::Connecting;   // status (so em conta)
    std::string text;               // texto (so em conta)
};

struct RecentView {                 // recentes[]
    std::string number;             // numero
    std::string name;               // nome: o do contato com o numero, senao o que a central mandou ("" sem os dois)
    Recent::Kind kind = Recent::Outgoing;   // tipo
    int64_t startMs = 0;            // inicio (ms desde 1970)
    int64_t durationMs = 0;         // duracao (ms)
    std::string contactId;          // contatoId: o contato com o numero ("" sem contato)
};

struct ContactView {                // contatos[]
    std::string id;
    std::string name;
    std::string number;
    std::string note;
};

struct AudioOption {
    int id = -1;
    std::string name;
};

struct AudioView {                  // audio
    std::vector<AudioOption> captures;    // microfones
    std::vector<AudioOption> playbacks;   // altoFalantes
    std::string capture;                  // microfone: o nome escolhido ("" = o padrao do Windows)
    std::string playback;                 // altoFalante
    std::string ring;                     // toque: o dispositivo de toque da interface ("" = o padrao)
    std::vector<std::string> disconnected;   // desconectados: os nomes escolhidos que nao estao na lista agora
};

struct BridgeState {
    bool mainScreen = false;                // tela: "principal" (true) ou "entrar"
    LoginView login;                        // entrar
    std::optional<AccountView> account;     // conta (null sem conta em uso)
    std::vector<AccountView> accounts;      // contas
    bool doNotDisturb = false;              // naoPerturbe
    bool autoAnswer = false;                // atenderAutomatico.on
    int autoAnswerSeconds = 3;              // atenderAutomatico.segundos
    CallSnapshot call;                      // ligacao (null sem ligacao: sem top)
    std::vector<RecentView> recents;        // recentes (a mais nova primeiro)
    int missed = 0;                         // perdidas
    std::vector<ContactView> contacts;      // contatos (por nome)
    AudioView audio;                        // audio
    bool startWithWindows = true;           // iniciarComWindows
    std::string version;                    // versao
    std::string keypad;                     // teclado: o numero posto por um link
    int keypadSeq = 0;                      // tecladoVez: sobe a cada link
};

// {"v":1,"type":"state","state":{...}}
std::string StateMessage(const BridgeState& state);
// {"v":1,"type":"toast","texto":"..."}
std::string ToastMessage(const std::string& text);
// {"v":1,"type":"ring","tipo":"completo"|"espera"|"parar"}
std::string RingMessage(RingKind kind);
// {"v":1,"type":"update","versao":"...","notas":"..."}: a pergunta da atualizacao (a interface responde com updateNow
// ou updateLater).
std::string UpdateMessage(const std::string& version, const std::string& notes);

}  // namespace starsonic
