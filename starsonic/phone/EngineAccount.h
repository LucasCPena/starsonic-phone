#pragma once
// A conta do pjsua2 do motor (interna): repassa as respostas do registro, leva as ligações que chegam
// à tabela de ligações, sai do servidor sem deixar o registro para trás e para o registro quando a rede
// cai. E as assinaturas de BLF da conta (BlfBuddy).
#include <pjsua2.hpp>

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <string>

#include "AccountConfig.h"

namespace starsonic {

class CallTable;
class EventQueue;

// A configuração do pjsua2 para a conta, como no MicroSIP (sem reescrita, sem ICE).
pj::AccountConfig MakeAccountConfig(const PjAccountSettings& settings, pj::TransportId transportId);

// Os callbacks chegam numa thread do PJSIP (ou na que chamou o PJSIP), com a trava do pjsua.
class EngineAccount : public pj::Account {
public:
    enum class Exit { Confirmed, NothingToRemove, NoAnswer };

    // id: o que SetAccount devolve; vai em cada OnRegistration desta conta.
    EngineAccount(EventQueue* events, CallTable* calls, int id);

    int Id() const { return id_; }

    // O create() do pjsua2 com a configuração da conta, que fica guardada para o Resume. paused: a rede está
    // fora; a conta nasce sem registrar e parada (como depois de um Pause). Lança pj::Error como o create().
    void Start(const pj::AccountConfig& config, bool paused);

    // A rede caiu: o PJSIP deixa de tentar de novo (o intervalo das novas tentativas vai a zero), nenhuma
    // resposta de registro vira evento e o registro sai do servidor (Unregister, com o mesmo prazo).
    Exit Pause(int timeoutMs);

    // A rede voltou: a configuração de antes volta, as respostas voltam a virar evento e a conta pede o
    // registro (Register). false como em Register.
    bool Resume(int timeoutMs);

    // Pede o registro. Com um pedido ainda a caminho (PJSIP_EBUSY), espera a resposta dele e pede de novo,
    // dentro de timeoutMs. false: o PJSIP recusou ou o pedido de antes não acabou no prazo (o log diz).
    bool Register(int timeoutMs);

    // A conta vai sair: daqui em diante nenhuma resposta de registro vira evento (um 200 sem registro
    // seria lido como o resultado da conta nova) e as ligações que chegam são recusadas (480).
    void Retire();

    // Retira o registro e espera a resposta do servidor até timeoutMs. Com um REGISTER ainda a
    // caminho (o PJSIP recusa a saída com PJSIP_EBUSY), espera a resposta dele e pede a saída em
    // seguida, dentro do mesmo prazo. Confirmed: o servidor aceitou a saída (2xx); NothingToRemove: a
    // conta não tinha registro (o último pedido falhou); NoAnswer: sem resposta no prazo ou recusada.
    Exit Unregister(int timeoutMs);

    void onRegState(pj::OnRegStateParam& param) override;
    void onIncomingCall(pj::OnIncomingCallParam& param) override;

private:
    // Troca a configuração da conta no PJSIP sem registrar nem retirar o registro (disableRegOnModify).
    void Modify(const pj::AccountConfig& config);

    EventQueue* events_;
    CallTable* calls_;
    const int id_;
    pj::AccountConfig config_;   // a de Start (com a apiMutex_ do motor)
    std::atomic<bool> retired_{false};
    std::atomic<bool> paused_{false};   // a rede está fora: as respostas de registro não viram evento
    std::mutex mutex_;
    std::condition_variable changed_;
    unsigned results_ = 0;    // respostas de registro que chegaram (qualquer código)
    bool inactive_ = false;   // a última resposta deixou a conta sem registro
    int lastCode_ = 0;        // o código da última resposta
};

// O tamanho máximo, em bytes, de um número de BLF (o app aceita até 32 caracteres).
const size_t kMaxBlfNumber = 63;

// A assinatura de BLF (o evento dialog) de um ramal numa conta: cada mudança de estado vira OnBlf, sem
// repetir o mesmo estado seguido. O objeto sai antes da conta (o pjsua2 pede). O ~Buddy do pjsua2 só tira
// o buddy do PJSIP (e espera, pela trava do diálogo, um aviso que ainda esteja em andamento) depois de os
// campos desta classe já terem sido desmontados: por isso todos eles são de destruição trivial.
class BlfBuddy : public pj::Buddy {
public:
    // number: até kMaxBlfNumber bytes (o resto é cortado).
    BlfBuddy(EventQueue* events, const std::string& number);

    // Numa thread do PJSIP, com a trava do diálogo da assinatura.
    void onBuddyDlgEventState() override;

private:
    EventQueue* events_;
    char number_[kMaxBlfNumber + 1];
    std::atomic<int> last_{-1};   // o último BlfState avisado (-1: nenhum)
};

}  // namespace starsonic
