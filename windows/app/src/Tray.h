#pragma once
// O icone da bandeja (spec da W1, 7.4): o estado (conectado com o ponto verde, em ligacao com o vermelho, sem conexao,
// Nao perturbe, ligacao perdida: os icones de windows/app/res; rc.3: a tabela da bolinha, ShellState.h), piscando
// enquanto uma ligacao toca (o aviso do canto pode nao aparecer por cima de uma tela cheia: spec 13), um clique mostra a
// janela e o menu tem Abrir, Nao perturbe (marcado quando ligado; rc.3: fora do menu quando o administrador o esconde)
// e Sair. (0.2.0) O aviso do Windows de uma mensagem do chat sai pelo icone (o balao, que o Windows 10 e o 11 mostram
// como um aviso deles), e o clique nele abre a conversa.
//
// Tudo na thread da janela dona (a principal): os avisos do icone chegam nela como kMessage, e o pisca e um timer
// dela (kBlinkTimer), que ela repassa (Blink).
#include <windows.h>

#include <cstdint>
#include <functional>
#include <string>

#include "ShellState.h"

namespace starsonic {

class Tray {
public:
    static const UINT kMessage = WM_APP + 20;
    static const UINT_PTR kBlinkTimer = 20;

    // OpenChat: o clique no aviso do chat (NIN_BALLOONUSERCLICK), para a conversa de NoticeConversation().
    enum class Choice { None, Open, ToggleDoNotDisturb, Quit, OpenChat };

    Tray() = default;
    ~Tray();

    Tray(const Tray&) = delete;
    Tray& operator=(const Tray&) = delete;

    // Poe o icone na bandeja. false: o Windows recusou (tenta de novo no TaskbarCreated). log: uma linha do diagnostico
    // (0.2.0: o aviso do chat que o Windows recusou, so com o codigo: ShellFailureLine, ChatFiles.h).
    bool Create(HWND owner, HINSTANCE instance, std::function<void(const std::string&)> log);
    // O Explorer reiniciou (a mensagem TaskbarCreated): o icone volta.
    void Recreate();
    void Remove();

    // O icone, o Nao perturbe (o item marcado) e se o item aparece (admin.naoPerturbe).
    void SetState(TrayIcon icon, bool doNotDisturb, bool showDoNotDisturb);
    void SetRinging(bool ringing);
    void Blink();   // o kBlinkTimer

    // (0.2.0) O aviso de uma mensagem do chat: o titulo e o texto no tamanho do NOTIFYICONDATA (FitNoticeText: 63 e
    // 255 unidades do UTF-16, sem partir um emoji), com o icone do app grande e o som padrao do aviso. Guarda a
    // conversa (0: a aba Chat) para o clique; um aviso novo toma o lugar do anterior. Sem o icone na bandeja, nada
    // aparece. O Shell_NotifyIconW que falha deixa "aviso: Shell_NotifyIconW falhou (0x<HRESULT>)" no diagnostico.
    void ShowChatNotice(const std::wstring& titulo, const std::wstring& texto, int64_t conversa);
    // A conversa do ultimo aviso do chat (0 antes do primeiro).
    int64_t NoticeConversation() const { return noticeConversation_; }

    // Um kMessage: o clique (Open), o menu (a escolha dele) ou o clique no aviso do chat (OpenChat).
    Choice Handle(WPARAM wParam, LPARAM lParam);

    // A mensagem que o Explorer manda quando a barra de tarefas volta.
    static UINT TaskbarCreatedMessage();

private:
    bool Add();
    void Update();
    HICON IconFor(TrayIcon icon);
    Choice ShowMenu(int x, int y);
    void Log(const std::string& line) const;

    HWND owner_ = nullptr;
    HINSTANCE instance_ = nullptr;
    std::function<void(const std::string&)> log_;
    bool added_ = false;
    TrayIcon icon_ = TrayIcon::Offline;
    bool doNotDisturb_ = false;
    bool showDoNotDisturb_ = true;
    bool ringing_ = false;
    bool blinkOn_ = false;
    HICON icons_[6] = {};   // conectado, sem conexao, Nao perturbe, perdida, em ligacao, tocando
    HICON noticeIcon_ = nullptr;      // o icone do app grande, o do aviso do chat
    int64_t noticeConversation_ = 0;  // a conversa do ultimo aviso do chat
};

}  // namespace starsonic
