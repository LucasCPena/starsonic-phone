#pragma once
// Estado da tela Entrar enquanto espera o resultado do registro (spec seção 7.1).
#include <string>

namespace starsonic {

enum class LoginState { Idle, Pending, Done };

struct LoginOutcome {
    bool commit = false;     // registrou: gravar a conta e fechar a tela
    bool rollback = false;   // falhou: voltar à conta ativa anterior e mostrar a mensagem
    std::wstring message;
};

class LoginFlow {
public:
    LoginState State() const;
    void Start();   // Idle → Pending; nos outros estados, nada
    // Só vale em Pending: 100–199 continua esperando, 200–299 confirma, o resto desfaz.
    LoginOutcome OnRegistration(int sipCode, bool tlsFailure);
    LoginOutcome OnTimeout();   // só vale em Pending; resultados que chegam depois são ignorados

private:
    LoginState state_ = LoginState::Idle;
};

}  // namespace starsonic
