#pragma once
// O contrato do motor de ligações, com duas implementações: a do PJSIP 2.17 (pjsua2; SipEngine.cpp, no
// Windows e no Android) e a do baresip e da libre 4.12 (baresip/, para o iPhone). O CMake escolhe uma
// das duas. O motor monta a conta do perfil, registra, faz e recebe ligações e avisa os eventos por
// EngineListener. Onde as duas fazem diferente, o comentário diz. Sem nada de Android nem de iPhone;
// este cabeçalho não inclui o PJSIP nem o baresip.
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "Profile.h"
#include "Video.h"

namespace starsonic {

enum class CallState { Incoming = 0, Calling = 1, Early = 2, Connecting = 3, Confirmed = 4, Disconnected = 5 };

// O estado de um ramal pelo BLF (WatchBlf), juntando os diálogos dele: Ringing = tocando (algum diálogo
// early, proceeding ou trying), senão Busy = ocupado (algum confirmed), senão Free = livre (nenhum diálogo,
// ou todos terminated); Unknown = sem estado (assinatura recusada, vencida, sem resposta, encerrada pelo
// servidor, ou a rede fora).
enum class BlfState { Free = 0, Ringing = 1, Busy = 2, Unknown = 3 };

// Os eventos (OnRegistration, OnIncomingCall, OnRejectedBusy, OnCallState, OnTransfer, OnBlf, OnCallVideo,
// OnCameraProblem e OnRoom) chegam numa thread do próprio motor, um de cada vez e na ordem em que aconteceram, sem
// nenhuma trava do motor, do PJSIP ou da libre presa: o listener pode chamar o motor (só não pode destruí-lo). Um
// evento pode chegar antes de o método que o provocou voltar. Do começo de ~SipEngine em diante nenhum evento é
// entregue (o destrutor espera o que estiver com o listener terminar).
// OnLog é diferente: chega na hora, na thread que escreveu a linha (uma do PJSIP ou da libre, ou a que
// chamou o motor), às vezes com travas do motor, do PJSIP ou da libre presas; ele não pode chamar o
// motor nem esperar por outra thread. Uma exceção que saia dele não volta para o motor: a linha se
// perde. A implementação precisa durar mais que o motor (o destrutor ainda manda linhas de log).
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
    // Chegou uma ligação com duas em andamento, com uma que ainda não foi confirmada ou com a sala de pé
    // (RoomAdd): o motor respondeu 486 (Ocupado) sozinho.
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
    // O estado do ramal number (como veio em WatchBlf) mudou: só quando muda, sem repetir o mesmo estado
    // seguido. Com SetNetworkAvailable(false), chega Unknown para cada ramal da lista. Um ramal que sai da
    // lista (ou cuja conta sai) não avisa mais nada. Vazio por padrão.
    virtual void OnBlf(const std::string& /*number*/, BlfState /*state*/) {}
    // O vídeo da ligação callId mudou: um evento a cada mudança de um campo do CallVideo (o refused sai uma vez por
    // recusa, num evento só dele, com os outros campos de agora). Numa recebida que oferece vídeo, ele sai logo depois
    // do OnIncomingCall, com o offered (num Porteiro, também o early e o doorphone) ou com o refused (sem codec em
    // comum); se a PJSIP não aceita o codec em comum (o fmtp, como o perfil do H.264), a resposta (o 183 de um Porteiro
    // ou o 200) vai sem o vídeo e o refused sai nela, com o offered e o early false e o doorphone de um Porteiro true
    // (ele segue até o fim: a recebida de um número dos Porteiros que oferece vídeo com um codec em comum, com ou sem o
    // 183). Nunca antes do primeiro evento da ligação (o OnIncomingCall, ou o primeiro OnCallState de uma feita), nem
    // depois do Disconnected dela. Só no motor do PJSIP com o vídeo (o Windows): sem o vídeo (o Android) e no do
    // baresip, nunca chega. Vazio por padrão.
    virtual void OnCallVideo(int /*callId*/, const CallVideo& /*video*/) {}
    // Um problema da câmera, uma vez por problema (os casos estão em StartCameraTest e Disconnected em
    // RefreshVideoDevices): NoCamera, a câmera pedida sem nenhuma (VideoDevices vazio); OpenFailed, a câmera que não
    // abre (o log ganha "camera: falhou (<código>)"); Disconnected, a câmera em uso que some. Só no motor do PJSIP com
    // o vídeo; sem o vídeo e no do baresip, nunca chega. Vazio por padrão.
    virtual void OnCameraProblem(CameraProblem /*problem*/) {}
    // A sala (RoomAdd) mudou: um evento a cada mudança de um campo do RoomInfo, com a sala inteira de agora. O que
    // traz um convidado novo (também o do nascimento da sala) chega antes do primeiro OnCallState da ligação dele; os
    // outros, depois do evento da ligação que os causou (o Confirmed que põe o convidado na sala, o Disconnected que o
    // tira). O último tem o ended, com quem ficou (agora uma ligação comum) ou ninguém; depois dele, o id não volta.
    // Só no motor do PJSIP com o vídeo (o Windows): sem o vídeo (o Android) e no do baresip, nunca chega. Vazio por
    // padrão.
    virtual void OnRoom(const RoomInfo& /*room*/) {}
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
    bool h264Available = false;   // o h264Available das escolhas de vídeo de fábrica que o Create aplica
    bool nullVideo = false;       // sem câmera (testes): o motor não usa as câmeras da PJSIP, como num PC sem câmera
};

struct AccountInput {
    std::wstring address;     // já validado (ValidateServerAddress)
    Transport transport = Transport::Udp;
    std::wstring ramal;       // já validado (ValidateRamal)
    std::wstring senha;
    // A tabela de portas por servidor que vale para esta conta no lugar do [portas] do perfil (a lista de
    // servidores da área do administrador do app de PC); um servidor fora dela usa a porta da [conta]. Nada:
    // vale o [portas] do perfil (o Android).
    std::optional<std::vector<ServerPort>> serverPorts;
};

// O acesso dos testes do motor com o baresip ao estado dele (baresip/SipEngineTestAccess.h); o motor do PJSIP não a
// define.
struct SipEngineTestAccess;

// Os dados de push (spec 7.3) que vão em cada REGISTER, nos dois formatos: parâmetros na URI do Contact, como na
// RFC 8599 (pn-provider, pn-param, pn-prid), e cabeçalhos próprios. Os limites estão em PushDataProblem
// (PushDataCheck.h).
struct PushData {
    std::vector<std::pair<std::string, std::string>> contactParams;   // vão na URI do Contact: ;nome=valor
    std::vector<std::pair<std::string, std::string>> headers;         // Nome: valor
};

// Todo método público pode ser chamado de qualquer thread (no Windows, uma fora de um apartamento STA: ver as câmeras,
// abaixo): o motor do PJSIP registra a thread que chama no PJLIB antes de usar o PJSIP, e o do baresip só usa o baresip
// e a libre dentro do laço deles. Chamadas ao mesmo tempo esperam uma pela outra (menos HasCall, CallCount, Video, Room
// e SetFrameSink, que não esperam as outras). Até duas ligações, uma delas a ativa: só a ativa fica ligada ao
// dispositivo de som, e a outra fica em espera (re-INVITE sendonly). Na conferência (Join) as duas ficam com o som e
// ligadas entre si. A terceira que chega recebe 486. A sala de vídeo em grupo (RoomAdd) é a exceção: os convidados
// dela, até kRoomMaxGuests, ficam todos com o som e ligados entre si, e a ligação que chega com ela de pé recebe 486.
class SipEngine {
public:
    // O pjsua e o baresip têm estado global: só um motor por processo (um segundo Create devolve nullptr
    // até o primeiro ser destruído). Em caso de erro devolve nullptr e escreve o motivo em *error (se não
    // for nullptr). No motor do PJSIP, com stun= no perfil, o pjsua testa os servidores aqui dentro, como
    // no MicroSIP: cada um que não responde atrasa o Create em cerca de 8 s antes de ser ignorado (chame
    // fora da thread principal). No do baresip, o STUN é só da mídia, e nada é testado aqui.
    static std::unique_ptr<SipEngine> Create(const EngineConfig& config, EngineListener* listener, std::string* error);

    // Desliga as ligações e desregistra a conta, sem avisar o listener, e fecha o pjsua (ou o baresip e a
    // libre); demora cerca de 1 s (mais até ~5 s se o servidor não responde). Não pode ser chamado de dentro
    // de um evento.
    ~SipEngine();

    SipEngine(const SipEngine&) = delete;
    SipEngine& operator=(const SipEngine&) = delete;

    // Troca a conta e registra; o resultado chega por OnRegistration com o id que SetAccount devolve
    // (> 0, e cada conta nova recebe um maior que o das anteriores). A conta anterior sai do servidor
    // sem aviso ao listener (as ligações em andamento são desligadas, com o Disconnected de sempre). 0:
    // dados vazios ou o PJSIP (ou o baresip) recusou a conta (não há conta). Espera até ~5 s pela saída da
    // conta anterior.
    int SetAccount(const AccountInput& input);

    // Desliga as ligações, retira o registro e apaga a conta; no fim chega OnRegistration(200, false,
    // <id da conta que saiu>), uma vez. Com um REGISTER ainda a caminho, espera a resposta dele e só
    // então pede a saída. Espera até ~3 s pelo servidor; sem resposta, a conta sai assim mesmo (o log
    // diz). Sem conta, nada.
    void RemoveAccount();

    // Renova o registro agora. Com a rede fora (SetNetworkAvailable(false)), nada.
    void Reregister();

    // A rede mudou (do Wi-Fi para o 4G e de volta, ou uma rede nova): refaz os transportes nos endereços
    // de agora e renova o registro (o resultado chega por OnRegistration). Chame a cada troca de caminho, e
    // não só o SetNetworkAvailable(true): só este refaz os transportes. Com um REGISTER a caminho no UDP,
    // as repetições dele já saem pelo transporte novo: no motor do PJSIP ele vale como a renovação; no do
    // baresip, o registro novo vai logo depois da resposta dele, que não vira evento.
    // - No motor do PJSIP, os transportes ficam em 0.0.0.0 e servem a qualquer endereço. O pjsua, com a
    //   reescrita do Contact desligada, não refaz o registro sozinho no UDP e só o faz depois de 0 a 10 s
    //   no TCP; por isso o motor espera os transportes (até ~2 s) e registra de novo.
    // - O do baresip lê de novo os endereços locais e os servidores de DNS (o baresip só os lê ao subir),
    //   refaz os transportes nesses endereços e registra na hora. No TCP, o REGISTER que estava a caminho
    //   ia pela conexão que a troca fecha: ele é largado (a resposta dele não vira evento) e sai de novo
    //   na hora, sem esperar os 32 s em que a libre o daria por perdido.
    void HandleIpChange();

    // A internet caiu (false) ou voltou (true), pelo que o app enxerga da rede. false: o motor deixa de
    // tentar registrar de novo (uma renovação que falha não é repetida), nenhuma resposta de registro vira
    // evento e, no motor do PJSIP, as assinaturas de BLF saem e cada ramal da lista avisa OnBlf(Unknown). O
    // registro não sai do servidor: ele vive até vencer ou até a próxima renovação falhar (com a central
    // alcançável, como num "sem rede" errado, as ligações continuam chegando). A conta continua (as
    // ligações em andamento seguem como estiverem) e uma SetAccount sem rede cria a conta sem registrar.
    // true: registra de novo na hora (o resultado chega por OnRegistration; com um pedido ainda a caminho,
    // como uma renovação sem resposta, o registro vai logo depois da resposta dele, e essa resposta não
    // vira evento) e, no PJSIP, assina de novo os ramais da lista. Os transportes não mudam: numa troca de
    // rede, é o HandleIpChange. Nenhum dos dois espera. Sem conta, só guarda o estado. Repetir o mesmo
    // valor: false não faz nada; true registra de novo.
    void SetNetworkAvailable(bool available);

    // Os dados de push que vão em cada REGISTER da conta, ou nenhum (nullopt), nos dois formatos da spec 7.3:
    // parâmetros no Contact (como na RFC 8599) ou cabeçalhos próprios. Com uma conta e a rede disponível, o
    // motor registra de novo na hora (o resultado chega por OnRegistration), sem mexer nas
    // ligações; sem conta ou sem rede, só guarda os dados para o próximo REGISTER. false: o PushDataProblem
    // achou um problema nos dados, e nada muda. O motor do PJSIP (Windows e Android) só confere: não guarda
    // nem manda nada.
    bool SetPushData(const std::optional<PushData>& data);

    // Os ramais (number em UTF-8, já sem separadores) cujo estado o motor acompanha na conta de agora, pelo
    // SUBSCRIBE do evento dialog (RFC 4235, o BLF) a sip:<número>@<domínio da conta> (com a porta, como em
    // MakeCall). Só no motor do PJSIP: o do baresip não assina nada e não avisa nada (só escreve no log).
    // Troca a lista inteira: quem entra é assinado, quem sai tem a assinatura retirada (SUBSCRIBE com
    // Expires: 0), quem fica continua como está. Vazia: nenhum. Os estados chegam por OnBlf
    // (o primeiro, quando o servidor manda o primeiro NOTIFY; os NOTIFY partial mudam só os diálogos que
    // trazem). Uma assinatura recusada ou encerrada pelo servidor avisa Unknown; ela é feita de novo quando
    // a conta volta a ficar registrada (depois de uma falha ou da rede voltar), e senão o PJSIP tenta de
    // novo mais tarde (cerca de 5 min). Depois de a conta perder o registro com a rede ligada (uma renovação
    // recusada ou sem resposta, a central reiniciada), as assinaturas de antes da perda também são feitas de
    // novo na volta: a central pode tê-las perdido sem avisar. A lista é da conta:
    // SetAccount e RemoveAccount retiram as assinaturas e esvaziam a lista. Sem conta, nada. Sem rede, só
    // guarda a lista (os novos avisam Unknown) e assina quando a rede volta.
    void WatchBlf(const std::vector<std::string>& numbers);

    // Os codecs ligados (prioridade acima de zero), do mais para o menos preferido.
    std::vector<std::string> ActiveCodecs() const;

    // Os codecs de vídeo ligados (prioridade acima de zero), do mais para o menos preferido, como o ActiveCodecs: o id
    // é o nome e o payload type, como "H264/97" e "VP8/100". Vazio sem o vídeo no PJSIP (PJMEDIA_HAS_VIDEO 0, como no
    // Android) e no motor do baresip, que não tem vídeo.
    std::vector<std::string> VideoCodecs() const;

    // As escolhas do vídeo (spec da videochamada, 4.3 e 7), para as próximas ofertas e respostas: os codecs na ordem do
    // CodecOrder (prioridades 255, 254 e 253; os de fora ficam com 0 e a PJSIP nunca os oferece nem aceita), a
    // qualidade (o tamanho, os quadros por segundo e a taxa do codificador de cada codec, e a taxa da conta), o fmtp do
    // H.264 (profile-level-id=42e01f, packetization-mode=1) e os Porteiros. O Create já aplica as de fábrica, com o
    // h264Available do EngineConfig. Sem o vídeo (o Android) e no motor do baresip, nada.
    void SetVideoSettings(const VideoSettings& settings);

    // Liga para sip:<número>@<domínio da conta> (number em UTF-8, já sem separadores; ver
    // NormalizeDialString). Se a porta do perfil não é a 5060, a URI leva a porta (o servidor do
    // registro): sip:<número>@<domínio>:<porta>. Devolve o id da ligação, que os eventos dela trazem,
    // ou -1 (sem conta, número vazio, já há duas ligações, a outra ainda não foi confirmada, a sala está
    // de pé (RoomAdd) ou o PJSIP (ou o baresip) recusou; nesse caso nenhum evento dela chega). Com uma
    // ligação confirmada em andamento, ela vai para a espera antes (e fica nela mesmo se a nova não sai)
    // e a nova é a ativa. Os eventos podem chegar antes de MakeCall voltar.
    int MakeCall(const std::string& number);

    // O MakeCall com o vídeo (video = true; com false é o MakeCall de sempre, sem m=video). Com o VideoEnabled das
    // escolhas, a oferta leva um vídeo e a câmera fica com o desejo ligado: depois da confirmação, com o vídeo aceito,
    // a câmera começa a mandar. Se a resposta recusa o vídeo (a porta 0), a ligação segue só com a voz e sai um
    // OnCallVideo com o refused. Sem o VideoEnabled, é a ligação só de voz, e o refused sai logo depois do primeiro
    // OnCallState dela. Uma recusa da ligação inteira por causa do vídeo (488 ou 415) chega pelo Disconnected com esse
    // código (quem liga de novo só com a voz é o app). Sem câmera (VideoDevices vazio), sai o OnCameraProblem(NoCamera)
    // e a oferta leva o vídeo só para receber (recvonly), com a câmera desligada. Sem o vídeo no motor (o Android e o
    // baresip), com video = true devolve -1 e não liga.
    int MakeCall(const std::string& number, bool video);

    // Atende (200) ou recusa com Ocupado (486) a ligação recebida que está tocando. Atendida, ela vira
    // a ativa e a outra, se há, vai para a espera. Com o id da sala, false.
    bool Answer(int callId);
    bool Reject(int callId);

    // O Answer com o vídeo: a resposta aceita o vídeo da oferta (um vídeo, se ela oferece vídeo com um codec em comum,
    // o offered do OnCallVideo; nenhum, se não; se a PJSIP não aceita o fmtp do codec, nenhum, com o refused). Com
    // video = false a câmera não manda nada (o "Atender"); com true, o desejo da câmera liga e ela começa a mandar
    // depois da confirmação (o "Atender com vídeo"). Sem câmera, com true sai o OnCameraProblem(NoCamera) e a câmera
    // fica desligada; a resposta aceita o vídeo só para receber (recvonly) quando já não havia câmera no toque (o 180
    // ou o 183 diz a resposta). Sem o vídeo no motor, com video = true devolve false e não atende.
    bool Answer(int callId, bool video);

    // O desejo da pessoa para a câmera da ligação (o botão "Câmera"). Numa ligação confirmada sem vídeo, com on, pede o
    // vídeo à outra ponta (um re-INVITE que acrescenta o vídeo); uma recusa sai como refused. Numa ligação com vídeo,
    // liga ou desliga só o envio, sem re-INVITE. A câmera só manda com a ligação sem pausa (ver Video). Sem câmera, com
    // on sai o OnCameraProblem(NoCamera) e a câmera fica desligada; numa ligação sem vídeo o re-INVITE pede o vídeo só
    // para receber (recvonly). false: id desconhecido, ligação ainda não confirmada sem vídeo, o re-INVITE não saiu ou
    // sem o VideoEnabled (com on, sai um OnCallVideo com o refused). Sem o vídeo no motor, false.
    bool SetCamera(int callId, bool on);

    // A tela bloqueada (true): a câmera para de mandar em todas as ligações, e a do teste da câmera fecha também (o
    // teste segue ligado, sem quadros). false devolve a cada ligação sem pausa o seu desejo, e ao teste ligado a sua
    // câmera. O active não muda. Sem o vídeo no motor, nada.
    void SetCameraPaused(bool paused);

    // O vídeo da ligação agora, como o último OnCallVideo dela (sem o refused); CallVideo{} para um id desconhecido e
    // sem o vídeo no motor. O vídeo só numa ligação sozinha: o vídeo dela pausa (active e camera false, nada é mandado)
    // na espera daqui, com duas ligações (as duas, com a segunda ainda tocando ou já atendida), na conferência e com
    // uma transferência pedida ainda sem resultado; sai da pausa com o active de volta e a câmera seguindo o desejo. A
    // exceção é o Porteiro (o doorphone; decisão do responsável de 11/11/2026): com duas ligações, a imagem dele segue
    // chegando (o active e o remote, tocando ou já atendido), mas a câmera não manda para ele; a espera, a conferência
    // e a transferência o pausam como a qualquer ligação. Os convidados da sala (RoomAdd) também não pausam uns pelos
    // outros: cada um tem o vídeo dele, e a câmera manda para cada um com o desejo da câmera da sala (o da ligação de
    // onde ela nasceu).
    CallVideo Video(int callId) const;

    // A imagem (spec da videochamada, 6.2 e 6.4): o desenhista nosso entrega cada quadro I420 ao sink. Os da outra
    // ponta vão com o id da ligação (OnRemoteFrame) e nunca saem de uma ligação com a imagem pausada (o active false:
    // ver Video); os da nossa câmera (OnLocalFrame) saem da prévia da câmera escolhida, que roda enquanto o teste da
    // câmera está ligado ou alguma ligação manda a imagem. nullptr descarta. Síncrono com o desenhista: ao voltar,
    // nenhum quadro chega ao sink antigo (ele precisa durar até lá). Não espera os outros métodos, só a entrega de um
    // quadro em andamento; não pode ser chamado de dentro do sink. O sink não chama o motor, nenhum método: uma thread
    // da API pode estar esperando a trava do desenhista com as travas do motor e do pjsua presas, e a entrega do quadro
    // travaria com ela. O destrutor do motor larga o sink. Sem o vídeo no motor, nada.
    void SetFrameSink(FrameSink* sink);

    // As câmeras e a prévia. No Windows a câmera é a DirectShow da PJSIP, que usa o COM do apartamento multithread (o
    // CoInitializeEx da fábrica dela, no Create): StartCameraTest, StopCameraTest, RefreshVideoDevices e
    // SetCaptureDevice abrem, fecham ou leem as câmeras na thread que chama, e o Hangup pode fechar a câmera de uma
    // ligação nela. Por isso só uma thread fora de um apartamento STA chama o motor (a de comandos do DesktopApp ou a
    // dos eventos do motor, nunca a da janela, que é STA; ver EngineHost.h). O envio da câmera de uma ligação abre e
    // fecha na thread do PJSIP.

    // As câmeras que a PJSIP enxerga, na ordem dela, com o nome em UTF-8; o nosso dispositivo de saída não entra. Com
    // o nullVideo, nenhuma. Vazio sem o vídeo no motor.
    std::vector<VideoDevice> VideoDevices() const;

    // A câmera pelo nome (o de VideoDevices); "" é a primeira. Vale na próxima vez que a câmera abre (o teste da
    // câmera, uma ligação nova ou a Câmera ligada de novo): a aberta segue até fechar. Um nome que não está na lista
    // usa a primeira e fica guardado: quando ela volta (RefreshVideoDevices), volta a ser a usada. false só sem o vídeo
    // no motor.
    bool SetCaptureDevice(const std::string& name);

    // Relê as câmeras do sistema (uma entrou ou saiu: o pjmedia_vid_dev_refresh, que muda os ids da PJSIP) e acha de
    // novo pelo nome a câmera escolhida e o desenhista nosso: as próximas ligações e a prévia usam os ids novos (as
    // ligações em andamento seguem com a imagem que chega). A câmera em uso que sumiu avisa
    // OnCameraProblem(Disconnected), como um erro da captura no meio: as ligações ficam com camera=false (o desejo da
    // câmera desliga) e o teste da câmera para. A câmera em uso que só mudou de lugar na lista fecha e abre de novo; se
    // ela não abre, sai um OnCameraProblem(OpenFailed) (e a linha "camera: falhou (<código>)"), as ligações ficam com
    // camera=false e o teste da câmera para. Sem o vídeo no motor, nada.
    void RefreshVideoDevices();

    // O teste da câmera: a prévia da câmera escolhida, em OnLocalFrame, até o StopCameraTest. false (e o teste não
    // fica ligado): sem câmera (OnCameraProblem(NoCamera)) ou a câmera não abriu (OnCameraProblem(OpenFailed) e a linha
    // "camera: falhou (<código>)" no log). Sem o vídeo no motor, false.
    bool StartCameraTest();                             // a prévia da câmera escolhida, em OnLocalFrame
    void StopCameraTest();

    // A sala de vídeo em grupo (spec do vídeo em grupo): quem monta (este motor) liga para até kRoomMaxGuests
    // convidados, e todos se ouvem: cada convidado na sala fica ligado ao dispositivo de som e a cada outro (ver
    // AudioLinks); um que ainda é chamado, ou que pôs a ligação em espera, não fica ligado a nada. Cada convidado é
    // uma ligação, com o id e os eventos de sempre (o Hangup dele é o "Tirar da sala"), e a sala tem um id próprio, do
    // mesmo contador das ligações, que vale nos métodos de sempre: cada um diz o que faz com ele. A saída de um
    // convidado (o Hangup dele, o fim do outro lado ou uma recusa) tira o quadro dele, e a sala se arruma; com um
    // convidado só, contando os chamados, ou nenhum, ela acaba: sai o OnRoom com o ended, e quem ficou volta a ser uma
    // ligação comum, com o desejo da câmera da sala, e é a ativa se a sala era a ativa. Só no motor do PJSIP com o
    // vídeo (o Windows): sem o vídeo (o Android) e no do baresip, o RoomAdd devolve -1, o Room devolve o RoomInfo{} e
    // nenhum OnRoom chega.

    // Liga para sip:<número>@<domínio da conta> (como o MakeCall com o vídeo, pela central da conta) e põe a ligação
    // na sala, chamando até ser confirmada. A oferta leva um vídeo (sendrecv): um convidado que responde sem o vídeo
    // fica na sala só com a voz, sem o refused. Sem sala, a sala nasce da ligação de agora, que precisa ser a única,
    // confirmada, com o vídeo negociado, fora da espera, da conferência e de uma transferência: ela é o primeiro
    // convidado, e a sala ganha um id novo, tirado antes do da ligação nova. Com sala, você precisa estar nela (o out
    // falso), ela não pode estar acabando (o Hangup do id dela) e precisa ter menos de kRoomMaxGuests convidados,
    // contando os chamados. A ligação nova não põe nada em espera. Uma recusa dela (486, ou a da oferta de vídeo
    // inteira, 488 ou 415) chega pelo Disconnected com o código, e a sala segue (ou acaba, se fica com um só). Devolve
    // o id da ligação, ou -1: os casos acima, sem o VideoEnabled das escolhas, número vazio, sem conta ou o PJSIP
    // recusou; com -1, nenhum evento dela chega e a sala não nasce. Os eventos podem chegar antes de RoomAdd voltar.
    // Sem o vídeo no motor, sempre -1.
    int RoomAdd(const std::string& number);

    // A sala de agora, como o último OnRoom dela; RoomInfo{} sem sala (também depois do OnRoom com o ended). Não espera
    // os outros métodos, como o CallCount.
    RoomInfo Room() const;

    // Desliga a ligação em qualquer estado (CANCEL, recusa ou BYE); o fim chega por OnCallState. A
    // outra ligação não volta sozinha: ela segue em espera até um Activate. Na conferência, a outra
    // segue como a ativa, com o som. O id da sala desliga todos os convidados: a sala fecha (nenhum volta
    // a ser uma ligação comum) e o último OnRoom traz o ended, sem ninguém; false se algum desligar não saiu.
    bool Hangup(int callId);

    // callId vira a ativa: a outra (confirmada e fora da espera) vai para a espera, callId é retomada
    // (re-INVITE com sendrecv) se estava em espera, e só ela fica ligada ao dispositivo de som. Já
    // ativa, nada muda. Na conferência, é o Split(callId, a outra). false: id desconhecido, ligação
    // ainda não confirmada ou a retomada de callId não saiu (também depois de esperar até ~2 s a
    // renegociação anterior dela): callId já é a ativa, e a outra já saiu do som, mas callId segue em
    // espera até um Activate seguinte. O id da sala dá true com a sala de pé (você está nela); o de um
    // convidado dá false (ele não é uma linha: ninguém o põe em espera nem o deixa sozinho com o som).
    bool Activate(int callId);

    // A conferência a três, na mesa de áudio daqui (a central não fica sabendo): retoma a que está em
    // espera (re-INVITE com sendrecv) e liga as duas ao dispositivo de som e entre si. Nenhuma fica
    // sendo a ativa: o Activate de uma delas desfaz a conferência. Se uma das duas acaba, a outra segue
    // como a ativa, com o som. Já em conferência, nada muda. false (a conferência não começa): id
    // desconhecido (também o da sala), ids iguais, um convidado da sala, ligação não confirmada,
    // transferência com consulta em andamento (TransferAttended sem resultado ainda) ou a retomada não
    // saiu (também depois de esperar até ~2 s a renegociação anterior da que está em espera).
    bool Join(int callId, int otherId);

    // Desfaz a conferência: as duas deixam de se ouvir, otherId vai para a espera (re-INVITE com
    // sendonly) e callId fica a ativa, com o som. Fora da conferência, é o Activate(callId). false: id
    // desconhecido (também o da sala), ids iguais, ligação não confirmada ou o Activate(callId) deu false
    // (um convidado da sala).
    bool Split(int callId, int otherId);

    // true põe callId em espera (re-INVITE com sendonly; já em espera, nada muda); false é o Activate
    // (a outra ligação, se ativa, vai para a espera). Se outra renegociação da ligação ainda está em
    // andamento, espera até ~2 s que ela termine. false: id desconhecido (com true, também o da sala),
    // ligação não confirmada ou um convidado da sala.
    bool SetHold(int callId, bool hold);

    // Microfone mudo ou não, para a ligação de agora e as próximas (até trocar de novo); na
    // conferência, para as duas.
    void SetMute(bool muted);

    // Manda os dígitos (0-9, *, #, A-D) pelo método DTMF do perfil: info por SIP INFO; rfc2833, auto
    // e inband por RFC 2833. Com o id da sala, false: os dígitos não têm para quem ir.
    bool SendDtmf(int callId, const std::string& digits);

    // Transfere (REFER) para sip:<número>@<domínio da conta> (com a porta, como em MakeCall). O resultado
    // chega por OnTransfer; quando o outro lado avisa que deu certo (NOTIFY com 2xx), o motor desliga a
    // ligação. Com outra transferência ainda sem resultado, os dois motores fazem diferente: o do baresip
    // devolve false (sem REFER e sem OnTransfer), uma transferência por vez nas duas ligações juntas,
    // porque o fim com erro de uma não diz de qual ligação ele é; o do PJSIP manda o REFER (quem impede o
    // segundo pedido é o CallController). Com o id da sala, false.
    bool Transfer(int callId, const std::string& number);

    // A transferência com consulta: REFER com Replaces na ligação callId (o cliente, normalmente em
    // espera) apontando para a ligação targetCallId (o colega, normalmente a ativa), para o outro lado
    // ligar um ao outro. O resultado chega por OnTransfer(callId, ...); com 2xx o motor desliga as duas.
    // false: id desconhecido (também o da sala), ligação não confirmada, ids iguais ou o PJSIP (ou o
    // baresip) recusou (sem OnTransfer). Com outra transferência ainda sem resultado, como no Transfer: o
    // motor do baresip devolve false, e o do PJSIP manda o REFER.
    bool TransferAttended(int callId, int targetCallId);

    // Quantas ligações há (tocando, chamando ou em andamento: de 0 a 2, e até 6 com a sala), contando cada
    // uma até ela acabar no motor. A conta cai antes de o OnCallState(Disconnected) dela chegar ao listener (que vem
    // pela fila dos eventos): quem acompanha as ligações pelos eventos não usa o CallCount logo depois
    // de uma ação. HasCall é CallCount() > 0.
    int CallCount() const;
    bool HasCall() const;

    // Os dispositivos de som que o PJSIP enxerga, na ordem dele (o id é a posição na lista). Com nullAudio,
    // mais um no fim: o dispositivo nulo ("Null Audio", id -2). Vazio se o PJSIP falha ao listar. No motor
    // do baresip, quem escolhe o caminho do som é o iPhone: a lista é vazia (com nullAudio, só o
    // dispositivo nulo), e o SetAudioDevices e o RefreshAudioDevices não mudam nada no som.
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
    // número, o id de outra ligação (na conferência: 0 e a outra; na sala: 0 e os outros convidados que
    // estão nela). Vazio em espera, sem mídia, com id desconhecido e com o id da sala. No motor do PJSIP,
    // a ponte aplica as mudanças no tique seguinte do relógio dela (cerca de 20 ms); no do baresip, a
    // mistura da conferência é a do módulo mixminus.
    std::vector<int> AudioLinks(int callId) const;

private:
    friend struct SipEngineTestAccess;
    class Impl;
    explicit SipEngine(std::unique_ptr<Impl> impl);

    std::unique_ptr<Impl> impl_;
};

}  // namespace starsonic
