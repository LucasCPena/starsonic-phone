#pragma once
// O que a janela, o aviso e a bandeja precisam do estado da ponte (o {"type":"state"} que o DesktopApp manda a
// interface, docs/ponte-windows.md): o executavel le a mesma mensagem que a interface, sem perguntar nada ao
// DesktopApp (nenhuma espera entre a thread da janela e a de comandos).
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
};

// O estado de uma mensagem {"v":1,"type":"state",...}; nada para as outras (toast, ring, update) e texto invalido.
std::optional<ShellStatus> ReadShellStatus(const std::string& message);

// Os icones da bandeja (spec da W1, 7.4).
enum class TrayIcon { Connected, Offline, DoNotDisturb, Missed, InCall };

// A ligacao perdida (que a pessoa ainda nao viu nos Recentes) primeiro, depois o Nao perturbe, depois a conexao.
TrayIcon ChooseTrayIcon(const ShellStatus& status);

// O comando da ponte (o JSON da interface) e este? ("answer", "ready"...)
bool IsCommand(const std::string& json, const char* name);

}  // namespace starsonic
