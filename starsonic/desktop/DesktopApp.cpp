#include "DesktopApp.h"

#include <algorithm>
#include <exception>
#include <set>
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

// rc.4: os avisos do importar e do exportar (spec da rc.4, 4.2, 4.3 e 6.4) e a situacao da lista da empresa (5.4). O
// numero 1 leva o singular (Ruling R7): "1 contato importado.", "(1 ja existia)", "1 contato exportado.".
const char kImportedOne[] = "1 contato importado";
const char kImportedMany[] = " contatos importados";   // depois do numero
const char kExistedOne[] = " (1 j\xc3\xa1 existia).";
const char kExistedMany[] = " j\xc3\xa1 existiam).";    // depois de " (" e do numero
const char kNothingNew[] = "Nenhum contato novo na planilha.";
const char kExportedOne[] = "1 contato exportado.";
const char kExportedMany[] = " contatos exportados.";  // depois do numero
const char kCantOpenFile[] = "N\xc3\xa3o consegui abrir o arquivo.";
const char kCantSaveFile[] = "N\xc3\xa3o consegui salvar o arquivo.";
const char kSheetUnreadable[] = "N\xc3\xa3o consegui ler a planilha. Ela precisa das colunas Nome e N\xc3\xbamero.";
const char kSheetTooLarge[] = "A planilha \xc3\xa9 grande demais (o m\xc3\xa1ximo \xc3\xa9 10.000 contatos).";
const char kLinkClosed[] =
    "N\xc3\xa3o consegui abrir o link. Confira se a planilha est\xc3\xa1 compartilhada para qualquer pessoa com o "
    "link.";
const char kSheetOffline[] = "Sem conex\xc3\xa3o com a planilha. Fica a \xc3\xbaltima lista.";
const char kFileNotFound[] =
    "N\xc3\xa3o achei o arquivo. Confira o caminho e se este computador tem acesso \xc3\xa0 pasta.";
const char kInvalidLink[] = "Use um link https:// ou o caminho de um arquivo.";

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

// rc.4: "<n> contatos importados." e, com os que ja existiam, "(<m> ja existiam)", com o singular para 1.
std::string ImportedText(size_t added, size_t existed) {
    std::string text = added == 1 ? std::string(kImportedOne) : std::to_string(added) + kImportedMany;
    if (existed == 1) return text + kExistedOne;
    if (existed > 1) return text + " (" + std::to_string(existed) + kExistedMany;
    return text + ".";
}

std::string ExportedText(size_t count) {
    return count == 1 ? std::string(kExportedOne) : std::to_string(count) + kExportedMany;
}

// O contato como o importar o compara (spec da rc.4, 4.2): o nome sem acento e sem caixa, e o numero pelo
// NormalizeDialString.
using ContactKey = std::pair<std::wstring, std::wstring>;

ContactKey KeyOf(const std::wstring& name, const std::string& number) {
    return ContactKey(FoldForSearch(Trim(name)), NormalizeDialString(Trim(Wide(number))));
}

// O texto da situacao de uma busca que falhou (spec da rc.4, 5.4) e o nome do erro no diagnostico.
struct CompanyFailure {
    const char* text;
    const char* why;
};

CompanyFailure FailureOf(CompanyFetchError error) {
    switch (error) {
        case CompanyFetchError::Closed:
            return CompanyFailure{kLinkClosed, "link fechado"};
        case CompanyFetchError::NotFound:
            return CompanyFailure{kFileNotFound, "arquivo nao achado"};
        case CompanyFetchError::TooLarge:
            return CompanyFailure{kSheetTooLarge, "grande demais"};
        case CompanyFetchError::Offline:
        case CompanyFetchError::None:
            break;
    }
    return CompanyFailure{kSheetOffline, "sem conexao"};
}

}  // namespace

// Os nomes dos contatos para o controlador (as duas lojas tem a trava delas: qualquer thread): o meu contato com o
// numero e, sem ele, o da lista da empresa (spec da rc.4, 5.6); sem os dois, o controlador usa o nome da central.
class DesktopApp::Names : public ContactNames {
public:
    Names(ContactsStore& contacts, CompanyListStore& company) : contacts_(contacts), company_(company) {}
    std::optional<std::string> NameFor(const std::string& number) override {
        std::wstring name = contacts_.NameFor(number);
        if (name.empty()) name = company_.NameFor(number);
        if (name.empty()) return std::nullopt;
        return U8(name);
    }

private:
    ContactsStore& contacts_;
    CompanyListStore& company_;
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
      company_(files, config_.paths.companyList),
      names_(new Names(contacts_, company_)),
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
    if (companyTimer_ != 0) scheduler_.Cancel(companyTimer_);
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

void DesktopApp::SetInternet(InternetState state) {
    Post([this, state] { HandleInternet(state); });
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
            // A lista da empresa (rc.4), se houve uma desde a abertura (com o vez 0 ela e vazia, como a da interface).
            if (companySeq_ > 0) PostCompanyContacts();
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
        case CommandKind::ImportContacts:
            PickImport();
            break;
        case CommandKind::ExportContacts:
            PickExport();
            break;
        case CommandKind::SetCompanyList:
            SetCompanyList(command.link);
            break;
        case CommandKind::RefreshCompanyList:
            RequestCompanyRead();
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
    StartCompanyList();   // rc.4: antes da conta, para os nomes da lista ja valerem na primeira recebida

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
    // Sem rede, uma resposta que ja estava na fila antes de o motor parar nao vale como registro: a ligacao sairia para
    // falhar no motor (sem o aviso de sempre) e o BLF voltaria sem rede. Sem o DNS, vale (o motor nao parou).
    registered_ = internet_ != InternetState::NoNetwork && sipCode >= 200 && sipCode <= 299;
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
    CancelCompanyTimer();   // rc.4: nenhuma leitura da lista da empresa depois do Sair
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
        view.internet = internet_ == InternetState::Online;
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
        } else {
            // Sem um contato meu, o da lista da empresa (rc.4); o contatoId fica "" (a linha oferece Salvar contato).
            const std::wstring company = company_.NameFor(recent.number);
            if (!company.empty()) view.name = U8(company);
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
    // O mesmo que o UseShortcut confere (fora o estado tocando do atalho): sem um dos tres, o clique faz a acao.
    state.admin.picksUp = admin.blf && admin.puxar && !admin.codigoPuxar.empty();
    state.admin.pickup = admin.puxar;
    state.admin.pickupCode = admin.codigoPuxar;
    for (const ServerPort& server : admin.servidores) {
        state.admin.servers.push_back(ServerView{U8(server.address), server.port});
    }
    state.admin.channel = admin.canal;
    state.adminLogin = adminLogin_;
    state.endBeep = settings.bipeFim;
    state.company.link = settings.companyListLink;
    state.company.status = companyStatus_;
    state.company.error = companyError_;
    state.company.updatedMs = company_.UpdatedMs();
    state.company.count = companyCount_;
    state.company.seq = companySeq_;
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

// A internet (spec 8, com o Ruling 23). Sem rede: o registro para no motor e a ligacao nao sai (o aviso sem conexao);
// com a rede de volta, a conta registra de novo (Conectando, ate a resposta). Sem o DNS: so a bolinha; o motor segue
// como esta (um registro vivo continua valendo: as ligacoes chegam e saem). Do DNS de volta, a conta que ficou sem
// registro registra de novo na hora (no motor de sempre: sem troca de conta).
void DesktopApp::HandleInternet(InternetState state) {
    if (state == internet_) return;
    const bool wasNoNetwork = internet_ == InternetState::NoNetwork;
    internet_ = state;
    const bool account = engineAccountId_ != 0 && !loginRequest_;
    switch (state) {
        case InternetState::NoNetwork:
            Log("internet: caiu (sem rede): o registro para");
            port_.SetNetworkAvailable(false);
            registered_ = false;
            return;
        case InternetState::NoDns:
            Log("internet: o DNS nao responde (o registro continua como esta)");
            break;
        case InternetState::Online:
            Log("internet: voltou");
            break;
    }
    if (wasNoNetwork) {
        port_.SetNetworkAvailable(true);   // o motor volta e registra de novo
        registered_ = false;
        if (account) registration_.reset();
        return;
    }
    if (state == InternetState::Online && account && !registered_) {
        port_.SetNetworkAvailable(true);   // com a rede ja la: so registra de novo, agora
        registration_.reset();
    }
}

// ---------------------------------------------------------------- rc.4: importar, exportar e a lista da empresa

// importContacts (spec da rc.4, 4.2): a janela de abrir planilha; o resto quando ela volta.
void DesktopApp::PickImport() {
    if (!hooks_.pickImportFile) {
        Log("importContacts: o executavel nao tem a janela de abrir");
        return;
    }
    // O callback vem de qualquer thread (a da janela): so poe na fila.
    hooks_.pickImportFile([this](const std::string& path) { Post([this, path] { ImportFrom(path); }); });
}

// Os contatos novos da planilha entram nos meus, cada um com um id novo, numa gravacao so. Ficam de fora o que ja
// existe nos meus e o repetido da propria planilha: o segundo de um que ja existia conta como repetido, e o "(<m> ja
// existiam)" do aviso e quantos contatos meus a planilha trouxe de novo. Cancelar a janela: nada, sem aviso.
void DesktopApp::ImportFrom(const std::string& path) {
    if (path.empty()) {
        Log("importar: a janela foi cancelada");
        return;
    }
    const std::optional<std::string> bytes = files_.Read(path);
    if (!bytes) {
        Log("importar: o arquivo nao abriu");
        Toast(kCantOpenFile);
        return;
    }
    SheetRead sheet = ReadContactSheet(*bytes);
    if (sheet.error == SheetError::TooLarge) {
        Log("importar: a planilha e grande demais");
        Toast(kSheetTooLarge);
        return;
    }
    if (sheet.error != SheetError::None) {
        Log("importar: o arquivo nao e uma planilha com as colunas Nome e Numero");
        Toast(kSheetUnreadable);
        return;
    }
    const std::vector<Contact> mine = contacts_.All();
    std::set<ContactKey> existing;
    for (const Contact& contact : mine) existing.insert(KeyOf(contact.name, contact.number));
    std::set<ContactKey> seen;
    size_t existed = 0;
    size_t repeated = 0;
    std::vector<Contact> fresh;
    for (SheetContact& row : sheet.contacts) {
        const ContactKey key = KeyOf(row.name, row.number);
        if (!seen.insert(key).second) {
            ++repeated;
        } else if (existing.count(key) != 0) {
            ++existed;
        } else {
            fresh.push_back(Contact{std::string(), std::move(row.name), std::move(row.number), std::move(row.note)});
        }
    }
    // O diagnostico so com as contagens: os repetidos sao os dois tipos; "fora", o que o AddAll deixou de fora.
    const auto counts = [existed, repeated](size_t added, size_t left) {
        return "importar: " + std::to_string(added) + " novos, " + std::to_string(existed + repeated) + " repetidos, " +
               std::to_string(left) + " fora";
    };
    if (fresh.empty()) {
        Log(counts(0, 0));
        Toast(kNothingNew);
        return;
    }
    const size_t offered = fresh.size();
    if (!contacts_.AddAll(std::move(fresh))) {
        Log("importar: o contatos.json nao foi gravado (o disco recusou)");
        Toast(kCantSaveFile);
        return;
    }
    // O AddAll deixa de fora o que o Save recusaria (sem nome ou sem numero que vale): a leitura ja os tira (0).
    const size_t added = contacts_.All().size() - mine.size();
    Log(counts(added, offered - added));
    Toast(added == 0 ? std::string(kNothingNew) : ImportedText(added, existed));
}

// exportContacts (spec da rc.4, 4.3): a janela de salvar; o resto quando ela volta.
void DesktopApp::PickExport() {
    if (!hooks_.pickExportFile) {
        Log("exportContacts: o executavel nao tem a janela de salvar");
        return;
    }
    hooks_.pickExportFile([this](const std::string& path, const std::string& format) {
        Post([this, path, format] { ExportTo(path, format); });
    });
}

// So os meus contatos (os da empresa ja estao na planilha deles), em ordem alfabetica (a do All), no formato que a
// janela escolheu.
void DesktopApp::ExportTo(const std::string& path, const std::string& format) {
    if (path.empty()) {
        Log("exportar: a janela foi cancelada");
        return;
    }
    std::vector<SheetContact> rows;
    for (const Contact& contact : contacts_.All()) {
        rows.push_back(SheetContact{contact.name, contact.number, contact.note});
    }
    std::string bytes;
    if (format == "xlsx") {
        bytes = WriteContactsXlsx(rows);
    } else if (format == "csv") {
        bytes = WriteContactsCsv(rows);
    } else {
        Log("exportar: formato desconhecido do executavel: " + format.substr(0, 16));
        Toast(kCantSaveFile);
        return;
    }
    // Vazio: o miniz nao deu ou faltou memoria (um arquivo exportado nunca e vazio). Ou o disco recusou (sem permissao,
    // o arquivo aberto em outro programa).
    if (bytes.empty() || !files_.WriteAtomic(path, bytes)) {
        Log("exportar: o arquivo nao foi gravado (" + format + ")");
        Toast(kCantSaveFile);
        return;
    }
    Log("exportar: " + std::to_string(rows.size()) + " (" + format + ")");
    Toast(ExportedText(rows.size()));
}

// A lista da empresa na abertura (spec da rc.4, 5.3): a guardada aparece na hora, antes da primeira leitura, que ja
// sai. Sem o link, nenhuma lista (Ruling R11): o company_ nem e lido, e a lista que ficou no disco (um Clear que o
// disco recusou) e apagada; se o disco recusar de novo, ela continua so no arquivo, sem valer.
void DesktopApp::StartCompanyList() {
    if (settings_.Get().companyListLink.empty()) {
        CompanyListStore left(files_, config_.paths.companyList);
        if (left.Load() && left.All().empty() && left.UpdatedMs() == 0) return;   // sem arquivo, ou ja vazio
        if (company_.Clear()) {
            Log("lista da empresa: sem o link, a lista que ficou no disco foi apagada");
        } else {
            Log("contatos-empresa.json: a lista sem o link nao foi apagada (o disco recusou)");
        }
        return;
    }
    if (!company_.Load()) Log("contatos-empresa.json ilegivel: lido como vazio");
    if (!company_.All().empty() || company_.UpdatedMs() != 0) CompanyListChanged();   // a guardada: vez 1
    RequestCompanyRead();
}

// setCompanyList (spec da rc.4, 5.1 e 5.3): o link gravado no config.json, e lido. O mesmo link de novo e o Atualizar
// agora. Vazio tira a lista (o contatos-empresa.json fica com a lista vazia). O link trocado deixa a lista de antes ate
// a primeira leitura boa do novo; a leitura aberta do de antes e descartada quando volta.
void DesktopApp::SetCompanyList(const std::string& typed) {
    const std::string link = U8(Trim(Wide(typed)));
    Settings settings = settings_.Get();
    if (link == settings.companyListLink) {
        RequestCompanyRead();
        return;
    }
    settings.companyListLink = link;
    if (!settings_.Save(settings)) {
        Log("config.json: a planilha da empresa nao foi gravada (fica a de antes)");
        return;
    }
    if (!link.empty()) {
        RequestCompanyRead();
        return;
    }
    CancelCompanyTimer();
    companyAgain_ = false;
    companyStatus_ = CompanyListStatus::None;
    companyError_.clear();
    if (!company_.Clear()) {
        // A lista fica ate a proxima abertura, que a apaga (StartCompanyList).
        Log("contatos-empresa.json: a lista vazia nao foi gravada (o disco recusou)");
        return;
    }
    Log("lista da empresa: o link saiu");
    CompanyListChanged();
}

// Uma leitura pelo link salvo (spec da rc.4, 5.3): na abertura, a de 15 min, o setCompanyList e o refreshCompanyList.
// Uma por vez: com uma aberta, o pedido marca "de novo" e roda uma vez quando ela volta (HandleCompanyFetch). Um link
// que nao e https:// nem caminho fica com o erro, sem leitura e sem a de 15 min.
void DesktopApp::RequestCompanyRead() {
    if (quitting_) return;
    const std::string link = settings_.Get().companyListLink;
    if (link.empty()) {
        Log("lista da empresa: sem o link, nada a ler");
        return;
    }
    const std::optional<CompanySource> source = CompanySourceFor(link);
    if (!source) {
        CancelCompanyTimer();   // a leitura aberta (de outro link) e descartada quando voltar
        CompanyListFailed(kInvalidLink, "link invalido");
        return;
    }
    if (companyReading_) {
        companyAgain_ = true;
        companyStatus_ = CompanyListStatus::Reading;   // o link novo sera lido (o erro de um link invalido sai)
        companyError_.clear();
        return;
    }
    if (!hooks_.fetchCompanyList) {
        Log("lista da empresa: o executavel nao le a planilha (sem o gancho)");
        return;
    }
    companyReading_ = true;
    companyReadLink_ = link;
    const int seq = ++companyReadSeq_;
    companyStatus_ = CompanyListStatus::Reading;
    companyError_.clear();
    ScheduleCompanyTimer();   // a proxima, 15 min depois desta
    Log(std::string("lista da empresa: lendo (") + CompanySourceName(source->kind) + ")");
    // O callback vem da thread do executavel que le: so poe na fila.
    hooks_.fetchCompanyList(*source, [this, seq](const CompanyFetch& result) {
        Post([this, seq, result] { HandleCompanyFetch(seq, result); });
    });
}

// A leitura voltou. A resposta de uma leitura que ja voltou (o callback chamado duas vezes) nao vale; a de um link que
// nao e mais o salvo (trocado ou tirado no meio dela) e descartada sem mudar nada (Ruling R8). Depois, o "de novo", com
// o link de agora.
void DesktopApp::HandleCompanyFetch(int seq, const CompanyFetch& result) {
    if (!companyReading_ || seq != companyReadSeq_) {
        Log("lista da empresa: uma resposta repetida foi ignorada");
        return;
    }
    companyReading_ = false;
    const bool current = companyReadLink_ == settings_.Get().companyListLink;
    companyReadLink_.clear();
    if (current) {
        ApplyCompanyFetch(result);
    } else {
        Log("lista da empresa: a leitura de um link que saiu foi descartada");
    }
    if (companyAgain_) {
        companyAgain_ = false;
        RequestCompanyRead();
    }
}

// Uma planilha boa troca a lista inteira (tambem por uma vazia, so com o cabecalho); um erro deixa a lista de antes, na
// memoria e no arquivo, e a hora da ultima leitura boa.
void DesktopApp::ApplyCompanyFetch(const CompanyFetch& result) {
    if (result.error != CompanyFetchError::None) {
        const CompanyFailure failure = FailureOf(result.error);
        CompanyListFailed(failure.text, failure.why);
        return;
    }
    SheetRead sheet = ReadContactSheet(result.bytes);
    if (sheet.error == SheetError::TooLarge) {
        CompanyListFailed(kSheetTooLarge, "grande demais");
        return;
    }
    if (sheet.error != SheetError::None) {
        CompanyListFailed(kSheetUnreadable, "planilha ilegivel");
        return;
    }
    // O disco que recusa a lista nova deixa a de antes (o Replace nao muda nada): o aviso e o do disco.
    if (!company_.Replace(std::move(sheet.contacts), clock_.NowMs())) {
        CompanyListFailed(kCantSaveFile, "disco");
        return;
    }
    companyStatus_ = CompanyListStatus::Ok;
    companyError_.clear();
    CompanyListChanged();
    Log("lista da empresa: " + std::to_string(companyCount_) + " contatos");
}

void DesktopApp::CompanyListFailed(const char* text, const char* why) {
    companyStatus_ = CompanyListStatus::Error;
    companyError_ = text;
    Log(std::string("lista da empresa: erro ") + why);
}

// A lista do company_ mudou (a guardada na abertura, uma leitura boa, o link que saiu): o vez sobe e ela vai a
// interface.
void DesktopApp::CompanyListChanged() {
    ++companySeq_;
    const std::vector<SheetContact> contacts = company_.All();
    companyCount_ = static_cast<int>(contacts.size());
    if (hooks_.post) hooks_.post(CompanyContactsMessage(companySeq_, contacts));
}

void DesktopApp::PostCompanyContacts() {
    if (hooks_.post) hooks_.post(CompanyContactsMessage(companySeq_, company_.All()));
}

// A proxima leitura de 15 min, contada desta (a que estava agendada sai). A tarefa so poe na fila.
void DesktopApp::ScheduleCompanyTimer() {
    CancelCompanyTimer();
    const int token = companyTimerToken_;
    companyTimer_ = scheduler_.Schedule(kCompanyListRefreshMs, [this, token] {
        Post([this, token] {
            if (token != companyTimerToken_) return;
            companyTimer_ = 0;
            RequestCompanyRead();
        });
    });
}

void DesktopApp::CancelCompanyTimer() {
    if (companyTimer_ != 0) scheduler_.Cancel(companyTimer_);
    companyTimer_ = 0;
    ++companyTimerToken_;   // uma tarefa que ja saiu do agendador (e esta na fila) nao vale mais
}

}  // namespace starsonic
