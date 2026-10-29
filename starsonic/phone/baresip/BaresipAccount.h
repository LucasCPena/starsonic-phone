#pragma once
// A conta do motor com o baresip (interna): a ua do baresip, que serve às ligações, e o cliente de REGISTER do próprio
// motor, sobre a pilha SIP da libre (sip_drequestf; o re/src/sipreg/reg.c serve de referência). O registro do baresip
// fica desligado (regint=0): o sipreg da libre não deixa saber se há um REGISTER a caminho, não para as novas
// tentativas sem tirar o registro do servidor e manda a saída sozinho quando é destruído.
//
// As regras são as do SipEngine.h e, onde ele não diz, as do motor do PJSIP. Tudo aqui roda na thread do laço: dentro
// do BaresipLoop::Run ou num handler da libre. Só o WaitRetired é chamado fora do Run.
#include <re.h>

#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>

#include "BaresipLoop.h"
#include "Profile.h"
#include "SipEngine.h"

struct ua;

namespace starsonic {

class EventQueue;

class BaresipAccount {   // a conta: a ua do baresip (as ligações) e o cliente de REGISTER; só na thread do laço
public:
    // Ainda sem nada da libre (o Start monta a conta). events: por onde saem os OnRegistration; dura mais que a conta.
    BaresipAccount(EventQueue& events, BaresipLoop::LogSink log);
    // Dentro do Run: o que estiver a caminho para sem avisar nada (o pedido, os temporizadores, o keep-alive), e a ua
    // sai.
    ~BaresipAccount();

    BaresipAccount(const BaresipAccount&) = delete;
    BaresipAccount& operator=(const BaresipAccount&) = delete;

    // BuildAccount (o perfil com os serverPorts da entrada, como o SetAccount do SipEngine.cpp) e ToPjAccount;
    // cria a ua e o cliente de REGISTER, e registra se a rede está disponível. 0 ou o código de erro da libre (o log
    // diz qual); com erro, a conta só pode ser destruída.
    int Start(const Profile& profile, const AccountInput& input, int accountId, bool networkAvailable);

    // Tira a conta do servidor sem esperar aqui. Daqui em diante nenhuma resposta vira evento. Com um REGISTER a
    // caminho, a saída espera a resposta dele; com a conta registrada, vai o REGISTER com Expires 0. Os dois juntos
    // levam até ~3 s, com ou sem resposta, e no fim, com reportExit, chega OnRegistration(200, false, id), uma vez.
    void Retire(bool reportExit);
    // Fora do Run, de qualquer thread: espera o Retire acabar (até ~4 s: os ~3 s dele e uma folga). false: não acabou.
    bool WaitRetired();

    void Refresh();   // REGISTER agora (com outro a caminho, logo depois da resposta dele)
    // false: as renovações seguem no relógio delas, sem evento; depois de uma falha, nenhuma nova tentativa; o
    // keep-alive para. true: REGISTER agora.
    void SetNetworkAvailable(bool available);
    // Os dados de cada REGISTER daqui em diante (já conferidos pelo PushDataProblem). Com a conta montada e a rede
    // disponível, REGISTER agora; antes do Start ou sem rede, só guarda.
    void SetPushData(const std::optional<PushData>& data);
    // Depois do uag_reset_transp: o keep-alive de antes para e, com rede, REGISTER agora.
    void OnIpChange();

    struct ua* Ua() const;
    std::string CallHost() const;   // <domínio>[:porta], como o callHost_ do PJSIP (fields.domain)
    bool Tcp() const;

private:
    struct Hooks;   // as funções que a libre chama (BaresipAccount.cpp)

    // A saída (Retire): None, a conta em uso; Waiting, esperando a resposta do REGISTER que estava a caminho; Leaving,
    // esperando a do REGISTER com Expires 0; Done, a conta saiu.
    enum class Exit { None, Waiting, Leaving, Done };

    void Begin();                 // um REGISTER pedido agora: a regra do pedido a caminho
    int Send(uint32_t expires);   // um REGISTER do pedido de agora (também o de novo, depois de um 401 ou de um 423)
    int OnSend(enum sip_transp tp, const struct sa* src, struct mbuf* mb);   // o Contact, com o endereço local
    void OnResponse(int err, const struct sip_msg* msg);
    void Conclude(int err, const struct sip_msg* msg);   // a resposta final do pedido de agora (ou a falha dele)
    uint32_t Granted(const struct sip_msg* msg) const;   // o tempo que o 2xx concedeu
    bool IsOurContact(const struct sip_addr& contact) const;
    void Schedule(uint64_t delayMs, bool retry);         // a renovação ou a nova tentativa
    void OnTimer();
    void StartKeepAlive(const struct sip_msg* msg);
    void StopKeepAlive();
    void OnKeepAlive();
    void Leave();    // o REGISTER com Expires 0, ou o fim sem ele
    void Finish();   // o fim do Retire
    void Post(int code, bool active);
    void Log(int level, const std::string& line) const;

    EventQueue& events_;
    const BaresipLoop::LogSink log_;
    int id_ = 0;

    // A conta, do Start (UTF-8). A senha nunca vai para o log nem para o texto da ua.
    std::string user_;           // o ramal: o usuário do Contact
    std::string idUri_;          // From e To
    std::string registrarUri_;   // a Request-URI
    std::string route_;          // o proxyUri sem o ;lr (a libre o põe na rota), ou vazio
    std::string authUser_;
    std::string authPassword_;
    std::string callHost_;
    bool tcp_ = false;
    uint32_t keepAliveSec_ = 0;
    uint32_t expires_ = 0;       // o tempo pedido: o regTimeoutSec, ou o Min-Expires de um 423

    // Os dados de push no formato do REGISTER: ;nome=valor (ou ;nome) dentro do Contact, e Nome: valor\r\n.
    std::string contactParams_;
    std::string pushHeaders_;

    struct ua* ua_ = nullptr;
    struct sip_dialog* dlg_ = nullptr;    // Request-URI, From, To, Call-ID, CSeq e a rota
    struct sip_auth* auth_ = nullptr;
    struct sip_request* req_ = nullptr;   // o REGISTER a caminho (a libre o zera antes da resposta final)
    struct tmr timer_;                    // a renovação ou a nova tentativa
    struct tmr keepAliveTimer_;
    struct tmr exitTimer_;                // os ~3 s do Retire
    struct sa laddr_;                     // o endereço local do último REGISTER (o do Contact)
    enum sip_transp tp_ = SIP_TRANSP_NONE;
    struct sa keepAliveDst_;              // de onde veio o último 2xx
    enum sip_transp keepAliveTp_ = SIP_TRANSP_NONE;
    void* keepAliveSock_ = nullptr;       // TCP: a conexão do 2xx (mem_ref); UDP: nenhuma (a libre escolhe o socket)

    bool paused_ = false;            // sem rede
    bool registered_ = false;        // a última resposta final deixou a conta registrada
    bool pending_ = false;           // um REGISTER pedido com outro a caminho: sai logo depois da resposta dele
    bool retrying_ = false;          // o timer_ é de uma nova tentativa, e não de uma renovação
    unsigned retries_ = 0;           // novas tentativas desde o último 2xx
    uint32_t sending_ = 0;           // o Expires do pedido de agora (0: a saída)
    bool authRetried_ = false;       // o pedido de agora já levou um 401 ou 407
    bool intervalRetried_ = false;   // o pedido de agora já levou um 423
    Exit exit_ = Exit::None;
    bool reportExit_ = false;

    // O fim do Retire, para quem espera fora do Run (WaitRetired).
    std::mutex exitMutex_;
    std::condition_variable exitChanged_;
    bool retired_ = false;
};

}  // namespace starsonic
