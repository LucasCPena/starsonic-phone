#pragma once
// O que a janela, o aviso, a bandeja e o monitor de rede precisam do estado da ponte (o {"type":"state"} que o
// DesktopApp manda a interface, docs/ponte-windows.md): o executavel le a mesma mensagem que a interface, sem perguntar
// nada ao DesktopApp (nenhuma espera entre a thread da janela e a de comandos).
//
// C++ portatil (o nlohmann/json): so le o texto.
#include <optional>
#include <string>

namespace starsonic {

struct ShellStatus {
    bool ringing = false;        // uma recebida tocando: a de cima, ou a segunda (fora da conferencia)
    bool connected = false;      // conta.status "conectado"
    bool inCall = false;         // existe uma ligacao (ligacao nao nula: tocando, chamando ou em andamento)
    bool doNotDisturb = false;   // naoPerturbe
    int missed = 0;              // perdidas
    // rc.3
    bool internet = true;            // conta.internet (so um false de verdade conta: sem conta, ou sem o campo, true)
    bool doNotDisturbShown = true;   // admin.naoPerturbe: o administrador mostra o Nao perturbe (o item da bandeja)
    std::string server;              // conta.servidor ("" sem conta): o teste DNS do monitor de rede
};

// O estado de uma mensagem {"v":1,"type":"state",...}; nada para as outras (toast, ring, update) e texto invalido.
std::optional<ShellStatus> ReadShellStatus(const std::string& message);

// Os icones da bandeja (spec da W1, 7.4; rc.2: o conectado com o ponto verde e o "em ligacao" com o vermelho).
enum class TrayIcon { Connected, Offline, DoNotDisturb, Missed, InCall };

// A tabela da bolinha da rc.3 (spec 7, a mesma da interface; vale a primeira que bate): sem internet, conectando, o erro
// no cadastro e sem conexao (e sem conta) usam o de sem conexao; depois a ligacao (tocando tambem: o vermelho), a
// ligacao perdida que a pessoa ainda nao viu nos Recentes (no lugar dela da rc.2, entre a ligacao e o Nao perturbe), o
// Nao perturbe (o vermelho dele) e o conectado (o verde).
TrayIcon ChooseTrayIcon(const ShellStatus& status);

// O nome do icone para o diagnostico ("conectado", "sem conexao", "nao perturbe", "perdida", "em ligacao").
const char* TrayIconName(TrayIcon icon);

// O comando da ponte (o JSON da interface) e este? ("answer", "ready"...)
bool IsCommand(const std::string& json, const char* name);

}  // namespace starsonic
