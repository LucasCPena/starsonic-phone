#include "DesktopApp.h"

#include <algorithm>
#include <exception>
#include <unordered_map>
#include <utility>

#include "AccountPolicy.h"
#include "CallMessages.h"
#include "RegistrationErrors.h"
#include "Text.h"
#include "branding.h"   // os links do Sobre (STARSONIC_URL_SITE, STARSONIC_URL_SUPPORT, STARSONIC_REPO_URL)

namespace starsonic {

namespace {

const wchar_t kSwitchNotice[] = L"A troca de conta fica para o fim da liga\u00e7\u00e3o.";
const wchar_t kPasswordAgain[] = L"Digite a senha de novo para continuar.";
const wchar_t kEmptyPassword[] = L"Digite a senha.";
const wchar_t kConnecting[] = L"Conectando\u2026";
const wchar_t kConnected[] = L"Conectado \u00b7 ";
const char kWrongAdminPassword[] = "Senha incorreta.";

std::string U8(const std::wstring& text) { return WideToUtf8(text); }
std::wstring Wide(const std::string& text) { return Utf8ToWide(text); }

std::string TransportName(Transport transport) { return transport == Transport::Tcp ? "tcp" : "udp"; }

std::string NormalizedNumber(const std::string& number) { return U8(NormalizeDialString(Wide(number))); }

// Os unicos links que a interface pode abrir fora do app (os do Sobre). O tel: fica de fora: o app e o tratador dele
// (o instalador o registra), e o link so encheria o Teclado.
bool AllowedUrl(const std::string& url) {
    static const char* const kAllowed[] = {"https://starsonic.com.br", STARSONIC_URL_SITE, STARSONIC_URL_SUPPORT,
                                           STARSONIC_REPO_URL};
    for (const char* allowed : kAllowed) {
        if (url == allowed) return true;
    }
    return false;
}

std::optional<SavedAccount> FindAccount(const AccountsStore& store, const std::string& id) {
    if (id.empty()) return std::nullopt;
    for (const SavedAccount& account : store.All()) {
        if (account.id == id) return account;
    }
    return std::nullopt;
}

AccountInput InputOf(const SavedAccount& account) {
    AccountInput input;
    input.address = account.address;
    input.transport = account.transport;
    input.ramal = account.ramal;
    input.senha = account.senha;
    return input;
}

AccountView ViewOf(const SavedAccount& account) {
    AccountView view;
    view.id = account.id;
    view.name = U8(account.name);
    view.ramal = U8(account.ramal);
    view.server = U8(account.address);
    view.transport = TransportName(account.transport);
    return view;
}

std::optional<std::wstring> NoDecrypt(const std::wstring&) { return std::nullopt; }

const char* ActionName(Atalho::Acao action) {
    switch (action) {
        case Atalho::Transferir:
            return "transferir";
        case Atalho::Consulta:
            return "consulta";
        case Atalho::Teclas:
            return "teclas";
        case Atalho::Ligar:
            break;
    }
    return "ligar";
}

Atalho::Acao ActionOf(const std::string& name) {
    if (name == "transferir") return Atalho::Transferir;
    if (name == "consulta") return Atalho::Consulta;
    if (name == "teclas") return Atalho::Teclas;
    return Atalho::Ligar;   // o Protocol so deixa passar as quatro
}

const char* BlfName(BlfState state) {
    switch (state) {
        case BlfState::Free:
            return "livre";
        case BlfState::Ringing:
            return "tocando";
        case BlfState::Busy:
            return "ocupado";
        case BlfState::Unknown:
            break;
    }
    return "desconectado";
}

template <typename Value>
const Value* FindIn(const std::vector<std::pair<std::string, Value>>& list, const std::string& key) {
    for (const auto& entry : list) {
        if (entry.first == key) return &entry.second;
    }
    return nullptr;
}

AccountProfile WithServers(AccountProfile profile, const std::vector<ServerPort>& servers) {
    profile.serverPorts = servers;
    return profile;
}

}  // namespace

// Os nomes dos contatos para o controlador (o ContactsStore tem a trava dele: qualquer thread).
class DesktopApp::Names : public ContactNames {
public:
    explicit Names(ContactsStore& contacts) : contacts_(contacts) {}
    std::optional<std::string> NameFor(const std::string& number) override {
        const std::wstring name = contacts_.NameFor(number);
        if (name.empty()) return std::nullopt;
        return U8(name);
    }

private:
    ContactsStore& contacts_;
};

// Os avisos do controlador (em qualquer thread, na ordem dele) vao para a fila de comandos, na mesma ordem.
class DesktopApp::Listener : public CallControllerListener {
public:
    explicit Listener(DesktopApp& app) : app_(app) {}

    void OnSnapshot(const CallSnapshot& snapshot) override {
        DesktopApp& app = app_;
        app.Post([&app, snapshot] {
            // O bipe do fim (spec 5): a ultima ligacao acabou e uma das que acabaram foi atendida (uma vez, tambem
            // quando duas acabam juntas). Nao para a recusada, a perdida e a que nao completou (sem activeSinceMs).
            const CallSnapshot& before = app.call_;
            const bool answeredEnded = !snapshot.top && ((before.top && before.top->activeSinceMs > 0) ||
                                                         (before.second && before.second->activeSinceMs > 0));
            app.call_ = snapshot;
            // O aviso de 2 s (o fim de uma feita, "<nome> desligou", sem conexao, a transferencia recusada) vai como
            // toast quando aparece.
            if (!snapshot.endMessage.empty() && snapshot.endMessage != app.lastEndMessage_) {
                app.Toast(snapshot.endMessage);
            }
            app.lastEndMessage_ = snapshot.endMessage;
            if (answeredEnded && !app.quitting_ && app.settings_.Get().bipeFim && app.hooks_.post) {
                app.hooks_.post(EndBeepMessage());
            }
        });
    }
    void OnRecent(const Recent& recent) override {
        DesktopApp& app = app_;
        app.Post([&app, recent] {
            if (!app.recents_.Add(recent)) app.Log("recentes.json: a ligacao nao foi gravada no disco");
        });
    }
    void OnMissed(const std::string& text) override {
        DesktopApp& app = app_;
        app.Post([&app, text] { app.Toast(text); });
    }
    void OnRing(RingKind kind) override {
        DesktopApp& app = app_;
        app.Post([&app, kind] {
            app.ring_ = kind;
            if (app.hooks_.post) app.hooks_.post(RingMessage(kind));
        });
    }

private:
    DesktopApp& app_;
};

DesktopApp::DesktopApp(DesktopConfig config, DesktopHooks hooks, CallEngine& engine, RegistrationPort& port,
                       FileSystem& files, SecretCipher& cipher, Clock& clock, Scheduler& scheduler,
                       std::unique_ptr<Executor> executor)
    : config_(std::move(config)),
      hooks_(std::move(hooks)),
      port_(port),
      files_(files),
      clock_(clock),
      scheduler_(scheduler),
      accounts_(files, cipher, config_.paths.accounts),
      contacts_(files, config_.paths.contacts),
      recents_(files, config_.paths.recents),
      settings_(files, config_.paths.settings),
      names_(new Names(contacts_)),
      listener_(new Listener(*this)),
      atalhos_(files, config_.paths.atalhos),
      admin_(files, cipher, config_.paths.admin, config_.profile) {
    controller_.reset(new CallController(
        engine, *listener_, clock, scheduler, *names_,
        [this](std::string number) { return DialRule(number); },
        [this] { return registered_.load(); }));
    executor_ = executor ? std::move(executor) : std::unique_ptr<Executor>(new SerialExecutor());
    ResetLogin();
}

DesktopApp::~DesktopApp() {
    Shutdown();
    if (loginTimer_ != 0) scheduler_.Cancel(loginTimer_);
    if (adminTimer_ != 0) scheduler_.Cancel(adminTimer_);
}

void DesktopApp::Start() {
    Post([this] { Initialize(); });
}

void DesktopApp::HandleCommand(const std::string& json) {
    std::string error;
    std::optional<Command> command = ParseCommand(json, &error);
    if (!command) {
        Log("comando ignorado: " + error);
        return;
    }
    Post([this, parsed = std::move(*command)] { Execute(parsed); });
}

void DesktopApp::DialLink(const std::string& number) {
    Post([this, number] {
        keypad_ = U8(Trim(Wide(number)));
        ++keypadSeq_;
        Log("link recebido");
    });
}

void DesktopApp::RefreshAudioDevices() {
    Post([this] {
        Log("som: os dispositivos foram relidos");
        ApplyAudio();
    });
}

void DesktopApp::SaveWindowPosition(int x, int y) {
    Post([this, x, y] {
        if (!started_) return;   // as configuracoes ainda nao foram lidas: gravar agora apagaria as do disco
        Settings settings = settings_.Get();
        if (settings.windowX == x && settings.windowY == y) return;
        settings.windowX = x;
        settings.windowY = y;
        SaveSettings(settings);
    });
}

void DesktopApp::SaveWindowSize(int width, int height) {
    Post([this, width, height] {
        if (!started_ || width <= 0 || height <= 0) return;
        Settings settings = settings_.Get();
        if (settings.windowW == width && settings.windowH == height) return;
        settings.windowW = width;
        settings.windowH = height;
        SaveSettings(settings);
    });
}

void DesktopApp::OfferUpdate(const std::string& version, const std::string& notes) {
    Post([this, version, notes] {
        if (quitting_) {
            if (hooks_.updateAnswer) hooks_.updateAnswer(false);
            return;
        }
        updateOffer_ = UpdateOffer{version, notes};
        Log("atualizacao: a versao " + version + " foi oferecida");
        if (hooks_.post) hooks_.post(UpdateMessage(version, notes));
    });
}

void DesktopApp::Notify(const std::string& text) {
    Post([this, text] { Toast(text); });
}

void DesktopApp::SetInternet(bool available) {
    Post([this, available] { HandleInternet(available); });
}

void DesktopApp::Shutdown() {
    executor_->Stop();
}

void DesktopApp::OnRegistration(int sipCode, bool active, int accountId) {
    Post([this, sipCode, active, accountId] { HandleRegistration(sipCode, active, accountId); });
}

void DesktopApp::OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) {
    controller_->OnIncomingCall(callId, remoteUser, remoteName);
}

void DesktopApp::OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) {
    controller_->OnRejectedBusy(remoteUser, remoteName);
}

void DesktopApp::OnCallState(int callId, CallState state, int sipCode) {
    controller_->OnCallState(callId, state, sipCode);
}

void DesktopApp::OnTransfer(int callId, int sipCode) {
    controller_->OnTransfer(callId, sipCode);
}

void DesktopApp::OnBlf(const std::string& number, BlfState state) {
    // A vez das assinaturas de agora (na thread do motor): HandleBlf descarta o aviso de uma assinatura mais velha.
    const int64_t generation = blfGeneration_.load();
    Post([this, generation, number, state] { HandleBlf(generation, number, state); });
}

void DesktopApp::OnLog(int level, const std::string& line) {
    Log("motor " + std::to_string(level) + ": " + line);
}

// Em qualquer thread: a tarefa vai para a fila de comandos; depois dela, o estado sai se mudou.
void DesktopApp::Post(std::function<void()> task) {
    const bool queued = executor_->Post([this, task = std::move(task)] {
        try {
            task();
        } catch (const std::exception& error) {
            Log(std::string("erro na thread de comandos: ") + error.what());
        } catch (...) {
            Log("erro na thread de comandos");
        }
        UpdateBlf();
        PublishState(/*force=*/false);
    });
    if (!queued) Log("tarefa descartada: a fila de comandos ja parou");
}

void DesktopApp::Execute(const Command& command) {
    if (quitting_ && command.kind != CommandKind::Ready) {
        Log(std::string("comando ignorado depois do Sair: ") + CommandName(command.kind));
        return;
    }
    // Qualquer comando com a area do administrador aberta recomeca os 10 min (o ready e a pagina que recarregou).
    if (adminOpen_ && command.kind != CommandKind::Ready) TouchAdmin();
    switch (command.kind) {
        case CommandKind::Ready:
            Log("interface pronta");
            PublishState(/*force=*/true);
            if (hooks_.post) hooks_.post(RingMessage(ring_));
            if (updateOffer_ && hooks_.post) hooks_.post(UpdateMessage(updateOffer_->version, updateOffer_->notes));
            break;
        case CommandKind::Login:
            HandleLogin(command);
            break;
        case CommandKind::SelectAccount:
            SelectAccount(command.accountId);
            break;
        case CommandKind::RemoveAccount:
            RemoveAccount(command.accountId);
            break;
        case CommandKind::Dial:
            if (command.contact) {
                controller_->DialContact(command.number);
            } else {
                controller_->Dial(command.number);
            }
            break;
        case CommandKind::Answer:
            controller_->Answer();
            break;
        case CommandKind::Reject:
            controller_->Reject();
            break;
        case CommandKind::Hangup:
            if (command.callId) {
                controller_->Hangup(*command.callId);   // o cartao com id, ou 0: a feita ainda sem id
            } else {
                controller_->Hangup();
            }
            break;
        case CommandKind::Hold:
            controller_->Hold(command.on);
            break;
        case CommandKind::Mute:
            controller_->Mute(command.on);
            break;
        case CommandKind::Dtmf:
            controller_->Dtmf(command.digits);
            break;
        case CommandKind::Transfer:
            controller_->Transfer(command.number);
            break;
        case CommandKind::Consult:
            controller_->Consult(command.number);
            break;
        case CommandKind::CompleteTransfer:
            controller_->CompleteTransfer();
            break;
        case CommandKind::CancelConsult:
            controller_->CancelConsult();
            break;
        case CommandKind::Swap:
            controller_->Swap();
            break;
        case CommandKind::Join:
            controller_->Join();
            break;
        case CommandKind::Split:
            controller_->Split();
            break;
        case CommandKind::SetDnd: {
            if (command.on.value_or(false) && !admin_.Get().mostrarNaoPerturbe) {
                Log("setDnd recusado: o administrador escondeu o Nao perturbe");
                break;
            }
            Settings settings = settings_.Get();
            settings.doNotDisturb = command.on.value_or(false);
            controller_->SetDoNotDisturb(settings.doNotDisturb);
            SaveSettings(settings);
            break;
        }
        case CommandKind::SetAutoAnswer: {
            if (command.on.value_or(false) && !admin_.Get().mostrarAtenderAuto) {
                Log("setAutoAnswer recusado: o administrador escondeu o Atender automatico");
                break;
            }
            Settings settings = settings_.Get();
            settings.autoAnswer = command.on.value_or(false);
            if (command.seconds) {
                settings.autoAnswerSeconds = std::min(*command.seconds, SettingsStore::kMaxAutoAnswerSeconds);
            }
            controller_->SetAutoAnswer(settings.autoAnswer, settings.autoAnswerSeconds * 1000);
            SaveSettings(settings);
            break;
        }
        case CommandKind::SaveContact: {
            Contact contact;
            contact.id = command.contactId;
            contact.name = Wide(command.name);
            contact.number = command.number;
            contact.note = Wide(command.note);
            if (!contacts_.Save(contact)) Log("saveContact: o contato nao foi gravado (sem nome, sem numero ou o disco)");
            break;
        }
        case CommandKind::RemoveContact:
            if (!contacts_.Remove(command.contactId)) Log("removeContact: o contato nao foi removido");
            break;
        case CommandKind::SetAudio: {
            Settings settings = settings_.Get();
            if (command.capture) settings.captureName = *command.capture;
            if (command.playback) settings.playbackName = *command.playback;
            if (command.ring) settings.ringDeviceId = *command.ring;
            SaveSettings(settings);
            ApplyAudio();
            break;
        }
        case CommandKind::SetSetting: {
            // So as chaves iniciarComWindows e bipeFim chegam aqui (ParseCommand).
            Settings settings = settings_.Get();
            if (command.key == "bipeFim") {
                settings.bipeFim = command.value;
                SaveSettings(settings);
                break;
            }
            settings.startWithWindows = command.value;
            SaveSettings(settings);
            if (hooks_.setStartWithWindows) hooks_.setStartWithWindows(command.value);
            break;
        }
        case CommandKind::OpenExternal:
            OpenExternal(command.url);
            break;
        case CommandKind::SendDiagnostics:
            if (hooks_.sendDiagnostics) hooks_.sendDiagnostics();
            break;
        case CommandKind::Minimize:
            if (hooks_.minimize) hooks_.minimize();
            break;
        case CommandKind::CloseToTray:
            if (adminOpen_) CloseAdmin("a janela fechou");
            if (hooks_.closeToTray) hooks_.closeToTray();
            break;
        case CommandKind::Resize:
            if (hooks_.resize) hooks_.resize(command.edge);
            break;
        case CommandKind::Quit:
            Quit();
            break;
        case CommandKind::ViewRecents:
            recentsSeenMs_ = clock_.NowMs();
            break;
        case CommandKind::UpdateNow:
        case CommandKind::UpdateLater: {
            if (!updateOffer_) {
                Log(std::string(CommandName(command.kind)) + " ignorado: nenhuma pergunta de atualizacao aberta");
                break;
            }
            const bool now = command.kind == CommandKind::UpdateNow;
            Log(std::string("atualizacao: ") + (now ? "atualizar agora" : "depois"));
            updateOffer_.reset();
            if (hooks_.updateAnswer) hooks_.updateAnswer(now);
            break;
        }
        case CommandKind::CancelLogin:
            CancelPasswordSwitch();
            break;
        case CommandKind::SaveShortcut:
            SaveShortcut(command);
            break;
        case CommandKind::RemoveShortcut:
            if (!atalhos_.Remove(command.shortcutId)) Log("removeShortcut: o atalho nao foi removido");
            break;
        case CommandKind::UseShortcut:
            UseShortcut(command.shortcutId);
            break;
        case CommandKind::AdminLogin:
            AdminLogin(command.password);
            break;
        case CommandKind::AdminLogout:
            if (adminOpen_) CloseAdmin("sair da area do administrador");
            break;
        case CommandKind::AdminSet:
            AdminSet(command.admin);
            break;
    }
}

// A abertura: as lojas, a migracao da rc.7, as configuracoes e a conta em uso.
void DesktopApp::Initialize() {
    if (started_) return;
    started_ = true;
    if (!accounts_.Load()) Log("contas.json ilegivel: lido como vazio (o arquivo fica ate a proxima gravacao)");
    if (!contacts_.Load()) Log("contatos.json ilegivel: lido como vazio");
    if (!recents_.Load()) Log("recentes.json ilegivel: lido como vazio");
    if (!settings_.Load()) Log("config.json ilegivel: valem os padroes");
    if (!atalhos_.Load()) Log("atalhos.json ilegivel: lido como vazio");
    if (!admin_.Load()) Log("admin.json ilegivel: valem os padroes");

    const LegacyImportResult imported = ImportLegacy(config_.paths.legacy, config_.decrypt ? config_.decrypt : NoDecrypt,
                                                     accounts_, contacts_, recents_, files_);
    if (imported.accounts > 0) {
        Log("migracao da rc.7: " + std::to_string(imported.accounts) + " conta(s), " +
            std::to_string(imported.accountsWithoutPassword) + " sem a senha");
    }
    const std::vector<std::string> pending = accounts_.PendingMigration();
    if (!pending.empty()) {
        std::string what;
        for (const std::string& item : pending) what += (what.empty() ? "" : "/") + item;
        // O LegacyImport nao diz por que (arquivo travado pela rc.7 aberta, ou estragado): tenta de novo na proxima.
        Log("migracao da rc.7: " + what + " pendentes (a proxima abertura tenta de novo)");
    }

    // O registro vale mais que o config.json (o Run sem o valor, ou desligado no Gerenciador de Tarefas: o app nao
    // abre com o Windows, e a chave nao pode mostrar ligado).
    if (config_.observedStartWithWindows && settings_.Get().startWithWindows != *config_.observedStartWithWindows) {
        Settings observed = settings_.Get();
        observed.startWithWindows = *config_.observedStartWithWindows;
        Log(std::string("iniciar com o Windows: o registro diz ") + (observed.startWithWindows ? "ligado" : "desligado"));
        SaveSettings(observed);
    }

    ApplyAdminLimits();
    const Settings settings = settings_.Get();
    controller_->SetDoNotDisturb(settings.doNotDisturb);
    controller_->SetAutoAnswer(settings.autoAnswer, settings.autoAnswerSeconds * 1000);
    if (hooks_.updateChannel) hooks_.updateChannel(admin_.Get().canal);
    recentsSeenMs_ = clock_.NowMs();
    ApplyAudio();

    const std::optional<SavedAccount> active = accounts_.Active();
    if (active) ActivateStored(*active);
}

// Entrar (spec do Windows 7.1): as validacoes na ordem, e a conta registra (no fim da ligacao, se ha uma).
void DesktopApp::HandleLogin(const Command& command) {
    if (loginRequest_ || (pending_ && pending_->login)) {
        Log("login ignorado: outro Entrar ainda espera o resultado");
        return;
    }
    std::optional<SavedAccount> existing = FindAccount(accounts_, command.accountId);
    if (!command.accountId.empty() && !existing) Log("login: a conta editada nao existe mais (vale como nova)");
    login_.server = command.server;
    login_.transport = command.transport;
    login_.ramal = command.ramal;
    login_.name = command.name;
    login_.accountId = existing ? existing->id : std::string();
    login_.needsPassword = existing && existing->needsPassword;
    login_.busy = false;
    login_.error.clear();

    std::wstring address;
    const ServerCheck server = ValidateServerAddress(Wide(command.server), &address);
    if (server != ServerCheck::Ok) {
        login_.error = U8(ServerCheckMessage(server));
        return;
    }
    std::wstring ramal;
    const RamalCheck ramalCheck = ValidateRamal(Wide(command.ramal), &ramal);
    if (ramalCheck != RamalCheck::Ok) {
        login_.error = U8(RamalCheckMessage(ramalCheck));
        return;
    }
    std::wstring senha = Wide(command.password);
    if (senha.empty()) {
        // Editar com a senha vazia mantem a gravada (spec da W1, 7.3); sem uma gravada, ela e obrigatoria.
        if (!existing || existing->needsPassword) {
            login_.error = U8(kEmptyPassword);
            return;
        }
        senha = existing->senha;
    }
    LoginRequest request;
    request.accountId = login_.accountId;
    request.input.address = address;
    request.input.transport = command.transport == "tcp" ? Transport::Tcp : Transport::Udp;
    request.input.ramal = ramal;
    request.input.senha = senha;
    request.name = NormalizeAccountName(Wide(command.name));
    login_.busy = true;
    PendingChange change;
    change.login = request;
    WhenIdle(std::move(change));
}

void DesktopApp::StartLogin(const LoginRequest& request) {
    flow_ = LoginFlow();
    flow_.Start();
    loginRequest_ = request;
    login_.busy = true;
    registered_ = false;
    const int id = RegisterInEngine(request.input);
    engineAccountId_ = id;
    engineStoreId_.clear();
    registration_.reset();
    if (id == 0) {
        Log("login: o motor recusou a conta");
        ApplyLogin(flow_.OnRegistration(0, false));
        return;
    }
    const int token = ++loginToken_;
    loginTimer_ = scheduler_.Schedule(kLoginTimeoutMs, [this, token] {
        Post([this, token] {
            if (token != loginToken_ || !loginRequest_) return;
            loginTimer_ = 0;
            ApplyLogin(flow_.OnTimeout());
        });
    });
}

void DesktopApp::ApplyLogin(const LoginOutcome& outcome) {
    if ((!outcome.commit && !outcome.rollback) || !loginRequest_) return;
    if (loginTimer_ != 0) scheduler_.Cancel(loginTimer_);
    loginTimer_ = 0;
    ++loginToken_;
    const LoginRequest request = *loginRequest_;
    loginRequest_.reset();
    if (outcome.commit) {
        SavedAccount account;
        account.id = request.accountId;
        account.address = request.input.address;
        account.transport = request.input.transport;
        account.ramal = request.input.ramal;
        account.senha = request.input.senha;
        account.name = request.name;
        std::string id;
        if (accounts_.Save(account)) {
            id = accounts_.LastSavedId();
            if (!accounts_.SetActive(id)) Log("contas.json: a conta em uso nao foi gravada");
        } else {
            Log("contas.json: a conta nao foi gravada (fica so nesta abertura)");
        }
        engineStoreId_ = id;
        registration_ = 200;
        registered_ = true;
        blfForce_ = true;
        passwordSwitch_.clear();
        if (reRegister_) ScheduleReRegister();   // a lista do administrador mudou enquanto o Entrar esperava
        ResetLogin();
        return;
    }
    // Falhou: a mensagem fica na tela Entrar (com o que foi digitado), e a conta de antes volta.
    login_.busy = false;
    login_.error = U8(outcome.message);
    const std::optional<SavedAccount> previous = accounts_.Active();
    if (previous && !previous->needsPassword) {
        ActivateStored(*previous);
    } else {
        DropEngineAccount();
    }
}

void DesktopApp::HandleRegistration(int sipCode, bool active, int accountId) {
    if (accountId == 0 || accountId != engineAccountId_) return;   // de uma conta que ja saiu
    if (sipCode >= 200 && sipCode <= 299 && !active) return;       // a saida da conta, nao um registro
    if (loginRequest_) {
        ApplyLogin(flow_.OnRegistration(sipCode, false));
        return;
    }
    const bool was = registered_;
    registration_ = sipCode;
    registered_ = sipCode >= 200 && sipCode <= 299;
    if (registered_ && !was) blfForce_ = true;   // registrou de novo: o BLF tambem (UpdateBlf)
}

void DesktopApp::SelectAccount(const std::string& id) {
    if (loginRequest_ || (pending_ && pending_->login)) {
        Log("selectAccount ignorado: um Entrar espera o resultado");
        return;
    }
    if (!FindAccount(accounts_, id)) {
        Log("selectAccount: a conta nao existe");
        return;
    }
    const std::optional<SavedAccount> active = accounts_.Active();
    if (active && active->id == id && engineStoreId_ == id) {
        pending_.reset();   // ja e ela: uma troca que esperava o fim da ligacao sai
        if (!passwordSwitch_.empty()) {
            passwordSwitch_.clear();   // e a que pedia a senha tambem
            ResetLogin();
        }
        return;
    }
    PendingChange change;
    change.switchTo = id;
    WhenIdle(std::move(change));
}

void DesktopApp::RemoveAccount(const std::string& id) {
    if (loginRequest_) {
        Log("removeAccount ignorado: um Entrar espera o resultado");
        return;
    }
    if (!FindAccount(accounts_, id)) {
        Log("removeAccount: a conta nao existe");
        return;
    }
    const std::optional<SavedAccount> active = accounts_.Active();
    const bool wasActive = active && active->id == id;
    if (wasActive && controller_->HasCalls()) {
        Log("removeAccount recusado: a conta em uso tem uma ligacao");
        return;
    }
    if (pending_ && (pending_->switchTo == id || (pending_->login && pending_->login->accountId == id))) {
        if (pending_->login) login_.busy = false;
        pending_.reset();
    }
    if (!passwordSwitch_.empty() && (passwordSwitch_ == id || wasActive)) {
        passwordSwitch_.clear();
        ResetLogin();
    }
    if (!accounts_.Remove(id)) {
        Log("contas.json: a conta nao foi removida");
        return;
    }
    if (!wasActive) return;
    DropEngineAccount();
    const std::vector<SavedAccount> rest = accounts_.All();
    if (rest.empty()) {
        ResetLogin();
        return;
    }
    SwitchTo(rest.front().id);
}

void DesktopApp::SwitchTo(const std::string& id) {
    const std::optional<SavedAccount> target = FindAccount(accounts_, id);
    if (!target) return;
    const std::optional<SavedAccount> current = accounts_.Active();
    if (target->needsPassword && current && current->id != id && !current->needsPassword) {
        // Sem a senha da escolhida, a em uso continua (registrada e gravada) ate o Entrar dela registrar; a tela
        // Entrar pede a senha com o Cancelar, que volta para a em uso.
        passwordSwitch_ = id;
        ShowPasswordRequest(*target, /*keepEngine=*/true);
        Log("troca de conta: a escolhida esta sem a senha; a em uso continua ate o Entrar");
        return;
    }
    passwordSwitch_.clear();
    if (!accounts_.SetActive(id)) Log("contas.json: a troca de conta nao foi gravada");
    ResetLogin();
    ActivateStored(*target);
}

// O Cancelar da tela Entrar que pede a senha de uma troca: a conta em uso continua (ela nunca saiu do contas.json; se
// um Entrar com a senha errada a tirou do motor, ela ja voltou a registrar).
void DesktopApp::CancelPasswordSwitch() {
    if (passwordSwitch_.empty()) {
        Log("cancelLogin ignorado: nenhuma troca de conta pede a senha");
        return;
    }
    if (loginRequest_ || (pending_ && pending_->login)) {
        Log("cancelLogin ignorado: o Entrar espera o resultado");
        return;
    }
    passwordSwitch_.clear();
    ResetLogin();
    const std::optional<SavedAccount> active = accounts_.Active();
    if (active && !active->needsPassword && engineStoreId_ != active->id) ActivateStored(*active);
    Log("troca de conta cancelada: a em uso continua");
}

// A conta gravada vai para o motor (a anterior sai); sem a senha, a tela Entrar pede so ela.
void DesktopApp::ActivateStored(const SavedAccount& account) {
    if (account.needsPassword) {
        ShowPasswordRequest(account, /*keepEngine=*/false);
        return;
    }
    registered_ = false;
    const int id = RegisterInEngine(InputOf(account));
    engineAccountId_ = id;
    engineStoreId_ = account.id;
    registration_.reset();
    if (id == 0) {
        Log("o motor recusou a conta em uso");
        registration_ = 0;
    }
}

void DesktopApp::ShowPasswordRequest(const SavedAccount& account, bool keepEngine) {
    if (!keepEngine) DropEngineAccount();
    ResetLogin();
    login_.server = U8(account.address);
    login_.transport = TransportName(account.transport);
    login_.ramal = U8(account.ramal);
    login_.name = U8(account.name);
    login_.accountId = account.id;
    login_.needsPassword = true;
    login_.error = U8(kPasswordAgain);
}

void DesktopApp::DropEngineAccount() {
    if (engineAccountId_ != 0) port_.RemoveAccount();
    engineAccountId_ = 0;
    engineStoreId_.clear();
    registration_.reset();
    registered_ = false;
    reRegister_ = false;
}

void DesktopApp::ResetLogin() {
    login_ = LoginView();
    login_.transport = TransportName(config_.profile.account.transport);
}

// A troca de conta (ou o Entrar) roda sem ligacao: ja, ou no fim da ultima, com o aviso. Uma nova troca toma o
// lugar da que esperava.
void DesktopApp::WhenIdle(PendingChange change) {
    change.token = ++pendingToken_;
    const int token = change.token;
    pending_ = std::move(change);
    if (controller_->HasCalls()) Toast(U8(kSwitchNotice));
    // O callback roda na thread do motor, na do agendador ou aqui: so poe a troca na fila.
    controller_->WhenIdle([this, token] { Post([this, token] { RunPending(token); }); });
}

void DesktopApp::RunPending(int token) {
    if (!pending_ || pending_->token != token || quitting_) return;
    if (controller_->HasCalls()) {
        // Uma ligacao chegou entre o callback e esta tarefa: espera o fim dela tambem.
        controller_->WhenIdle([this, token] { Post([this, token] { RunPending(token); }); });
        return;
    }
    const PendingChange change = *pending_;
    pending_.reset();
    if (change.login) {
        StartLogin(*change.login);
    } else {
        SwitchTo(change.switchTo);
    }
}

// Sair: as ligacoes acabam (com os Recentes) e o executavel fecha. A troca de conta que esperava fica gravada para a
// proxima abertura (menos para uma conta sem a senha: a em uso continua, senao a proxima abertura pararia na tela
// Entrar sem o Cancelar); um Entrar que esperava e descartado.
void DesktopApp::Quit() {
    quitting_ = true;
    if (adminOpen_) CloseAdmin("sair");
    const std::optional<SavedAccount> target =
        pending_ && !pending_->switchTo.empty() ? FindAccount(accounts_, pending_->switchTo) : std::nullopt;
    const std::optional<SavedAccount> current = accounts_.Active();
    if (target && target->needsPassword && current && !current->needsPassword) {
        Log("sair: a troca para a conta sem a senha nao fica gravada; a em uso continua");
    } else if (target) {
        if (accounts_.SetActive(pending_->switchTo)) {
            Log("sair: a troca de conta fica para a proxima abertura");
        } else {
            Log("contas.json: a troca de conta nao foi gravada");
        }
    }
    pending_.reset();
    if (loginTimer_ != 0) scheduler_.Cancel(loginTimer_);
    loginTimer_ = 0;
    ++loginToken_;
    controller_->OnLogout();
    if (updateOffer_) {
        updateOffer_.reset();
        if (hooks_.updateAnswer) hooks_.updateAnswer(false);
    }
    if (hooks_.quit) hooks_.quit();
}

// A escolha gravada vale pelo nome (o id do motor e a posicao na lista, que muda quando um dispositivo entra ou
// sai). Uma escolha que nao esta na lista usa o padrao do Windows e continua gravada. O motor rele os dispositivos
// antes (a lista dele e a da abertura ate reler: um headset que saiu continuaria nela, e um que entrou, fora).
void DesktopApp::ApplyAudio() {
    port_.RefreshAudioDevices();
    const Settings settings = settings_.Get();
    AudioView view;
    view.capture = settings.captureName;
    view.playback = settings.playbackName;
    view.ring = settings.ringDeviceId;
    int captureId = -1;
    int playbackId = -1;
    bool captureFound = settings.captureName.empty();
    bool playbackFound = settings.playbackName.empty();
    for (const AudioDevice& device : port_.AudioDevices()) {
        if (device.capture) {
            view.captures.push_back(AudioOption{device.id, device.name});
            if (!captureFound && device.name == settings.captureName) {
                captureId = device.id;
                captureFound = true;
            }
        }
        if (device.playback) {
            view.playbacks.push_back(AudioOption{device.id, device.name});
            if (!playbackFound && device.name == settings.playbackName) {
                playbackId = device.id;
                playbackFound = true;
            }
        }
    }
    if (!captureFound) view.disconnected.push_back(settings.captureName);
    if (!playbackFound &&
        std::find(view.disconnected.begin(), view.disconnected.end(), settings.playbackName) == view.disconnected.end()) {
        view.disconnected.push_back(settings.playbackName);
    }
    if (!captureFound || !playbackFound) Log("som: um dispositivo escolhido nao esta conectado; vale o padrao");
    if (!port_.SetAudioDevices(captureId, playbackId)) Log("som: o motor nao aceitou um dispositivo; vale o padrao");
    audio_ = view;
}

void DesktopApp::SaveSettings(const Settings& settings) {
    if (!settings_.Save(settings)) Log("config.json: as configuracoes nao foram gravadas");
}

void DesktopApp::OpenExternal(const std::string& url) {
    if (!AllowedUrl(url)) {
        Log("openExternal recusado: " + url.substr(0, 120));
        return;
    }
    if (hooks_.openUrl) hooks_.openUrl(url);
}

void DesktopApp::PublishState(bool force) {
    if (!hooks_.post) return;
    std::string message = StateMessage(BuildState());
    if (!force && message == lastState_) return;
    lastState_ = message;
    hooks_.post(message);
}

BridgeState DesktopApp::BuildState() const {
    BridgeState state;
    const std::optional<SavedAccount> active = accounts_.Active();
    // A troca que pede a senha mostra a tela Entrar, menos com uma ligacao (da conta que continua registrada): a tela
    // da ligacao vem antes, e a Entrar volta quando ela acaba.
    state.mainScreen = active && !active->needsPassword && (passwordSwitch_.empty() || call_.top.has_value());
    state.login = login_;
    state.login.canCancel = !passwordSwitch_.empty();
    for (const SavedAccount& account : accounts_.All()) {
        AccountView view = ViewOf(account);
        view.inUse = active && account.id == active->id;
        state.accounts.push_back(view);
    }
    if (active) {
        AccountView view = ViewOf(*active);
        view.inUse = true;
        if (loginRequest_ || (engineStoreId_ == active->id && !registration_)) {
            view.status = AccountStatus::Connecting;
            view.text = U8(kConnecting);
        } else if (engineStoreId_ != active->id) {
            view.status = AccountStatus::NoConnection;   // nao esta no motor (sem a senha)
        } else {
            const int code = *registration_;
            if (code >= 200 && code <= 299) {
                view.status = AccountStatus::Connected;
                view.text = U8(kConnected) + view.server;
            } else if (code >= 100 && code <= 199) {
                view.status = AccountStatus::Connecting;
                view.text = U8(kConnecting);
            } else {
                const bool unreachable = code <= 0 || code == 408 || (code >= 500 && code <= 599);
                view.status = unreachable ? AccountStatus::NoConnection : AccountStatus::Error;
                view.text = U8(RegistrationMessage(code, false));
            }
        }
        view.internet = internet_;
        state.account = view;
    }
    const Settings settings = settings_.Get();
    state.doNotDisturb = settings.doNotDisturb;
    state.autoAnswer = settings.autoAnswer;
    state.autoAnswerSeconds = settings.autoAnswerSeconds;
    state.startWithWindows = settings.startWithWindows;
    state.call = call_;

    const std::vector<Contact> contacts = contacts_.All();
    std::unordered_map<std::string, const Contact*> byNumber;   // o numero sem separadores -> o contato
    for (const Contact& contact : contacts) {
        byNumber.emplace(NormalizedNumber(contact.number), &contact);
        state.contacts.push_back(ContactView{contact.id, U8(contact.name), contact.number, U8(contact.note)});
    }
    for (const Recent& recent : recents_.All()) {
        RecentView view;
        view.number = recent.number;
        view.name = recent.name;
        view.kind = recent.kind;
        view.startMs = recent.startMs;
        view.durationMs = recent.durationMs;
        const auto found = byNumber.find(NormalizedNumber(recent.number));
        if (found != byNumber.end()) {
            view.name = U8(found->second->name);
            view.contactId = found->second->id;
        }
        state.recents.push_back(view);
    }
    state.missed = recents_.MissedCount(recentsSeenMs_);
    state.audio = audio_;
    state.version = config_.version;
    state.keypad = keypad_;
    state.keypadSeq = keypadSeq_;

    for (const Atalho& atalho : atalhos_.All()) {
        ShortcutView view;
        view.id = atalho.id;
        view.name = atalho.nome;
        view.number = atalho.numero;
        view.action = ActionName(atalho.acao);
        view.blf = atalho.blf;
        view.state = ShortcutState(atalho);
        state.shortcuts.push_back(view);
    }
    const AdminConfig& admin = admin_.Get();
    state.admin.open = adminOpen_;
    state.admin.showDoNotDisturb = admin.mostrarNaoPerturbe;
    state.admin.showAutoAnswer = admin.mostrarAtenderAuto;
    state.admin.blf = admin.blf;
    state.admin.pickup = admin.puxar;
    state.admin.pickupCode = admin.codigoPuxar;
    for (const ServerPort& server : admin.servidores) {
        state.admin.servers.push_back(ServerView{U8(server.address), server.port});
    }
    state.admin.channel = admin.canal;
    state.adminLogin = adminLogin_;
    state.endBeep = settings.bipeFim;
    return state;
}

void DesktopApp::Toast(const std::string& text) {
    if (hooks_.post) hooks_.post(ToastMessage(text));
}

void DesktopApp::Log(const std::string& line) const {
    if (hooks_.log) hooks_.log(line);
}

// A conta vai ao motor com a tabela de portas do administrador (Ruling 3: ela toma o lugar do [portas] do perfil).
int DesktopApp::RegisterInEngine(AccountInput input) {
    input.serverPorts = admin_.Get().servidores;
    engineAddress_ = input.address;
    enginePorts_ = *input.serverPorts;
    reRegister_ = false;   // a conta nova ja vai com a lista de agora
    return port_.SetAccount(input);
}

// A regra dos numeros dos contatos (e dos atalhos): o +<ddi> sai e o prefixo de saida entra nos numeros longos.
std::string DesktopApp::DialRule(const std::string& number) const {
    return U8(ContactDialString(Wide(number), config_.profile.account.ddi, config_.profile.account.externalPrefix));
}

void DesktopApp::SaveShortcut(const Command& command) {
    Atalho atalho;
    atalho.id = command.shortcutId;
    atalho.nome = command.name;
    atalho.numero = command.number;
    atalho.acao = ActionOf(command.action);
    atalho.blf = command.blf;
    std::string error;
    if (!atalhos_.Save(atalho, &error).empty()) return;
    Log("saveShortcut: o atalho nao foi gravado: " + error);
    if (!error.empty()) Toast(error);
}

// O atalho (spec 3.2 e 4): o puxar ligacao num ramal tocando; senao a acao, fora ou durante a ligacao.
void DesktopApp::UseShortcut(const std::string& id) {
    const std::vector<Atalho>& all = atalhos_.All();
    const auto found = std::find_if(all.begin(), all.end(), [&id](const Atalho& atalho) { return atalho.id == id; });
    if (found == all.end()) {
        Log("useShortcut: o atalho nao existe");
        return;
    }
    const Atalho atalho = *found;
    const AdminConfig& admin = admin_.Get();
    const std::optional<std::string> blf = ShortcutState(atalho);
    if (blf && *blf == BlfName(BlfState::Ringing) && admin.puxar && !admin.codigoPuxar.empty()) {
        Log("useShortcut: puxar a ligacao");
        controller_->Dial(PickupNumber(admin.codigoPuxar, atalho.numero));   // o codigo vai como esta, sem a regra
        return;
    }
    const bool inCall = controller_->HasCalls();
    switch (atalho.acao) {
        case Atalho::Ligar:
            controller_->DialContact(atalho.numero);
            break;
        case Atalho::Transferir:
            if (inCall) {
                if (!controller_->Transfer(DialRule(atalho.numero))) Log("useShortcut: a transferencia nao saiu");
            } else {
                controller_->DialContact(atalho.numero);
            }
            break;
        case Atalho::Consulta:
            if (inCall) {
                if (!controller_->Consult(DialRule(atalho.numero))) Log("useShortcut: a consulta nao saiu");
            } else {
                controller_->DialContact(atalho.numero);
            }
            break;
        case Atalho::Teclas:
            if (!inCall) {
                Log("useShortcut recusado: Enviar teclas sem ligacao");
                break;
            }
            {
                // O + nao e um digito DTMF: vao so 0-9, * e #.
                std::string digits;
                for (const char ch : atalho.numero) {
                    if ((ch >= '0' && ch <= '9') || ch == '*' || ch == '#') digits.push_back(ch);
                }
                if (digits.empty()) {
                    Log("useShortcut recusado: Enviar teclas sem digitos DTMF");
                    break;
                }
                controller_->Dtmf(digits);
            }
            break;
    }
}

// O estado do BLF do atalho: nada sem o BLF dele ou do administrador; desconectado ate o primeiro aviso e sem a conta
// registrada.
std::optional<std::string> DesktopApp::ShortcutState(const Atalho& atalho) const {
    if (!atalho.blf || !admin_.Get().blf) return std::nullopt;
    // Sem registro (caiu, sem internet, conectando), desconectado; o ultimo aviso do motor fica guardado e volta com o
    // registro (o motor so avisa quando o estado muda).
    if (!registered_) return std::string(BlfName(BlfState::Unknown));
    const BlfState* state = FindIn(blfStates_, atalho.numero);
    return std::string(BlfName(state ? *state : BlfState::Unknown));
}

// Os numeros que o BLF acompanha, sem repetir, na ordem dos atalhos.
std::vector<std::string> DesktopApp::BlfNumbers() const {
    std::vector<std::string> numbers;
    if (!admin_.Get().blf) return numbers;
    for (const Atalho& atalho : atalhos_.All()) {
        if (atalho.blf && std::find(numbers.begin(), numbers.end(), atalho.numero) == numbers.end()) {
            numbers.push_back(atalho.numero);
        }
    }
    return numbers;
}

// Depois de cada tarefa da fila: a lista do BLF no motor segue os atalhos, o administrador e a conta em uso. A conta
// nova (ou nenhuma) comeca sem lista no motor (SetAccount e RemoveAccount a esvaziam) e sem estados.
void DesktopApp::UpdateBlf() {
    const bool live = engineAccountId_ != 0 && !loginRequest_;
    if (!live || blfAccount_ != engineAccountId_) {
        blfWatched_.clear();
        blfAdded_.clear();
        blfStates_.clear();
        blfAccount_ = live ? engineAccountId_ : 0;
    }
    if (!live) {
        blfForce_ = false;
        return;
    }
    const std::vector<std::string> numbers = BlfNumbers();
    const bool force = blfForce_ && !numbers.empty();
    blfForce_ = false;
    std::vector<std::string> sorted = numbers;   // a ordem nao importa ao motor
    std::vector<std::string> watched = blfWatched_;
    std::sort(sorted.begin(), sorted.end());
    std::sort(watched.begin(), watched.end());
    if (sorted == watched && !force) return;
    // Os que sairam perdem o estado; os que entraram (tambem os que sairam e voltaram) ganham uma vez nova, e um aviso
    // de antes dela nao vale (HandleBlf).
    const auto listed = [&numbers](const std::string& number) {
        return std::find(numbers.begin(), numbers.end(), number) != numbers.end();
    };
    blfStates_.erase(std::remove_if(blfStates_.begin(), blfStates_.end(),
                                    [&listed](const std::pair<std::string, BlfState>& e) { return !listed(e.first); }),
                     blfStates_.end());
    blfAdded_.erase(std::remove_if(blfAdded_.begin(), blfAdded_.end(),
                                   [&listed](const std::pair<std::string, int64_t>& e) { return !listed(e.first); }),
                    blfAdded_.end());
    const int64_t generation = blfGeneration_.load() + 1;
    bool added = false;
    for (const std::string& number : numbers) {
        if (!FindIn(blfAdded_, number)) {
            blfAdded_.emplace_back(number, generation);
            added = true;
        }
    }
    if (added) blfGeneration_.store(generation);   // antes do WatchBlf: os avisos das assinaturas novas ja levam esta
    blfWatched_ = numbers;
    Log("blf: " + std::to_string(numbers.size()) + " ramal(is) acompanhado(s)");
    port_.WatchBlf(numbers);
}

void DesktopApp::HandleBlf(int64_t generation, const std::string& number, BlfState state) {
    const int64_t* added = FindIn(blfAdded_, number);
    if (!added || generation < *added) return;   // um ramal fora da lista, ou de uma assinatura que ja saiu
    for (auto& entry : blfStates_) {
        if (entry.first == number) {
            entry.second = state;
            return;
        }
    }
    blfStates_.emplace_back(number, state);
}

// adminLogin (spec 6.1): a senha certa abre a area; 5 erradas seguidas, 30 s sem aceitar outra. A senha digitada nunca
// vai ao diagnostico.
void DesktopApp::AdminLogin(const std::string& typed) {
    ++adminLogin_.seq;   // toda tentativa tem resposta: a interface limpa o campo e mostra o erro quando a vez muda
    const int64_t now = clock_.NowMs();
    if (adminLogin_.waitUntilMs != 0 && now < adminLogin_.waitUntilMs) {
        adminLogin_.error = kWrongAdminPassword;
        Log("adminLogin recusado: a espera depois de 5 senhas erradas");
        return;
    }
    const bool right = config_.checkAdminPassword ? config_.checkAdminPassword(typed) : CheckAdminPassword(typed);
    if (right) {
        adminFailures_ = 0;
        const int seq = adminLogin_.seq;
        adminLogin_ = AdminLoginView();
        adminLogin_.seq = seq;
        adminOpen_ = true;
        TouchAdmin();
        Log("area do administrador aberta");
        return;
    }
    adminLogin_.error = kWrongAdminPassword;
    adminLogin_.waitUntilMs = 0;
    if (++adminFailures_ >= kAdminMaxFailures) {
        adminFailures_ = 0;
        adminLogin_.waitUntilMs = now + kAdminLockMs;
        Log("adminLogin: 5 senhas erradas seguidas; espera de 30 s");
        return;
    }
    Log("adminLogin: senha incorreta");
}

void DesktopApp::AdminSet(const AdminChanges& changes) {
    if (!adminOpen_) {
        Log("adminSet recusado: a area do administrador esta fechada");
        return;
    }
    const AdminConfig before = admin_.Get();
    AdminConfig next = before;
    if (changes.showDoNotDisturb) next.mostrarNaoPerturbe = *changes.showDoNotDisturb;
    if (changes.showAutoAnswer) next.mostrarAtenderAuto = *changes.showAutoAnswer;
    if (changes.blf) next.blf = *changes.blf;
    if (changes.pickup) next.puxar = *changes.pickup;
    if (changes.pickupCode) next.codigoPuxar = *changes.pickupCode;
    if (changes.channel) next.canal = *changes.channel;
    if (changes.servers) {
        next.servidores.clear();
        for (const ServerView& server : *changes.servers) {
            next.servidores.push_back(ServerPort{Wide(server.address), server.port});
        }
    }
    std::string error;
    if (!admin_.Save(next, &error)) {
        Log("adminSet: nada foi gravado: " + error);
        if (!error.empty()) Toast(error);
        return;
    }
    const AdminConfig& saved = admin_.Get();
    ApplyAdminLimits();
    if (saved.canal != before.canal && hooks_.updateChannel) hooks_.updateChannel(saved.canal);
    // A porta do servidor da conta no motor mudou: ela registra de novo (no fim da ligacao, se ha uma).
    if (EnginePortChanged() && !reRegister_) {
        reRegister_ = true;
        ScheduleReRegister();
    }
}

// A porta que o motor usa para a conta dele nao e mais a da lista do administrador.
bool DesktopApp::EnginePortChanged() const {
    if (engineAccountId_ == 0) return false;
    const AccountProfile& profile = config_.profile.account;
    return PortForServer(WithServers(profile, enginePorts_), engineAddress_) !=
           PortForServer(WithServers(profile, admin_.Get().servidores), engineAddress_);
}

void DesktopApp::ScheduleReRegister() {
    // O callback roda na thread do motor, na do agendador ou aqui: so poe na fila.
    controller_->WhenIdle([this] { Post([this] { RunReRegister(); }); });
}

// Sem ligacao: a conta do motor registra de novo com a porta nova. Um SetAccount no meio (uma troca, um Entrar, a
// conta que voltou) ja levou a lista nova e tirou o pedido; com um Entrar esperando o registro, o fim dele decide.
void DesktopApp::RunReRegister() {
    if (!reRegister_ || quitting_ || loginRequest_) return;
    if (controller_->HasCalls()) {
        ScheduleReRegister();   // uma ligacao chegou no meio: espera o fim dela tambem
        return;
    }
    reRegister_ = false;
    if (!EnginePortChanged()) return;
    const std::optional<SavedAccount> account = FindAccount(accounts_, engineStoreId_);
    if (!account || account->needsPassword) return;
    Log("servidores do administrador: a conta registra de novo com a porta nova");
    ActivateStored(*account);
}

// Os 10 min sem comando recomecam.
void DesktopApp::TouchAdmin() {
    if (adminTimer_ != 0) scheduler_.Cancel(adminTimer_);
    const int token = ++adminToken_;
    adminTimer_ = scheduler_.Schedule(kAdminIdleMs, [this, token] {
        Post([this, token] {
            if (token != adminToken_ || !adminOpen_) return;
            adminTimer_ = 0;
            CloseAdmin("10 minutos sem uso");
        });
    });
}

void DesktopApp::CloseAdmin(const char* why) {
    adminOpen_ = false;
    if (adminTimer_ != 0) scheduler_.Cancel(adminTimer_);
    adminTimer_ = 0;
    ++adminToken_;
    Log(std::string("area do administrador fechada: ") + why);
}

// O Nao perturbe e o Atender automatico escondidos pelo administrador ficam desligados (gravado no config.json).
void DesktopApp::ApplyAdminLimits() {
    const AdminConfig& admin = admin_.Get();
    Settings settings = settings_.Get();
    bool changed = false;
    if (!admin.mostrarNaoPerturbe && settings.doNotDisturb) {
        settings.doNotDisturb = false;
        controller_->SetDoNotDisturb(false);
        Log("o administrador escondeu o Nao perturbe: desligado");
        changed = true;
    }
    if (!admin.mostrarAtenderAuto && settings.autoAnswer) {
        settings.autoAnswer = false;
        controller_->SetAutoAnswer(false, settings.autoAnswerSeconds * 1000);
        Log("o administrador escondeu o Atender automatico: desligado");
        changed = true;
    }
    if (changed) SaveSettings(settings);
}

// A internet (spec 8): sem ela, o registro para no motor e a ligacao nao sai (o aviso sem conexao); com ela de volta,
// a conta registra de novo (Conectando, ate a resposta).
void DesktopApp::HandleInternet(bool available) {
    if (available == internet_) return;
    internet_ = available;
    Log(available ? "internet: voltou" : "internet: caiu");
    port_.SetNetworkAvailable(available);
    registered_ = false;
    if (available && engineAccountId_ != 0 && !loginRequest_) registration_.reset();
}

}  // namespace starsonic
