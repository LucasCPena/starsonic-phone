#pragma once
// O nucleo do app de PC (spec da W1, secoes 6 e 7), em C++ portatil: junta o controlador de ligacoes, as lojas
// (contas, contatos, recentes e configuracoes), a migracao da rc.7 e o registro da conta, e conversa com a
// interface pelo protocolo da ponte (Protocol.h, docs/ponte-windows.md). O executavel do Windows so o hospeda: da
// a ele o motor (CallEngine e RegistrationPort), o disco, o cifrador, o relogio, o agendador e os ganchos (hooks).
//
// Concorrencia:
// - Uma thread de comandos (o Executor; o SerialExecutor quando nenhum e dado) faz tudo o que o DesktopApp decide:
//   os comandos da interface, o resultado do registro, a troca de conta, as lojas, o estado e as mensagens para a
//   interface. O estado do DesktopApp so e lido e escrito nela, sem trava; post e chamado so dela, uma vez por
//   mensagem, na ordem.
// - HandleCommand (na thread da interface) so le o JSON e poe o comando na fila; DialLink, RefreshAudioDevices e
//   Start tambem so poem na fila. Nada disso espera o motor.
// - Os comandos de ligacao chamam o controlador na thread de comandos: ele chama o motor na thread de quem chama
//   (o Dial espera o MakeCall, o Hold ate ~2 s), e os efeitos de comandos de threads diferentes nao teriam ordem
//   entre si. Com uma thread so, os comandos da interface chegam ao motor na ordem em que foram mandados (o
//   SetAccount, que espera ate ~5 s, tambem roda nela).
// - Os eventos de ligacao do motor (OnIncomingCall, OnRejectedBusy, OnCallState, OnTransfer) vao direto ao
//   controlador, na thread de eventos do motor (o controlador tem a trava dele). O OnRegistration vai para a fila.
// - Os avisos do controlador (o estado da ligacao, os Recentes, a perdida e o toque) chegam em qualquer thread (a do
//   motor, a de comandos ou a do agendador), na ordem dele, e vao para a fila na mesma ordem.
// - Os callbacks do WhenIdle (a troca de conta e o Entrar esperando o fim da ligacao) rodam na thread do motor, na
//   do agendador ou na de comandos: so poem a troca na fila (nunca a fazem ali, nem esperam um evento do motor).
//   Quando a troca roda, confere de novo se ainda nao ha ligacao (uma pode ter chegado no meio) e, se ha, espera o
//   fim dela.
// - As tarefas do agendador (o tempo do Entrar) so poem o trabalho na fila.
// - Corrida herdada (nao resolvida aqui): a volta sozinha da ligacao em espera (o Activate que o controlador pede
//   quando a ativa acaba) roda na thread de eventos do motor, depois de o controlador soltar a trava. Um comando da
//   thread de comandos (um Dial, um Swap) pode chegar ao motor entre a decisao e esse Activate. A thread de comandos
//   unica nao tira essa corrida (o outro lado e a thread do motor); ela vem do CallManager do Android e fica para o
//   controlador.
// - Sair (o comando quit): as ligacoes acabam (OnLogout do controlador, com os Recentes delas), e depois disso os
//   comandos sao ignorados. Uma troca de conta que esperava o fim da ligacao nao registra a conta (o app esta
//   saindo), mas fica gravada como a em uso no contas.json: a proxima abertura entra nela. Um Entrar que esperava o
//   fim da ligacao e descartado (a conta nunca registrou, entao nao e gravada).
// - O log (hooks.log) e chamado de qualquer thread (tambem do OnLog do motor, com travas do motor presas): ele nao
//   pode esperar a thread de comandos nem chamar o motor.
//
// Para fechar, nesta ordem: Shutdown() (a fila roda o que ja tinha e para); Stop() do agendador; o motor destruido
// (nenhum evento depois); o DesktopApp destruido; o agendador destruido. O motor, o disco, o cifrador, o relogio e
// o agendador precisam durar mais que o DesktopApp.
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "CallController.h"
#include "CallEngine.h"
#include "Cipher.h"
#include "Files.h"
#include "LegacyImport.h"
#include "LoginFlow.h"
#include "Profile.h"
#include "Protocol.h"
#include "SipEngine.h"
#include "Stores.h"
#include "Threads.h"

namespace starsonic {

// O registro da conta e os dispositivos de som do motor (o SipEngine de verdade, por um adaptador no executavel).
// Os contratos sao os do SipEngine: SetAccount devolve o id que o OnRegistration traz (0: nao ha conta) e espera
// ate ~5 s; SetAudioDevices com -1 e o padrao do Windows e devolve false se um id nao serve; RefreshAudioDevices
// rele a lista do sistema (os ids de AudioDevices mudam depois dele).
class RegistrationPort {
public:
    virtual ~RegistrationPort() = default;
    virtual int SetAccount(const AccountInput& input) = 0;
    virtual void RemoveAccount() = 0;
    virtual std::vector<AudioDevice> AudioDevices() = 0;
    virtual bool SetAudioDevices(int captureId, int playbackId) = 0;
    virtual void RefreshAudioDevices() = 0;
};

// Os arquivos (caminhos UTF-8): os quatro da pasta de dados (spec 6.6) e os da rc.7 (LegacyImport.h).
struct DesktopPaths {
    std::string accounts;   // contas.json
    std::string contacts;   // contatos.json
    std::string recents;    // recentes.json
    std::string settings;   // config.json
    LegacyPaths legacy;
};

struct DesktopConfig {
    DesktopPaths paths;
    Profile profile;                 // o perfil embutido (ParseProfile): o protocolo padrao, o ddi e o prefixo
    std::string version;             // a versao do app (versao, no estado)
    LegacyDecryptFunction decrypt;   // a senha da rc.7 (LegacyDecrypt); vazio: as contas migram sem senha
    // O Iniciar com o Windows que o executavel viu no registro na abertura (o valor do Run, e nao desligado no
    // Gerenciador de Tarefas). O registro vale mais que o config.json: na abertura, a configuracao passa a ser esta
    // (gravada no config.json e no estado), sem o gancho setStartWithWindows. Nada: vale o config.json.
    std::optional<bool> observedStartWithWindows;
};

// O que o executavel faz pelo DesktopApp. Todos chamados na thread de comandos, menos o log (ver acima). Um vazio
// nao faz nada.
struct DesktopHooks {
    std::function<void(const std::string& json)> post;   // uma mensagem para a interface (o postMessage)
    std::function<void(const std::string& line)> log;    // uma linha do diagnostico (sem senhas)
    std::function<void(const std::string& url)> openUrl;   // no navegador padrao (so os links permitidos)
    std::function<void()> minimize;
    std::function<void()> closeToTray;
    std::function<void()> quit;                          // depois do Sair: o executavel fecha (ver acima)
    std::function<void()> sendDiagnostics;
    std::function<void(bool on)> setStartWithWindows;    // o Iniciar com o Windows (HKCU\...\Run)
    std::function<void(bool now)> updateAnswer;          // a resposta a OfferUpdate (true: Atualizar agora)
};

// O app de PC. Responsavel por:
// - Entrar (spec do Windows 7.1 e 11.1): as validacoes do nucleo na ordem (servidor, ramal, senha), o registro com
//   ate 15 s pelo resultado, a conta gravada (e em uso) so depois de registrar, e as mensagens do RegistrationMessage.
//   Editar (contaId) com a senha vazia mantem a gravada. Uma conta sem senha (a migracao) abre a tela Entrar
//   preenchida, com "Digite a senha de novo para continuar.".
// - Contas: trocar (com uma ligacao, so no fim dela, com o aviso "A troca de conta fica para o fim da ligacao.";
//   o Entrar tambem espera; para uma conta sem a senha, a tela Entrar pede a senha dela com o Cancelar, e a em uso
//   continua registrada e gravada ate o Entrar registrar), remover (nao a em uso com uma ligacao; a em uso removida da a vez para a primeira das
//   outras, ou a tela Entrar sem nenhuma).
// - As ligacoes, pelo controlador; o Nao perturbe e o Atender automatico, gravados no config.json e repostos na
//   abertura; Recentes (e as perdidas desde a ultima visita a eles), contatos e configuracoes.
// - A abertura (Start): as lojas, a migracao da rc.7 e o registro da conta em uso.
// - DialLink (o link tel:): so poe o numero no Teclado, nunca liga.
class DesktopApp : public EngineListener {
public:
    // O tempo do Entrar (spec do Windows 7.1).
    static constexpr int64_t kLoginTimeoutMs = 15000;

    // executor: a fila de comandos (nullptr: um SerialExecutor; os testes dao uma que rodam na mao).
    DesktopApp(DesktopConfig config, DesktopHooks hooks, CallEngine& engine, RegistrationPort& port,
               FileSystem& files, SecretCipher& cipher, Clock& clock, Scheduler& scheduler,
               std::unique_ptr<Executor> executor = nullptr);
    // Shutdown(), e o tempo do Entrar sai do agendador.
    ~DesktopApp() override;

    DesktopApp(const DesktopApp&) = delete;
    DesktopApp& operator=(const DesktopApp&) = delete;

    // A abertura (uma vez): carrega as lojas, migra a rc.7, aplica as configuracoes e registra a conta em uso.
    void Start();
    // Um comando da interface (JSON do protocolo). Invalido: ignorado, com uma linha no diagnostico.
    void HandleCommand(const std::string& json);
    // O numero de um link tel:/sip:/callto: (ja lido): vai para o Teclado; nunca liga.
    void DialLink(const std::string& number);
    // Os dispositivos de som mudaram (um headset entrou ou saiu): o motor rele a lista do sistema
    // (RegistrationPort::RefreshAudioDevices), e a escolha gravada vale de novo pelo nome (a que saiu fica no padrao,
    // com "(desconectado)"; a que voltou, de novo em uso). So poe na fila.
    void RefreshAudioDevices();
    // A janela foi movida (o canto de cima, em pixels da tela): grava no config.json (so se mudou). Antes da abertura
    // (Start), nada. So poe na fila.
    void SaveWindowPosition(int x, int y);
    // O atualizador achou uma versao nova: a interface pergunta ({"type":"update"}, de novo a cada ready ate a
    // resposta), e a resposta (updateNow/updateLater) vai uma vez ao hooks.updateAnswer. Uma pergunta nova toma o
    // lugar da que estava aberta. Saindo (quit), a aberta vale "Depois". So poe na fila.
    void OfferUpdate(const std::string& version, const std::string& notes);
    // Um aviso de 2 s do executavel (o toast: "Termine a chamada para atualizar."). So poe na fila.
    void Notify(const std::string& text);
    // A fila de comandos roda o que ja tinha e para; daqui em diante nada mais entra. Nunca de dentro de um gancho.
    void Shutdown();

    // EngineListener: os eventos do motor (o executavel os repassa, ou da o DesktopApp ao motor como o listener).
    void OnRegistration(int sipCode, bool active, int accountId) override;
    void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) override;
    void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) override;
    void OnCallState(int callId, CallState state, int sipCode) override;
    void OnTransfer(int callId, int sipCode) override;
    void OnLog(int level, const std::string& line) override;

private:
    class Names;
    class Listener;
    struct LoginRequest {
        std::string accountId;   // "" = conta nova
        AccountInput input;
        std::wstring name;
    };
    // Uma troca de conta (switchTo) ou um Entrar (login) esperando o fim da ligacao.
    struct PendingChange {
        int token = 0;
        std::string switchTo;
        std::optional<LoginRequest> login;
    };

    // Na thread de comandos (todas abaixo).
    void Post(std::function<void()> task);
    void Execute(const Command& command);
    void Initialize();
    void HandleLogin(const Command& command);
    void StartLogin(const LoginRequest& request);
    void ApplyLogin(const LoginOutcome& outcome);
    void HandleRegistration(int sipCode, bool active, int accountId);
    void SelectAccount(const std::string& id);
    void RemoveAccount(const std::string& id);
    void SwitchTo(const std::string& id);
    void CancelPasswordSwitch();
    void ActivateStored(const SavedAccount& account);
    // keepEngine: a conta registrada continua no motor (a troca para uma conta sem a senha).
    void ShowPasswordRequest(const SavedAccount& account, bool keepEngine);
    void DropEngineAccount();
    void ResetLogin();
    void WhenIdle(PendingChange change);
    void RunPending(int token);
    void Quit();
    void ApplyAudio();
    void SaveSettings(const Settings& settings);
    void OpenExternal(const std::string& url);
    void PublishState(bool force);
    BridgeState BuildState() const;
    void Toast(const std::string& text);
    void Log(const std::string& line) const;

    DesktopConfig config_;
    DesktopHooks hooks_;
    RegistrationPort& port_;
    FileSystem& files_;
    Clock& clock_;
    Scheduler& scheduler_;

    AccountsStore accounts_;
    ContactsStore contacts_;
    RecentsStore recents_;
    SettingsStore settings_;

    std::unique_ptr<Names> names_;
    std::unique_ptr<Listener> listener_;
    std::atomic<bool> registered_{false};   // lido pelo controlador (o Dial), escrito na thread de comandos
    std::unique_ptr<CallController> controller_;

    // O estado (so na thread de comandos).
    bool started_ = false;
    bool quitting_ = false;
    LoginView login_;
    LoginFlow flow_;
    std::optional<LoginRequest> loginRequest_;   // o Entrar esperando o registro
    int loginTimer_ = 0;                          // a tarefa do agendador do tempo do Entrar (0: nenhuma)
    int loginToken_ = 0;
    int engineAccountId_ = 0;       // o id do motor da conta registrada agora (0: nenhuma)
    std::string engineStoreId_;     // a conta da loja registrada agora ("" com o Entrar ou sem conta)
    std::optional<int> registration_;   // o ultimo codigo do registro da conta de agora (nenhum: esperando)
    std::optional<PendingChange> pending_;
    int pendingToken_ = 0;
    // A troca para uma conta sem a senha: a tela Entrar pede a senha dela (com o Cancelar), e a em uso continua
    // registrada e gravada ate o Entrar registrar ("" nenhuma).
    std::string passwordSwitch_;
    CallSnapshot call_;
    std::string lastEndMessage_;
    RingKind ring_ = RingKind::Stop;
    int64_t recentsSeenMs_ = 0;
    AudioView audio_;
    std::string keypad_;
    int keypadSeq_ = 0;
    std::string lastState_;
    struct UpdateOffer {
        std::string version;
        std::string notes;
    };
    std::optional<UpdateOffer> updateOffer_;   // a pergunta da atualizacao, esperando a resposta

    std::unique_ptr<Executor> executor_;   // por ultimo: parado primeiro (no destrutor)
};

}  // namespace starsonic
