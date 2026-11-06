#pragma once
// O numero de mensagens do chat nao lidas no botao da barra de tarefas (0.2.0; spec do chat, 6.4): o
// ITaskbarList3::SetOverlayIcon com um icone desenhado na hora pelo GDI (o circulo #00C2CB com o BadgeText em #03222A
// e negrito, no tamanho do icone pequeno, o SM_CXSMICON do DPI da janela) e a descricao para o leitor de tela
// (BadgeDescription). Com 0, o icone sai.
//
// O botao some com a janela escondida na bandeja e volta com ela (e com o Explorer que reiniciou), e o Windows manda a
// mensagem TaskbarButtonCreated a cada vez: so depois dela o ITaskbarList3 vale para o botao. O OnButtonCreated (essa
// mensagem) pega um ITaskbarList3 novo e poe de novo o numero de agora; um Set antes dela so guarda o numero.
//
// Tudo na thread da janela dona (a principal, com o COM dela: o CoInitializeEx do main.cpp). O Detach (no WM_DESTROY)
// solta o ITaskbarList3 antes do CoUninitialize.
#include <windows.h>

#include <shobjidl.h>
#include <wrl/client.h>

#include <functional>
#include <string>

namespace starsonic {

class TaskbarBadge {
public:
    TaskbarBadge() = default;
    ~TaskbarBadge();

    TaskbarBadge(const TaskbarBadge&) = delete;
    TaskbarBadge& operator=(const TaskbarBadge&) = delete;

    // A janela do botao (logo depois de criada, antes de aparecer). log: uma linha do diagnostico (o CoCreateInstance,
    // o HrInit e o SetOverlayIcon que falham: "numero no icone: <operacao> falhou (0x<HRESULT>)", ShellFailureLine).
    void Attach(HWND window, std::function<void(const std::string&)> log);
    // A janela fechou: solta o ITaskbarList3, e nada mais vai ao botao.
    void Detach();
    // A mensagem TaskbarButtonCreated: o ITaskbarList3 (de novo), com o numero de agora.
    void OnButtonCreated();
    // O numero de mensagens nao lidas (0 ou menos: sem numero).
    void Set(int n);

    // A mensagem que o Windows manda quando o botao da janela aparece na barra de tarefas.
    static UINT ButtonCreatedMessage();

private:
    void Apply();
    void Fail(const char* operacao, HRESULT result) const;

    HWND window_ = nullptr;
    std::function<void(const std::string&)> log_;
    Microsoft::WRL::ComPtr<ITaskbarList3> taskbar_;   // nada antes do primeiro TaskbarButtonCreated
    int count_ = 0;
};

}  // namespace starsonic
