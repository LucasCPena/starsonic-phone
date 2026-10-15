#pragma once
// Motor de ligações sobre o PJSIP 2.17 (pjsua2), spec 6.2: monta a conta do perfil, registra, faz e
// recebe ligações e avisa os eventos por EngineListener. Sem nada de Android; este cabeçalho também
// não inclui o PJSIP.
#include <memory>
#include <string>
#include <vector>

#include "Profile.h"

namespace starsonic {

enum class CallState { Incoming = 0, Calling = 1, Early = 2, Connecting = 3, Confirmed = 4, Disconnected = 5 };

// Os eventos (OnRegistration, OnIncomingCall, OnRejectedBusy e OnCallState) chegam numa thread do
// próprio motor, um de cada vez e na ordem em que aconteceram, sem nenhuma trava do motor ou do
// PJSIP presa: o listener pode chamar o motor (só não pode destruí-lo). Um evento pode chegar antes
// de o método que o provocou voltar. Do começo de ~SipEngine em diante nenhum evento é entregue (o
// destrutor espera o que estiver com o listener terminar).
// OnLog é diferente: chega na hora, na thread que escreveu a linha (uma do PJSIP ou a que chamou o
// motor), às vezes com travas do motor ou do PJSIP presas; ele não pode chamar o motor nem esperar
// por outra thread. A implementação precisa durar mais que o motor (o destrutor ainda manda linhas
// de log).
class EngineListener {
public:
    virtual ~EngineListener() {}

    // Cada resposta do registro: o código SIP, se a conta ficou registrada e o id da conta (o que
    // SetAccount devolveu). (200, true) = registrou ou renovou; (200, false) = a conta saiu
    // (RemoveAccount, com o id da conta que saiu; não é um registro); 4xx a 6xx = falhou; sem resposta
    // do servidor, 503 (conexão recusada ou rede fora) ou 408 (tempo esgotado). Uma resposta de uma
    // conta anterior que ainda estava na fila chega com o id dela: quem espera o resultado de uma conta
    // confere o id.
    virtual void OnRegistration(int sipCode, bool active, int accountId) = 0;
    // Chegou uma ligação, que toca (o motor responde 180 sozinho). remoteUser é o usuário do From (o
    // número de quem liga) e remoteName, o nome de exibição (pode ser vazio), em UTF-8.
    virtual void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) = 0;
    // Chegou uma ligação com outra em andamento: o motor respondeu 486 (Ocupado) sozinho.
    virtual void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) = 0;
    // A ligação callId mudou de estado; sipCode é o último código SIP dela. No Disconnected, é o do fim: numa
    // ligação encerrada aqui, a resposta daqui (486 no Reject, 603 no Hangup de uma recebida que toca, 487 na
    // feita cancelada), e não a do outro lado; por isso o CallEndMessage só vale para as feitas (e só para as que
    // não foram atendidas). Disconnected é o último evento de cada ligação.
    virtual void OnCallState(int callId, CallState state, int sipCode) = 0;
    // level como no PJSIP: 1 erro, 2 aviso, 3 informação, 4 detalhe. Sem senhas.
    virtual void OnLog(int level, const std::string& line) = 0;
};

struct EngineConfig {
    std::string userAgent;
    Profile profile;
    bool nullAudio = false;   // sem dispositivo de som (testes)
    int logLevel = 4;
};

struct AccountInput {
    std::wstring address;     // já validado (ValidateServerAddress)
    Transport transport = Transport::Udp;
    std::wstring ramal;       // já validado (ValidateRamal)
    std::wstring senha;
};

// Todo método público registra a thread que chama no PJLIB antes de usar o PJSIP, então pode ser
// chamado de qualquer thread. Chamadas ao mesmo tempo esperam uma pela outra (menos HasCall, que
// nunca espera). Uma ligação por vez: a que chega com outra em andamento recebe 486.
class SipEngine {
public:
    // O pjsua tem estado global: só um motor por processo (um segundo Create devolve nullptr até o
    // primeiro ser destruído). Em caso de erro devolve nullptr e escreve o motivo em *error (se não
    // for nullptr). Com stun= no perfil o pjsua testa os servidores aqui dentro, como no MicroSIP: cada
    // um que não responde atrasa o Create em cerca de 8 s antes de ser ignorado (chame fora da thread
    // principal).
    static std::unique_ptr<SipEngine> Create(const EngineConfig& config, EngineListener* listener, std::string* error);

    // Desliga a ligação e desregistra a conta, sem avisar o listener, e destrói o pjsua; demora cerca
    // de 1 s (mais até ~5 s se o servidor não responde). Não pode ser chamado de dentro de um evento.
    ~SipEngine();

    SipEngine(const SipEngine&) = delete;
    SipEngine& operator=(const SipEngine&) = delete;

    // Troca a conta e registra; o resultado chega por OnRegistration com o id que SetAccount devolve
    // (> 0, e cada conta nova recebe um maior que o das anteriores). A conta anterior sai do servidor
    // sem aviso ao listener (uma ligação em andamento é desligada, com o Disconnected de sempre). 0:
    // dados vazios ou o PJSIP recusou a conta (não há conta). Espera até ~5 s pela saída da conta
    // anterior.
    int SetAccount(const AccountInput& input);

    // Desliga a ligação, retira o registro e apaga a conta; no fim chega OnRegistration(200, false,
    // <id da conta que saiu>), uma vez. Com um REGISTER ainda a caminho, espera a resposta dele e só
    // então pede a saída. Espera até ~3 s pelo servidor; sem resposta, a conta sai assim mesmo (o log
    // diz). Sem conta, nada.
    void RemoveAccount();

    // Renova o registro agora.
    void Reregister();

    // A rede mudou: refaz os transportes e renova o registro (o resultado chega por OnRegistration).
    // O pjsua, com a reescrita do Contact desligada, não refaz o registro sozinho no UDP e só o faz
    // depois de 0 a 10 s no TCP; por isso o motor espera os transportes (até ~2 s) e registra de novo.
    void HandleIpChange();

    // Os codecs ligados (prioridade acima de zero), do mais para o menos preferido.
    std::vector<std::string> ActiveCodecs() const;

    // Liga para sip:<número>@<domínio da conta> (number em UTF-8, já sem separadores; ver
    // NormalizeDialString). Se a porta do perfil não é a 5060, a URI leva a porta (o servidor do
    // registro): sip:<número>@<domínio>:<porta>. Devolve o id da ligação, que os eventos dela trazem,
    // ou -1 (sem conta, número vazio, já há uma ligação ou o PJSIP recusou; nesse caso nenhum evento
    // dela chega). Os eventos podem chegar antes de MakeCall voltar.
    int MakeCall(const std::string& number);

    // Atende (200) ou recusa com Ocupado (486) a ligação recebida que está tocando.
    bool Answer(int callId);
    bool Reject(int callId);

    // Desliga a ligação em qualquer estado (CANCEL, recusa ou BYE); o fim chega por OnCallState.
    bool Hangup(int callId);

    // true põe em espera (re-INVITE com sendonly); false retoma (re-INVITE com sendrecv). Se outra
    // renegociação da ligação ainda está em andamento, espera até ~2 s que ela termine.
    bool SetHold(int callId, bool hold);

    // Microfone mudo ou não, para a ligação de agora e as próximas (até trocar de novo).
    void SetMute(bool muted);

    // Manda os dígitos (0-9, *, #, A-D) pelo método DTMF do perfil: info por SIP INFO; rfc2833, auto
    // e inband por RFC 2833.
    bool SendDtmf(int callId, const std::string& digits);

    // Transfere (REFER) para sip:<número>@<domínio da conta> (com a porta, como em MakeCall); quando o
    // outro lado avisa que deu certo (NOTIFY com 2xx), o motor desliga a ligação.
    bool Transfer(int callId, const std::string& number);

    // Há uma ligação (tocando, chamando ou em andamento), até ela acabar no motor. Fica falso antes de o
    // OnCallState(Disconnected) dela chegar ao listener (que vem pela fila dos eventos): quem acompanha a ligação
    // pelos eventos não usa o HasCall logo depois de uma ação.
    bool HasCall() const;

private:
    class Impl;
    explicit SipEngine(std::unique_ptr<Impl> impl);

    std::unique_ptr<Impl> impl_;
};

}  // namespace starsonic
