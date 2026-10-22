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

// Os eventos (OnRegistration, OnIncomingCall, OnRejectedBusy, OnCallState e OnTransfer) chegam numa
// thread do próprio motor, um de cada vez e na ordem em que aconteceram, sem nenhuma trava do motor ou
// do PJSIP presa: o listener pode chamar o motor (só não pode destruí-lo). Um evento pode chegar antes
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
    // Chegou uma ligação, que toca (o motor responde 180 sozinho): sem ligação nenhuma ou com uma só, já
    // confirmada (a segunda ligação). remoteUser é o usuário do From (o número de quem liga) e
    // remoteName, o nome de exibição (pode ser vazio), em UTF-8.
    virtual void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) = 0;
    // Chegou uma ligação com duas em andamento, ou com uma que ainda não foi confirmada: o motor
    // respondeu 486 (Ocupado) sozinho.
    virtual void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) = 0;
    // A ligação callId mudou de estado; sipCode é o último código SIP dela. No Disconnected, é o do fim: numa
    // ligação encerrada aqui, a resposta daqui (486 no Reject, 603 no Hangup de uma recebida que toca, 487 na
    // feita cancelada), e não a do outro lado; por isso o CallEndMessage só vale para as feitas (e só para as que
    // não foram atendidas). Disconnected é o último evento de cada ligação.
    virtual void OnCallState(int callId, CallState state, int sipCode) = 0;
    // O resultado de Transfer ou de TransferAttended na ligação callId, uma vez por pedido aceito (o
    // método devolveu true): o código do NOTIFY (sipfrag) quando o REFER foi aceito (202), senão o da
    // resposta ao REFER. Com 2xx o motor desliga a ligação (e, na consulta, também a do colega) logo
    // depois, com os Disconnected de sempre; fora de 2xx nada mais muda. Não chega se a ligação acaba
    // antes do resultado. Vazio por padrão.
    virtual void OnTransfer(int /*callId*/, int /*sipCode*/) {}
    // level como no PJSIP: 1 erro, 2 aviso, 3 informação, 4 detalhe. Sem senhas.
    virtual void OnLog(int level, const std::string& line) = 0;
};

// Um dispositivo de som do sistema (a lista do PJSIP). id é o que SetAudioDevices recebe; capture é
// um microfone (tem entrada) e playback, um alto-falante (tem saída); o mesmo dispositivo pode ser os dois.
struct AudioDevice {
    int id = -1;
    std::string name;   // UTF-8 (no Windows, convertido da página ANSI que o PJSIP usa; ver AudioDeviceName.h)
    bool capture = false;
    bool playback = false;
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
// chamado de qualquer thread. Chamadas ao mesmo tempo esperam uma pela outra (menos HasCall e
// CallCount, que nunca esperam). Até duas ligações, uma delas a ativa: só a ativa fica ligada ao
// dispositivo de som, e a outra fica em espera (re-INVITE sendonly). Na conferência (Join) as duas
// ficam com o som e ligadas entre si. A terceira que chega recebe 486.
class SipEngine {
public:
    // O pjsua tem estado global: só um motor por processo (um segundo Create devolve nullptr até o
    // primeiro ser destruído). Em caso de erro devolve nullptr e escreve o motivo em *error (se não
    // for nullptr). Com stun= no perfil o pjsua testa os servidores aqui dentro, como no MicroSIP: cada
    // um que não responde atrasa o Create em cerca de 8 s antes de ser ignorado (chame fora da thread
    // principal).
    static std::unique_ptr<SipEngine> Create(const EngineConfig& config, EngineListener* listener, std::string* error);

    // Desliga as ligações e desregistra a conta, sem avisar o listener, e destrói o pjsua; demora cerca
    // de 1 s (mais até ~5 s se o servidor não responde). Não pode ser chamado de dentro de um evento.
    ~SipEngine();

    SipEngine(const SipEngine&) = delete;
    SipEngine& operator=(const SipEngine&) = delete;

    // Troca a conta e registra; o resultado chega por OnRegistration com o id que SetAccount devolve
    // (> 0, e cada conta nova recebe um maior que o das anteriores). A conta anterior sai do servidor
    // sem aviso ao listener (as ligações em andamento são desligadas, com o Disconnected de sempre). 0:
    // dados vazios ou o PJSIP recusou a conta (não há conta). Espera até ~5 s pela saída da conta
    // anterior.
    int SetAccount(const AccountInput& input);

    // Desliga as ligações, retira o registro e apaga a conta; no fim chega OnRegistration(200, false,
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
    // ou -1 (sem conta, número vazio, já há duas ligações, a outra ainda não foi confirmada ou o PJSIP
    // recusou; nesse caso nenhum evento dela chega). Com uma ligação confirmada em andamento, ela vai
    // para a espera antes (e fica nela mesmo se a nova não sai) e a nova é a ativa. Os eventos podem
    // chegar antes de MakeCall voltar.
    int MakeCall(const std::string& number);

    // Atende (200) ou recusa com Ocupado (486) a ligação recebida que está tocando. Atendida, ela vira
    // a ativa e a outra, se há, vai para a espera.
    bool Answer(int callId);
    bool Reject(int callId);

    // Desliga a ligação em qualquer estado (CANCEL, recusa ou BYE); o fim chega por OnCallState. A
    // outra ligação não volta sozinha: ela segue em espera até um Activate. Na conferência, a outra
    // segue como a ativa, com o som.
    bool Hangup(int callId);

    // callId vira a ativa: a outra (confirmada e fora da espera) vai para a espera, callId é retomada
    // (re-INVITE com sendrecv) se estava em espera, e só ela fica ligada ao dispositivo de som. Já
    // ativa, nada muda. Na conferência, é o Split(callId, a outra). false: id desconhecido ou ligação
    // ainda não confirmada.
    bool Activate(int callId);

    // A conferência a três, na mesa de áudio daqui (a central não fica sabendo): retoma a que está em
    // espera (re-INVITE com sendrecv) e liga as duas ao dispositivo de som e entre si. Nenhuma fica
    // sendo a ativa: o Activate de uma delas desfaz a conferência. Se uma das duas acaba, a outra segue
    // como a ativa, com o som. Já em conferência, nada muda. false (a conferência não começa): id
    // desconhecido, ids iguais, ligação não confirmada, transferência com consulta em andamento
    // (TransferAttended sem resultado ainda) ou o PJSIP recusou a retomada.
    bool Join(int callId, int otherId);

    // Desfaz a conferência: as duas deixam de se ouvir, otherId vai para a espera (re-INVITE com
    // sendonly) e callId fica a ativa, com o som. Fora da conferência, é o Activate(callId). false: id
    // desconhecido, ids iguais ou ligação não confirmada.
    bool Split(int callId, int otherId);

    // true põe callId em espera (re-INVITE com sendonly; já em espera, nada muda); false é o Activate
    // (a outra ligação, se ativa, vai para a espera). Se outra renegociação da ligação ainda está em
    // andamento, espera até ~2 s que ela termine. false: id desconhecido ou ligação não confirmada.
    bool SetHold(int callId, bool hold);

    // Microfone mudo ou não, para a ligação de agora e as próximas (até trocar de novo); na
    // conferência, para as duas.
    void SetMute(bool muted);

    // Manda os dígitos (0-9, *, #, A-D) pelo método DTMF do perfil: info por SIP INFO; rfc2833, auto
    // e inband por RFC 2833.
    bool SendDtmf(int callId, const std::string& digits);

    // Transfere (REFER) para sip:<número>@<domínio da conta> (com a porta, como em MakeCall). O resultado
    // chega por OnTransfer; quando o outro lado avisa que deu certo (NOTIFY com 2xx), o motor desliga a
    // ligação.
    bool Transfer(int callId, const std::string& number);

    // A transferência com consulta: REFER com Replaces na ligação callId (o cliente, normalmente em
    // espera) apontando para a ligação targetCallId (o colega, normalmente a ativa), para o outro lado
    // ligar um ao outro. O resultado chega por OnTransfer(callId, ...); com 2xx o motor desliga as duas.
    // false: id desconhecido, ligação não confirmada, ids iguais ou o PJSIP recusou (sem OnTransfer).
    bool TransferAttended(int callId, int targetCallId);

    // Quantas ligações há (tocando, chamando ou em andamento: 0, 1 ou 2), contando cada uma até ela
    // acabar no motor. A conta cai antes de o OnCallState(Disconnected) dela chegar ao listener (que vem
    // pela fila dos eventos): quem acompanha as ligações pelos eventos não usa o CallCount logo depois
    // de uma ação. HasCall é CallCount() > 0.
    int CallCount() const;
    bool HasCall() const;

    // Os dispositivos de som que o PJSIP enxerga, na ordem dele (o id é a posição na lista). Com nullAudio,
    // mais um no fim: o dispositivo nulo ("Null Audio", id -2). Vazio se o PJSIP falha ao listar.
    std::vector<AudioDevice> AudioDevices() const;

    // Escolhe o microfone e o alto-falante, para a ligação de agora e as próximas. -1 é o padrão do
    // sistema. Um id que não existe (ou que não serve para o papel: um alto-falante como microfone)
    // põe o padrão no lugar dele e devolve false; com os dois ids bons, devolve true. Com nullAudio o
    // motor fica no dispositivo nulo (só confere os ids). O mudo (SetMute) continua valendo.
    bool SetAudioDevices(int captureId, int playbackId);

    // Rele os dispositivos de som do sistema (um headset entrou ou saiu): o PJSIP guarda a lista da abertura, e os
    // ids dela ficam velhos. Como o MicroSIP: com o som aberto (uma ligacao), o motor passa ao dispositivo nulo,
    // rele e volta aos mesmos dispositivos pelo nome (o que saiu fica no padrao do sistema); sem o som aberto, so
    // rele e acerta os ids guardados. Os ids de AudioDevices mudam depois disto. Com nullAudio, so rele.
    void RefreshAudioDevices();

    // Para onde o áudio de callId vai na ponte de áudio, sem ordem: 0 é o dispositivo de som; outro
    // número, o id da outra ligação (na conferência: 0 e a outra). Vazio em espera, sem mídia ou com id
    // desconhecido. A ponte aplica as mudanças no tique seguinte do relógio dela (cerca de 20 ms).
    std::vector<int> AudioLinks(int callId) const;

private:
    class Impl;
    explicit SipEngine(std::unique_ptr<Impl> impl);

    std::unique_ptr<Impl> impl_;
};

}  // namespace starsonic
