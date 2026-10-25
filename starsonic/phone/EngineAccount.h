#pragma once
// A conta do pjsua2 do motor (interna): repassa as respostas do registro, leva as ligações que chegam
// à tabela de ligações, sai do servidor sem deixar o registro para trás e para o registro quando a rede
// cai. E as assinaturas de BLF da conta (BlfBuddy).
#include <pjsua2.hpp>

#include <atomic>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "AccountConfig.h"
#include "EngineEndpoint.h"
#include "EngineEvents.h"

namespace starsonic {

class CallTable;
class EventQueue;

// A configuração do pjsua2 para a conta, como no MicroSIP (sem reescrita, sem ICE).
pj::AccountConfig MakeAccountConfig(const PjAccountSettings& settings, pj::TransportId transportId);

// Os callbacks chegam numa thread do PJSIP (ou na que chamou o PJSIP), com a trava do pjsua.
class EngineAccount : public pj::Account, public TimerTarget {
public:
    enum class Exit { Confirmed, NothingToRemove, NoAnswer };

    // id: o que SetAccount devolve; vai em cada OnRegistration desta conta. endpoint: o do motor, que dá os
    // temporizadores da conta (dura mais que ela).
    EngineAccount(EventQueue* events, CallTable* calls, EngineEndpoint* endpoint, int id);
    ~EngineAccount() override;

    int Id() const { return id_; }

    // O create() do pjsua2 com a configuração da conta, que fica guardada para o Resume. paused: a rede está
    // fora; a conta nasce sem registrar e parada (como depois de um Pause). onActive: chamado (numa thread do
    // PJSIP, com a trava do pjsua; não pode chamar o PJSIP nem esperar) cada vez que a conta passa de sem
    // registro a registrada, também na primeira vez, e na primeira resposta que a deixa registrada depois de um
    // Resume (o registro pode ter continuado vivo no Pause). onInactive: do mesmo jeito, cada vez que ela passa de
    // registrada a sem registro fora do Pause e do Retire (uma renovação recusada ou sem resposta, a central
    // reiniciada). Lança pj::Error como o create().
    void Start(const pj::AccountConfig& config, bool paused, std::function<void()> onActive,
               std::function<void()> onInactive);

    // A rede caiu: o PJSIP deixa de tentar de novo (o intervalo das novas tentativas vai a zero) e nenhuma
    // resposta de registro vira evento. O registro não sai do servidor (Ruling 25): ele vive até vencer ou até
    // a próxima renovação falhar (uma tentativa só, sem outra). Não espera.
    void Pause();

    // A rede voltou: a configuração de antes volta, as respostas voltam a virar evento e a conta pede o
    // registro (Register).
    void Resume();

    // Pede o registro agora. Com um pedido ainda a caminho (PJSIP_EBUSY: uma renovação, também uma que saiu
    // durante um Pause e ficou sem resposta), o registro vai logo depois da resposta dele, num temporizador; se
    // essa resposta deixa a conta sem registro, ela não vira evento (é de antes do pedido). Não espera.
    void Register();

    // O registro adiado por Register (temporizador do EngineEndpoint).
    void OnEngineTimer() override;

    // A conta vai sair: daqui em diante nenhuma resposta de registro vira evento (um 200 sem registro
    // seria lido como o resultado da conta nova), as ligações que chegam são recusadas (480) e nenhum
    // registro adiado sai.
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
    EngineEndpoint* endpoint_;
    const int id_;
    pj::AccountConfig config_;   // a de Start (com a apiMutex_ do motor)
    std::function<void()> onActive_;     // de Start, antes do create(): só lidos nos callbacks
    std::function<void()> onInactive_;
    std::atomic<bool> retired_{false};
    std::atomic<bool> paused_{false};   // a rede está fora: as respostas de registro não viram evento
    std::atomic<bool> resumed_{false};  // o Resume: a próxima resposta que deixa a conta registrada é a volta
    // Register achou um pedido a caminho: wantRegistered_ = registrar logo depois da resposta dele (se ela
    // deixa a conta sem registro); staleInactive_ = essa resposta, se deixa a conta sem registro, não vira
    // evento. O regc do PJSIP tem um pedido por vez, então a próxima resposta é a dele.
    std::atomic<bool> wantRegistered_{false};
    std::atomic<bool> staleInactive_{false};
    bool wasActive_ = false;   // a última resposta deixou a conta registrada (só nos callbacks, com a trava do pjsua)
    std::mutex mutex_;
    std::condition_variable changed_;
    unsigned results_ = 0;    // respostas de registro que chegaram (qualquer código)
    bool inactive_ = false;   // a última resposta deixou a conta sem registro
    int lastCode_ = 0;        // o código da última resposta
};

// O tamanho máximo, em bytes, de um número de BLF (o app aceita até 32 caracteres).
const size_t kMaxBlfNumber = 63;

// O que o motor sabe do BLF de um ramal: os diálogos dele e o último estado avisado. Dura mais que as
// assinaturas (BlfBuddy) do ramal, que o usam nos callbacks; uma nova assinatura continua com ele. Qualquer
// thread (trava própria, curta; nunca chama o PJSIP).
class BlfTrack {
public:
    BlfTrack(EventQueue* events, const std::string& number) : events_(events), number_(number) {}

    // Um NOTIFY com dialog-info chegou (thread do PJSIP): aplica os diálogos e avisa se o estado mudou.
    void OnNotify(bool full, const std::vector<std::pair<std::string, std::string>>& dialogs);

    // Sem estado (Unknown): a assinatura acabou (ended, thread do PJSIP), o PJSIP a recusou ou a rede
    // caiu. Os diálogos se perdem.
    void SetUnknown(bool ended);

    // Uma nova assinatura começa (a de antes, se havia, já saiu).
    void Restart();

    // A assinatura acabou (recusada, vencida, sem resposta ou encerrada pelo servidor) ou nem começou, e
    // nenhuma nova foi feita desde então.
    bool Ended() const;

private:
    void Report(BlfState state);   // com mutex_

    EventQueue* events_;
    const std::string number_;
    mutable std::mutex mutex_;
    BlfDialogs dialogs_;
    int last_ = -1;       // o último BlfState avisado (-1: nenhum)
    bool ended_ = false;
};

// A assinatura de BLF (o evento dialog) de um ramal numa conta. O objeto sai antes da conta (o pjsua2 pede)
// e antes do BlfTrack dele. Os campos daqui são de destruição trivial: o ~Buddy do pjsua2 só tira o buddy
// do PJSIP depois de o destrutor desta classe ter corrido, e um aviso já em andamento pode estar nela
// nesse meio-tempo (o pjsua_buddy_del costuma esperá-lo pela trava do diálogo, mas não sempre).
class BlfBuddy : public pj::Buddy {
public:
    explicit BlfBuddy(BlfTrack* track) : track_(track) {}

    // Numa thread do PJSIP, com a trava do diálogo da assinatura: cada mudança da assinatura, com o NOTIFY
    // que a trouxe (o PJSIP só guarda o primeiro <dialog>; aqui o corpo é lido inteiro).
    void onBuddyEvSubDlgEventState(pj::OnBuddyEvSubStateParam& param) override;

private:
    BlfTrack* track_;
};

}  // namespace starsonic
