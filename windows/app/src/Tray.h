#pragma once
// O icone da bandeja (spec da W1, 7.4): o estado (conectado, sem conexao, Nao perturbe, ligacao perdida: os icones
// de windows/app/res), piscando enquanto uma ligacao toca (o aviso do canto pode nao aparecer por cima de uma tela
// cheia: spec 13), um clique mostra a janela e o menu tem Abrir, Nao perturbe (marcado quando ligado) e Sair.
//
// Tudo na thread da janela dona (a principal): os avisos do icone chegam nela como kMessage, e o pisca e um timer
// dela (kBlinkTimer), que ela repassa (Blink).
#include <windows.h>

#include "ShellState.h"

namespace starsonic {

class Tray {
public:
    static const UINT kMessage = WM_APP + 20;
    static const UINT_PTR kBlinkTimer = 20;

    enum class Choice { None, Open, ToggleDoNotDisturb, Quit };

    Tray() = default;
    ~Tray();

    Tray(const Tray&) = delete;
    Tray& operator=(const Tray&) = delete;

    // Poe o icone na bandeja. false: o Windows recusou (tenta de novo no TaskbarCreated).
    bool Create(HWND owner, HINSTANCE instance);
    // O Explorer reiniciou (a mensagem TaskbarCreated): o icone volta.
    void Recreate();
    void Remove();

    void SetState(TrayIcon icon, bool doNotDisturb);
    void SetRinging(bool ringing);
    void Blink();   // o kBlinkTimer

    // Um kMessage: o clique (Open) ou o menu (a escolha dele).
    Choice Handle(WPARAM wParam, LPARAM lParam);

    // A mensagem que o Explorer manda quando a barra de tarefas volta.
    static UINT TaskbarCreatedMessage();

private:
    bool Add();
    void Update();
    HICON IconFor(TrayIcon icon);
    Choice ShowMenu(int x, int y);

    HWND owner_ = nullptr;
    HINSTANCE instance_ = nullptr;
    bool added_ = false;
    TrayIcon icon_ = TrayIcon::Offline;
    bool doNotDisturb_ = false;
    bool ringing_ = false;
    bool blinkOn_ = false;
    HICON icons_[5] = {};   // conectado, sem conexao, Nao perturbe, perdida, tocando
};

}  // namespace starsonic
