#pragma once
// O protocolo da ponte, versao 1, entre a interface (TypeScript, no WebView2) e o C++ do app de PC: os comandos que
// a interface manda ({"v":1,"cmd":...}) e as mensagens que o C++ manda ({"v":1,"type":"state"|"toast"|"ring"|"update"|
// "contatosEmpresa"|"agenda"|"abrir"|"chatChave"|"janela", ...}).
// O contrato, com cada campo e um exemplo, e o docs/ponte-windows.md: uma mudanca aqui muda o documento junto (e
// o kBridgeVersion, se o formato deixa de ser compativel). Os textos sao UTF-8.
// O modo iPhone (a mesma interface num WKWebView) tem comandos e campos a mais, na mesma versao 1: quem decide o que
// vale em cada plataforma e o DesktopApp.
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "Agenda.h"           // AgendaPermission e AgendaContact (iPhone)
#include "CallController.h"   // CallSnapshot, Recent, RingKind
#include "H264Module.h"       // H264State (0.3.0: o bloco video)
#include "Planilha.h"         // SheetContact (rc.4)
#include "Video.h"            // VideoCodec e VideoQuality (0.3.0: o cartao Video do administrador)

namespace starsonic {

constexpr int kBridgeVersion = 1;

enum class CommandKind {
    Ready,
    Login,
    SelectAccount,
    RemoveAccount,
    Dial,
    Answer,
    Reject,
    Hangup,
    Hold,
    Mute,
    Dtmf,
    Transfer,
    Consult,
    CompleteTransfer,
    CancelConsult,
    Swap,
    Join,
    Split,
    SetDnd,
    SetAutoAnswer,
    SaveContact,
    RemoveContact,
    SetAudio,
    SetSetting,
    OpenExternal,
    SendDiagnostics,
    Minimize,
    CloseToTray,
    Quit,
    ViewRecents,
    UpdateNow,     // a pergunta da atualizacao: "Atualizar agora"
    UpdateLater,   // e "Depois"
    CancelLogin,   // o Cancelar da tela Entrar que pede a senha de uma troca de conta
    Resize,        // rc.2: a interface pegou uma zona de redimensionar (a borda de cima, um canto)
    SaveShortcut,     // rc.3: os atalhos
    RemoveShortcut,
    UseShortcut,
    AdminLogin,       // rc.3: a area do administrador
    AdminLogout,
    AdminSet,
    ImportContacts,       // rc.4: importar e exportar os contatos (as janelas do executavel)
    ExportContacts,
    SetCompanyList,       // rc.4: a planilha da empresa
    RefreshCompanyList,
    ContactsOpened,       // iPhone: a aba Contatos abriu
    AllowContacts,        // iPhone: o Permitir do aviso da aba Contatos
    AudioRoute,           // iPhone: o botao Audio da ligacao
    KeyTone,              // iPhone: o bipe de uma tecla (a tecla em Command::key)
    ChatKey,              // 0.2.0: o chat (so no Windows; os campos em Command::chat)
    ChatLink,
    ChatUnlink,
    ChatNotify,
    ChatBadge,
    ChatDownload,
    SetVideo,        // 0.3.0: o video (so no Windows): a camera e a chave do H.264 da pessoa
    CameraTest,      // o teste da camera (a imagem vai na vista local)
    VideoViews,      // as vistas do video que a pagina mostra agora
    VideoWindow,     // o modo da janela do video: normal, grande ou telaCheia
    H264Retry,       // tentar de novo baixar o modulo H.264 depois de uma falha
};

// Um servidor da lista do administrador (adminSet e o estado): o endereco (UTF-8) e a porta (UDP e TCP).
struct ServerView {
    std::string address;   // endereco
    int port = 0;          // porta
};

// adminSet: so os campos que vieram (ausente: fica como esta).
struct AdminChanges {
    std::optional<bool> showDoNotDisturb;    // naoPerturbe: o botao Nao perturbe aparece
    std::optional<bool> showAutoAnswer;      // atenderAuto: o Atender automatico aparece
    std::optional<bool> blf;                 // blf: o BLF nos atalhos
    std::optional<bool> pickup;              // puxar: puxar a ligacao pelo atalho
    std::optional<std::string> pickupCode;   // codigoPuxar
    std::optional<std::vector<ServerView>> servers;   // servidores (a lista inteira)
    std::optional<std::string> channel;      // canal: "teste", "estavel" ou "" (o do build)
    // 0.3.0: o cartao Video.
    std::optional<bool> videoH264;           // videoH264
    std::optional<bool> videoVp8;            // videoVp8
    std::optional<bool> videoVp9;            // videoVp9
    std::optional<VideoCodec> videoFirst;    // videoPrimeiro: "h264", "vp8" ou "vp9"
    std::optional<VideoQuality> videoQuality;   // videoQualidade: "baixa", "media" ou "alta"
    std::optional<std::vector<std::string>> doorphones;   // porteiros (a lista inteira; a loja confere as regras)
};

// Os campos dos comandos do chat (0.2.0), ja conferidos (docs/ponte-windows.md, "Os comandos do chat"). Os textos sao
// UTF-8, e os limites contam os caracteres (pontos de codigo).
struct ChatFields {
    std::string key;              // chatLink: chave (ValidChatKey)
    std::string company;          // chatLink: empresa (ValidChatCompany)
    int64_t conversation = 0;     // chatNotify: conversa (0 ou mais; 0: a aba Chat)
    std::string title;            // chatNotify: titulo (1 a 200 caracteres)
    std::string text;             // chatNotify: texto (0 a 500 caracteres)
    int badge = 0;                // chatBadge: n (0 ou mais)
    std::string fileId;           // chatDownload: arquivo (ValidFileId)
    std::string fileName;         // chatDownload: nome (1 a 255 caracteres)
};

// Um comando lido. So os campos do comando valem; os outros ficam vazios.
struct Command {
    CommandKind kind = CommandKind::Ready;
    // login: servidor, protocolo ("udp" | "tcp"), ramal, senha, nome (opcional) e contaId (opcional: "" = conta nova).
    // adminLogin: a senha (em password).
    // selectAccount e removeAccount: contaId.
    std::string server;
    std::string transport;
    std::string ramal;
    std::string password;
    std::string name;
    std::string accountId;
    // dial, transfer e consult (com contact: o numero de um contato, pela regra dos contatos); saveContact: numero.
    std::string number;
    bool contact = false;
    // hangup: o id do cartao (ausente: a ligacao ativa; 0: a feita que ainda nao tem id).
    std::optional<int> callId;
    // hold e mute (ausente: troca); setDnd e setAutoAnswer (sempre presente).
    std::optional<bool> on;
    // setAutoAnswer (ausente: o tempo de agora).
    std::optional<int> seconds;
    // dtmf
    std::string digits;
    // saveContact: id (opcional: "" = contato novo), nome (em name), numero (em number), observacao; removeContact: id.
    std::string contactId;
    std::string note;
    // setAudio: os nomes escolhidos ("" = o padrao do Windows) e o dispositivo de toque da interface; ausente: fica.
    std::optional<std::string> capture;
    std::optional<std::string> playback;
    std::optional<std::string> ring;
    // setSetting: as chaves "iniciarComWindows", "bipeFim" (rc.3) e "bipeTecla" (iPhone), com um valor booleano.
    // keyTone (iPhone): a tecla, "0" a "9", "*" ou "#".
    std::string key;
    bool value = false;
    // openExternal
    std::string url;
    // resize: "cima", "cima-esquerda", "cima-direita" ou "baixo-direita" (as zonas que o WebView2 cobre).
    std::string edge;
    // saveShortcut: id (opcional: "" = atalho novo), nome (em name), numero (em number), acao ("ligar" | "transferir"
    // | "consulta" | "teclas") e blf; removeShortcut e useShortcut: id.
    std::string shortcutId;
    std::string action;
    bool blf = false;
    // adminSet
    AdminChanges admin;
    // setCompanyList (rc.4): o link ou o caminho da planilha da empresa, como foi digitado ("" tira a lista).
    std::string link;
    // Os do chat (0.2.0).
    ChatFields chat;
    // 0.3.0: o video. video: o dial e o answer com video (Task 7; ainda nao lido). setVideo: cameraName ("" = a
    // primeira camera) e h264 (a chave da pessoa); ausentes ficam como estao. cameraTest: o on. videoViews: page
    // ("principal" | "aviso") e views, como vieram. videoWindow: mode, como veio (o nucleo ignora o que nao e dos tres).
    bool video = false;
    std::optional<std::string> cameraName;
    std::optional<bool> h264;
    std::string page;
    std::vector<std::string> views;
    std::string mode;
};

// O comando do JSON, ou nada (com o motivo em *error, se error nao e nullptr): texto que nao e JSON, sem "v":1,
// comando desconhecido, campo obrigatorio ausente ou campo com o tipo errado. Campos a mais sao ignorados. Nos do chat,
// tambem o campo fora da regra; o motivo diz o comando e o campo ("chatLink: chave invalida"), nunca o valor.
std::optional<Command> ParseCommand(const std::string& json, std::string* error = nullptr);

// O nome do comando no protocolo ("ready", "login"...).
const char* CommandName(CommandKind kind);

// O estado que a interface desenha (a mensagem "state"). Os textos em UTF-8.
struct LoginView {                  // entrar
    std::string server;             // servidor
    std::string transport = "udp";  // protocolo
    std::string ramal;
    std::string name;               // nome
    std::string error;              // erro ("" sem erro)
    bool busy = false;              // ocupado: esperando o resultado do registro (ou o fim da ligacao)
    bool needsPassword = false;     // pedeSenha: a conta veio sem senha (a migracao): so falta ela
    bool canCancel = false;         // podeCancelar: a senha de uma troca de conta (o Cancelar volta para a em uso)
    std::string accountId;          // contaId: a conta que esta tela edita ("" = conta nova)
};

enum class AccountStatus { Connected, Connecting, NoConnection, Error };

struct AccountView {                // conta e contas[]
    std::string id;
    std::string name;
    std::string ramal;
    std::string server;
    std::string transport = "udp";
    bool inUse = false;             // emUso (so em contas[])
    AccountStatus status = AccountStatus::Connecting;   // status (so em conta)
    std::string text;               // texto (so em conta)
    bool internet = true;           // internet (so em conta; rc.3): o host ve a internet
};

struct ShortcutView {               // atalhos[] (rc.3)
    std::string id;
    std::string name;               // nome
    std::string number;             // numero
    std::string action = "ligar";   // acao: "ligar" | "transferir" | "consulta" | "teclas"
    bool blf = false;
    // estado: "livre" | "tocando" | "ocupado" | "desconectado"; nada (null) sem o BLF do atalho ou do administrador.
    std::optional<std::string> state;
};

struct AdminView {                  // admin (rc.3): completo so com open
    bool open = false;              // aberto
    bool showDoNotDisturb = true;   // naoPerturbe: o botao aparece
    bool showAutoAnswer = true;     // atenderAuto
    bool blf = false;
    // puxa (tambem com a area fechada): o clique num atalho tocando puxa a ligacao (o BLF, o puxar e um codigo).
    bool picksUp = false;
    bool pickup = false;            // puxar
    std::string pickupCode;         // codigoPuxar
    std::vector<ServerView> servers;   // servidores
    std::string channel;            // canal ("" = o do build)
    // 0.3.0: o cartao Video (so com a area aberta).
    bool videoH264 = true;          // videoH264
    bool videoVp8 = true;           // videoVp8
    bool videoVp9 = false;          // videoVp9
    VideoCodec videoFirst = VideoCodec::H264;       // videoPrimeiro
    VideoQuality videoQuality = VideoQuality::Medium;   // videoQualidade
    std::vector<std::string> doorphones;            // porteiros
};

struct AdminLoginView {             // entrarAdmin (rc.3): o resultado da ultima tentativa
    std::string error;              // erro ("" sem erro)
    int64_t waitUntilMs = 0;        // esperaAte: ate quando o adminLogin e recusado (ms desde 1970; 0: nenhuma espera)
    int seq = 0;                    // vez: sobe a cada adminLogin respondido (a certa, a errada, a recusada na espera)
};

struct RecentView {                 // recentes[]
    std::string number;             // numero
    std::string name;               // nome: o do contato com o numero, senao o que a central mandou ("" sem os dois)
    Recent::Kind kind = Recent::Outgoing;   // tipo
    int64_t startMs = 0;            // inicio (ms desde 1970)
    int64_t durationMs = 0;         // duracao (ms)
    std::string contactId;          // contatoId: o contato com o numero ("" sem contato)
};

struct ContactView {                // contatos[]
    std::string id;
    std::string name;
    std::string number;
    std::string note;
};

struct AudioOption {
    int id = -1;
    std::string name;
};

struct AudioView {                  // audio
    std::vector<AudioOption> captures;    // microfones
    std::vector<AudioOption> playbacks;   // altoFalantes
    std::string capture;                  // microfone: o nome escolhido ("" = o padrao do Windows)
    std::string playback;                 // altoFalante
    std::string ring;                     // toque: o dispositivo de toque da interface ("" = o padrao)
    std::vector<std::string> disconnected;   // desconectados: os nomes escolhidos que nao estao na lista agora
};

// empresa.situacao (rc.4): "nenhuma" (sem link), "lendo", "ok" (a ultima leitura foi boa) ou "erro".
enum class CompanyListStatus { None, Reading, Ok, Error };

struct CompanyView {                // empresa (rc.4): a lista da empresa (os contatos vem na mensagem contatosEmpresa)
    std::string link;               // o texto salvo
    CompanyListStatus status = CompanyListStatus::None;   // situacao
    std::string error;              // erro: o texto da spec 5.4 ("" fora do erro)
    int64_t updatedMs = 0;          // atualizadaEm: a hora da ultima leitura boa (ms desde 1970; 0: nenhuma)
    int count = 0;                  // quantos: os contatos da lista de agora
    int seq = 0;                    // vez: sobe a cada lista nova
};

// Os campos do modo iPhone (docs/ponte-windows.md, "O estado no iPhone"), com os valores de fabrica.
struct IPhoneView {
    AgendaPermission permission = AgendaPermission::Pending;   // agenda.permissao
    int agendaSeq = 0;              // agenda.vez: sobe a cada lista nova (0: nenhuma desde a abertura)
    int agendaCount = 0;            // agenda.quantos: os contatos com algum numero da ultima lista
    std::string audioRoute;         // rotaAudio: a saida de som com o nome que o iPhone da ("" sem saber)
    bool keyBeep = true;            // config.bipeTecla: o "Bipe ao digitar" (ligado de fabrica)
};

struct ChatView {                   // chat (0.2.0, so no Windows). A chave nunca vem aqui (so na chatChave).
    bool linked = false;            // ligado: ha uma chave guardada
    std::string company;            // empresa: a guardada com a chave ("" sem ela)
    std::string computer;           // computador: o nome do computador no Windows
    bool accountConnected = false;  // contaConectada: a conta em uso ja se conectou a central neste computador
};

// video (0.3.0): as escolhas do video e o estado da camera e do modulo H.264. No iPhone, tudo neutro (ligado false).
struct VideoView {
    bool on = false;                            // ligado: ha algum codec ligado (VideoEnabled, sem olhar o modulo)
    std::vector<std::string> cameras;           // cameras: os nomes, na ordem do motor
    std::string camera;                         // camera: o nome escolhido ("" = a primeira)
    bool cameraDisconnected = false;            // cameraDesconectada: o nome escolhido nao esta em cameras
    bool test = false;                          // teste: o teste da camera ligado
    bool h264Card = false;                      // h264.cartao: o administrador deixa o H.264 ligado
    bool h264Person = false;                    // h264.pessoa: a chave da pessoa
    H264State h264State = H264State::Off;       // h264.situacao: "desligado" | "baixando" | "instalado" | "falhou"
    std::string window = "normal";              // janela: "normal" | "grande" | "telaCheia"
};

struct BridgeState {
    bool mainScreen = false;                // tela: "principal" (true) ou "entrar"
    LoginView login;                        // entrar
    std::optional<AccountView> account;     // conta (null sem conta em uso)
    std::vector<AccountView> accounts;      // contas
    bool doNotDisturb = false;              // naoPerturbe
    bool autoAnswer = false;                // atenderAutomatico.on
    int autoAnswerSeconds = 3;              // atenderAutomatico.segundos
    CallSnapshot call;                      // ligacao (null sem ligacao: sem top)
    std::vector<RecentView> recents;        // recentes (a mais nova primeiro)
    int missed = 0;                         // perdidas
    std::vector<ContactView> contacts;      // contatos (por nome)
    AudioView audio;                        // audio
    bool startWithWindows = true;           // iniciarComWindows
    std::string version;                    // versao
    std::string keypad;                     // teclado: o numero posto por um link
    int keypadSeq = 0;                      // tecladoVez: sobe a cada link
    std::vector<ShortcutView> shortcuts;    // atalhos (rc.3)
    AdminView admin;                        // admin (rc.3)
    AdminLoginView adminLogin;              // entrarAdmin (rc.3)
    bool endBeep = true;                    // config.bipeFim (rc.3)
    CompanyView company;                    // empresa (rc.4)
    std::optional<ChatView> chat;           // chat (0.2.0): so no Windows; nada no iPhone
    VideoView video;                        // video (0.3.0)
    // O modo iPhone: plataforma "ios", agenda, rotaAudio e config.bipeTecla. Nada (o Windows): o estado de sempre,
    // sem nenhum campo a mais.
    std::optional<IPhoneView> iphone;
};

// {"v":1,"type":"state","state":{...}}
std::string StateMessage(const BridgeState& state);
// {"v":1,"type":"toast","texto":"..."}
std::string ToastMessage(const std::string& text);
// {"v":1,"type":"ring","tipo":"completo"|"espera"|"parar"}
std::string RingMessage(RingKind kind);
// {"v":1,"type":"ring","tipo":"fim"} (rc.3): o bipe do fim de uma ligacao atendida, uma vez (nao muda o toque de
// agora e nao volta no ready).
std::string EndBeepMessage();
// {"v":1,"type":"update","versao":"...","notas":"..."}: a pergunta da atualizacao (a interface responde com updateNow
// ou updateLater).
std::string UpdateMessage(const std::string& version, const std::string& notes);
// {"v":1,"type":"contatosEmpresa","vez":N,"contatos":[{"nome","numero","observacao"}]} (rc.4): a lista da empresa,
// fora do state (ela pode ter 10.000 contatos, e o state vai inteiro a cada mudanca), na ordem da planilha.
std::string CompanyContactsMessage(int seq, const std::vector<SheetContact>& contacts);
// {"v":1,"type":"agenda","vez":N,"contatos":[{"nome","numeros":[...]}]} (iPhone): a agenda inteira, fora do state como
// a lista da empresa, na ordem da agenda (a interface ordena).
std::string AgendaMessage(int seq, const std::vector<AgendaContact>& contacts);
// {"v":1,"type":"abrir","tela":"recentes"} (iPhone): a pessoa tocou no aviso da perdida, e a interface vai para os
// Recentes.
std::string OpenRecentsMessage();
// {"v":1,"type":"chatChave","chave":"...","empresa":"..."} (0.2.0): a resposta ao chatKey, com "" e "" fora do chat. A
// chave so vai nesta mensagem, nunca no estado.
std::string ChatKeyMessage(const std::string& key, const std::string& company);
// {"v":1,"type":"janela","frente":true|false} (0.2.0): a janela principal esta na frente (visivel, sem minimizar e
// ativa).
std::string WindowMessage(bool inFront);
// {"v":1,"type":"abrir","tela":"chat","conversa":N} (0.2.0): a pessoa clicou no aviso do chat; com a conversa 0, a aba
// Chat.
std::string OpenChatMessage(int64_t conversation);

}  // namespace starsonic
