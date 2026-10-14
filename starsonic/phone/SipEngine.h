#pragma once
// Motor de ligações sobre o PJSIP 2.17 (pjsua2), spec 6.2: monta a conta do perfil, registra e avisa
// os eventos por EngineListener. Sem nada de Android; este cabeçalho também não inclui o PJSIP.
#include <memory>
#include <string>
#include <vector>

#include "Profile.h"

namespace starsonic {

enum class CallState { Incoming = 0, Calling = 1, Early = 2, Connecting = 3, Confirmed = 4, Disconnected = 5 };

// Os eventos chegam em threads do PJSIP e, às vezes, na própria thread que chamou o motor, dentro da
// chamada (Create, SetAccount, Reregister, HandleIpChange, RemoveAccount e ~SipEngine). O motor segura
// travas internas enquanto avisa: nenhum método daqui pode chamar o motor de volta. A implementação
// precisa durar mais que o motor (o destrutor ainda manda linhas de log).
class EngineListener {
public:
    virtual ~EngineListener() {}

    // Cada resposta do registro: o código SIP e se a conta ficou registrada. (200, true) = registrou
    // ou renovou; (200, false) = a conta saiu (RemoveAccount); 4xx a 6xx = falhou; sem resposta do
    // servidor, 503 (conexão recusada ou rede fora) ou 408 (tempo esgotado).
    virtual void OnRegistration(int sipCode, bool active) = 0;
    virtual void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) = 0;
    virtual void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) = 0;
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
    Transport transport;
    std::wstring ramal;       // já validado (ValidateRamal)
    std::wstring senha;
};

// Todo método público registra a thread que chama no PJLIB antes de usar o PJSIP, então pode ser
// chamado de qualquer thread. Chamadas ao mesmo tempo esperam uma pela outra.
class SipEngine {
public:
    // O pjsua tem estado global: só um motor por processo (um segundo Create devolve nullptr até o
    // primeiro ser destruído). Em caso de erro devolve nullptr e escreve o motivo em *error (se não
    // for nullptr). Com stun= no perfil o pjsua testa os servidores aqui dentro, como no MicroSIP: cada
    // um que não responde atrasa o Create em cerca de 8 s antes de ser ignorado (chame fora da thread
    // principal).
    static std::unique_ptr<SipEngine> Create(const EngineConfig& config, EngineListener* listener, std::string* error);

    // Desregistra a conta (sem avisar o listener) e destrói o pjsua; demora cerca de 1 s.
    ~SipEngine();

    SipEngine(const SipEngine&) = delete;
    SipEngine& operator=(const SipEngine&) = delete;

    // Troca a conta e registra; o resultado chega por OnRegistration. A conta anterior sai do
    // servidor sem aviso ao listener. false: dados vazios ou o PJSIP recusou a conta (não há conta).
    // Espera até ~3 s pela saída da conta anterior.
    bool SetAccount(const AccountInput& input);

    // Retira o registro e apaga a conta; o servidor responde por OnRegistration(200, false). Espera
    // até ~3 s por essa resposta.
    void RemoveAccount();

    // Renova o registro agora.
    void Reregister();

    // A rede mudou: refaz os transportes e renova o registro (o resultado chega por OnRegistration).
    // O pjsua, com a reescrita do Contact desligada, não refaz o registro sozinho no UDP e só o faz
    // depois de 0 a 10 s no TCP; por isso o motor espera os transportes (até ~2 s) e registra de novo.
    void HandleIpChange();

    // Os codecs ligados (prioridade acima de zero), do mais para o menos preferido.
    std::vector<std::string> ActiveCodecs() const;

private:
    class Impl;
    explicit SipEngine(std::unique_ptr<Impl> impl);

    std::unique_ptr<Impl> impl_;
};

}  // namespace starsonic
