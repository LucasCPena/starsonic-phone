#pragma once
// A instancia unica (spec da W1, 7.4): uma segunda abertura do StarsonicPhone.exe (o atalho de novo, um link tel:,
// o "--sair", o Iniciar com o Windows com o app ja aberto) nao abre outro app: ela manda os argumentos dela para a
// primeira e sai.
//
// - Quem e a primeira: o mutex "Local\<nome>" (o nome do app: "StarsonicPhone"; por sessao do Windows).
// - A entrega: uma janela so de mensagens (HWND_MESSAGE) da primeira, de classe "<nome>.Instancia", recebe os
//   argumentos por WM_COPYDATA (UTF-16, cada um terminado em zero). A segunda espera a janela aparecer (a primeira
//   pode estar abrindo) e da a ela o direito de vir para a frente (AllowSetForegroundWindow).
//
// Threads: Listen na thread que tem o laco de mensagens (a da janela principal); o receptor roda nela, dentro do
// WM_COPYDATA (a segunda esta esperando: o receptor so poe o trabalho na fila e volta).
#include <windows.h>

#include <functional>
#include <string>
#include <vector>

namespace starsonic {

class SingleInstance {
public:
    static const wchar_t kAppName[];   // "StarsonicPhone"

    enum class Claim {
        First,          // esta e a primeira: o app abre (e chama Listen)
        Delivered,      // outra ja estava aberta e recebeu os argumentos ("entregue"): esta sai
        NotDelivered,   // outra estava aberta, mas nao recebeu a tempo (travada, ou ainda sem a janela)
    };

    using Receiver = std::function<void(const std::vector<std::wstring>& arguments)>;

    explicit SingleInstance(std::wstring name = kAppName);
    ~SingleInstance();   // solta o mutex e fecha a janela de mensagens

    SingleInstance(const SingleInstance&) = delete;
    SingleInstance& operator=(const SingleInstance&) = delete;

    // Pega o mutex. Se outra instancia ja o tem, entrega os argumentos a ela (esperando ate waitMs pela janela dela).
    Claim Start(const std::vector<std::wstring>& arguments, DWORD waitMs = 5000);

    // Na primeira: as proximas aberturas entregam os argumentos ao receptor, nesta thread. false: sem a janela.
    bool Listen(HINSTANCE instance, Receiver receiver);

private:
    static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam);

    std::wstring name_;
    std::wstring className_;
    HANDLE mutex_ = nullptr;
    HWND window_ = nullptr;
    Receiver receiver_;
};

}  // namespace starsonic
