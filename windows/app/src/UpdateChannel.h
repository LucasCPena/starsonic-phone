#pragma once
// O canal de atualizacao que vale no executavel (rc.3, spec 6.2 e Ruling 4): o do administrador, que o DesktopApp manda
// pelo gancho updateChannel ("teste": o canal-teste; "estavel": o release estavel), ou, com "" (e antes do gancho), o do
// build (STARSONIC_UPDATE_CHANNEL_TEST). O canal escolhido vale a partir da proxima verificacao.
//
// Threads: Set roda na thread de comandos do DesktopApp (o gancho nunca espera) e Test na do atualizador, a cada
// verificacao: um atomico.
//
// C++ portatil.
#include <atomic>
#include <string>

namespace starsonic {

class UpdateChannel {
public:
    explicit UpdateChannel(bool buildTest) : buildTest_(buildTest) {}

    // "teste", "estavel" ou "" (o do build). Outro texto (o DesktopApp nunca manda): o do build.
    void Set(const std::string& channel);
    // O canal-teste (true) ou o release estavel (false).
    bool Test() const;

private:
    enum Choice : int { kBuild = 0, kTest = 1, kStable = 2 };

    const bool buildTest_;
    std::atomic<int> choice_{kBuild};
};

}  // namespace starsonic
