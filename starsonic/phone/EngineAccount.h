#pragma once
// A conta do pjsua2 do motor (interna): repassa as respostas do registro, leva as ligações que chegam
// à tabela de ligações e sai do servidor sem deixar o registro para trás.
#include <pjsua2.hpp>

#include <atomic>
#include <condition_variable>
#include <mutex>

#include "AccountConfig.h"

namespace starsonic {

class CallTable;
class EventQueue;

// A configuração do pjsua2 para a conta, como no MicroSIP (sem reescrita, sem ICE).
pj::AccountConfig MakeAccountConfig(const PjAccountSettings& settings, pj::TransportId transportId);

// Os callbacks chegam numa thread do PJSIP (ou na que chamou o PJSIP), com a trava do pjsua.
class EngineAccount : public pj::Account {
public:
    // id: o que SetAccount devolve; vai em cada OnRegistration desta conta.
    EngineAccount(EventQueue* events, CallTable* calls, int id);

    int Id() const { return id_; }

    // A conta vai sair: daqui em diante nenhuma resposta de registro vira evento (um 200 sem registro
    // seria lido como o resultado da conta nova) e as ligações que chegam são recusadas (480).
    void Retire();

    enum class Exit { Confirmed, NothingToRemove, NoAnswer };

    // Retira o registro e espera a resposta do servidor até timeoutMs. Com um REGISTER ainda a
    // caminho (o PJSIP recusa a saída com PJSIP_EBUSY), espera a resposta dele e pede a saída em
    // seguida, dentro do mesmo prazo. Confirmed: o servidor aceitou a saída (2xx); NothingToRemove: a
    // conta não tinha registro (o último pedido falhou); NoAnswer: sem resposta no prazo ou recusada.
    Exit Unregister(int timeoutMs);

    void onRegState(pj::OnRegStateParam& param) override;
    void onIncomingCall(pj::OnIncomingCallParam& param) override;

private:
    EventQueue* events_;
    CallTable* calls_;
    const int id_;
    std::atomic<bool> retired_{false};
    std::mutex mutex_;
    std::condition_variable changed_;
    unsigned results_ = 0;    // respostas de registro que chegaram (qualquer código)
    bool inactive_ = false;   // a última resposta deixou a conta sem registro
    int lastCode_ = 0;        // o código da última resposta
};

}  // namespace starsonic
