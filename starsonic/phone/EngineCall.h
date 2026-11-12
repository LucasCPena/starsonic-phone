#pragma once
// As ligações do motor (internas). EngineCall é a ligação do pjsua2, que recebe os callbacks do
// PJSIP; CallTable guarda as ligações (até duas: uma delas a ativa ou, na conferência, as duas juntas;
// ou os convidados da sala) e faz o que a API pede a elas.
//
// Vida de um EngineCall: a tabela cria o objeto (MakeCall ou ligação que chega) e ele se apaga no
// próprio último callback, o do fim da ligação, quando o pjsua2 já o desligou da ligação do PJSIP
// (nenhum callback chega a ele depois). Fora dos callbacks dele ninguém usa o objeto: a API fala com o
// PJSIP pelo id da ligação no pjsua. Apagar o objeto mais tarde seria pior: o destrutor do pj::Call
// mexe na vaga da ligação no pjsua, que a essa altura pode ser de outra ligação.
//
// A mesa de áudio (a ponte do pjsua): o que a tabela quer dela (a ativa, activeId_, a conferência,
// conference_, e os convidados da sala) fica com mutex_, e Route refaz a mesa a partir disso: depois de
// Focus e de Join, a cada mudança de mídia (um re-INVITE pode recriar a porta de uma ligação), no
// Confirmed de um convidado (ele entra na sala) e no fim da sala (quem ficou volta às regras de uma
// ligação comum). O fim de uma ligação não precisa de Route: a mesa tira a porta dela junto com as
// ligações que ela tinha. A ponte só enfileira os pedidos (aplica no tique seguinte do relógio,
// ~20 ms), então Route não se guia só pelo estado aplicado: guarda também o último pedido de cada par
// de portas (linksAsked_). Cada passada de Route vai do começo ao fim com routeMutex_ presa: as da API
// e as dos callbacks não se misturam, e a última lê o querer mais novo. routeMutex_ é pedida sem mutex_
// presa, às vezes com a trava de um diálogo (nos callbacks de mídia e de estado, que o pjsua chama sem
// a trava global dele); com ela presa só se chama pjsua_call_get_info e pjsua_conf_* (que pedem a
// trava global do pjsua e a da ponte, nenhuma de diálogo) e se pega mutex_ por um instante.
//
// O vídeo (só com o PJMEDIA_HAS_VIDEO; as funções dele ficam no EngineCallVideo.cpp, e os ganchos nos métodos de
// sempre, no EngineCall.cpp): o que a tabela sabe do vídeo de cada ligação (o desejo da câmera, as pausas, o
// 183 dos Porteiros, o vídeo negociado) fica com mutex_, e o OnCallVideo sai pelo Emit, com mutex_ presa, quando o
// CallVideo de uma ligação muda (PublishVideo). Vídeo só numa ligação sozinha: as pausas vêm do que a tabela quer, como
// a mesa de áudio, uma do envio (SendPaused) e outra da imagem que chega (ReceivePaused, que deixa a de um Porteiro
// seguir com a outra ligação), e o aviso já sai com a câmera desligada. O envio (o START_TRANSMIT e o STOP_TRANSMIT) só
// sai do SyncVideo, que confere o envio de verdade (a captura ligada ao stream) antes de mudá-lo: o pjsua recria o
// stream num re-INVITE que muda a mídia (o envio cai junto) e desfaz a mídia no fim da ligação, e o START dele não
// confere se o stream ainda existe, nem o STOP se a ligação mandava. Por isso o SyncVideo só roda no temporizador da
// tabela (OnEngineTimer), na thread do PJSIP: é nela que chegam as respostas, os re-INVITE e os BYE que mexem na mídia,
// um de cada vez, e nada muda a mídia entre a conferência do envio e o pedido ao pjsua. A API e os callbacks só pedem o
// temporizador (ScheduleSync); o Hangup e o End da API, que desfazem a mídia em outra thread, seguram videoMutex_ (a de
// cada passada do SyncVideo) em volta do pjsua_call_hangup. Com videoMutex_ presa só se chama o pjsua
// (pjsua_call_get_info, pjsua_call_set_vid_strm, pjsua_call_reinvite2, pjsua_call_hangup, a prévia e os parâmetros
// dos codecs, que pegam as travas dele, a de diálogo pelo try-lock do acquire_call), a lista de vídeo da PJSIP e
// mutex_, por um instante; nenhum callback (que roda com a trava do diálogo) a pede. Os parâmetros de fábrica dos
// codecs de vídeo só mudam com ela presa (a qualidade, e as prioridades e o fmtp do motor no SetVideoSettings): a PJSIP
// solta os textos de antes a cada mudança, e uma leitura ao mesmo tempo ficaria com eles soltos.
//
// A imagem e a câmera (também no EngineCallVideo.cpp): o desenhista nosso (VideoRenderer.h) pergunta à tabela, a cada
// quadro de uma ligação e com a trava dele presa, se o quadro sai (FrameGate): a pausa da imagem o segura, e o primeiro
// quadro liga o remote, que o temporizador do remote (RemoteTimer) desliga depois de 2 s sem quadro. A tabela nunca
// chama o desenhista com mutex_ presa: a ordem é videoMutex_, as travas do pjsua, a do desenhista e mutex_. A câmera
// abre e fecha com videoMutex_ presa: o envio de cada ligação no SyncVideo (na thread do PJSIP) e a prévia
// (SyncPreview, no SyncVideo e no teste da câmera, na thread da API), que roda enquanto o teste está ligado ou alguma
// ligação manda a imagem; a câmera aberta segue até fechar (o envio que começa usa a da prévia). Os problemas da câmera
// saem pela fila dos eventos (Problem). Enquanto alguma ligação manda a imagem (a câmera ou um lugar da sala), o
// temporizador do quadro-chave (KeyframeTimer, que o SyncVideo marca) pede um quadro-chave ao stream de cada uma a cada
// 3 s, no prazo dela (keyframeAt, que o envio que começa marca), com o SEND_KEYFRAME do pjsua e videoMutex_ presa, como
// o envio: o pedido que a PJSIP recusa por um quadro-chave há menos de 1 s (o PJ_ETOOMANY) volta em 1 s só para ela,
// sem adiantar o das outras, e o recusado por outro motivo (o PJ_EINVALIDOP do envio que acabou de parar) espera os
// 3 s de sempre; ele para quando nenhuma manda.
//
// A sala de vídeo em grupo (só com o PJMEDIA_HAS_VIDEO; as funções dela ficam no EngineRoom.cpp, e os ganchos nos
// métodos de sempre): a tabela tem uma vaga para cada convidado e mais uma. A sala nasce de uma ligação sozinha com o
// vídeo (RoomAdd), com um id do mesmo contador das ligações (roomId_), e as ligações dela são as vagas com o member,
// cada uma com o lugar dela (seat), a ordem de entrada (joined) e a espera pedida do outro lado (remoteHold). Elas não
// seguem a regra das duas ligações: na mesa de áudio, cada convidado na sala fica ligado ao nosso som e a cada outro
// (Route), e o vídeo de um não pausa pelos outros (SendPaused e ReceivePaused), com o desejo da câmera da sala
// (roomWish_). A sala é uma linha (o id dela no activeId_, no Focus e no Activate), e a outra, com ela de pé, é a
// ligação de fora (a vaga a mais), só de voz: a que chega toca sem o vídeo, e a do Make sai sem ele. Atendida ou feita,
// ela é a ativa, e você fica fora da sala (o out: o nosso som sai dos convidados, e a nossa câmera, dos mosaicos), sem
// re-INVITE para eles; o Activate do id da sala traz você de volta e a põe em espera, e o fim dela não traz. Com ela,
// a outra que chega recebe 486, e o Make dá -1. O OnRoom sai pelo Emit, com mutex_ presa, quando a sala muda
// (PublishRoom), comparada com a última avisada (roomShown_). Durante um makeCall (o do Make ou o do RoomAdd), o
// PublishRoom não avisa nada: o OnRoom do convidado novo vai para held_ antes do makeCall do RoomAdd (e some com os
// eventos dele se ele não sai; o roomShown_ só fica com ele se ele sai), e o fim de todo makeCall (FinishDial) avisa o
// que mudou no meio. Com um convidado só, ou nenhum, a sala acaba no PublishRoom: o OnRoom com o ended, e quem ficou
// volta a ser uma ligação comum (a ativa só se a sala era a ativa: com você fora, ela espera sem o nosso som e sem
// re-INVITE). O Hangup do id da sala a fecha (roomClosing_): ela só acaba sem ninguém, e até lá segue de pé para o
// Make e o Incoming (a ligação de fora), mas o Activate do id dela dá false.
//
// Os mosaicos da sala (RoomVideo.h; as funções deles também no EngineRoom.cpp): com dois ou mais convidados que já
// atenderam (também os em espera), cada um manda o mosaico dele, o lugar dele na sala (SendsSeat), no lugar da nossa
// câmera; com um só, ele manda a nossa câmera direto, como numa ligação comum. O SyncVideo troca a fonte de cada
// ligação pelo CHANGE_CAP_DEV (ao vivo, com a ligação mandando) e manda pelo START_TRANSMIT de sempre, com os ids do
// FindRoomDevices de cada passada. Com a sala de pé, ele também mantém a prévia do lugar 0 no desenhista nosso
// (SyncHostMosaic): o mosaico de quem montou, que sai com o id da sala, e cujo primeiro quadro, no portão, liga o
// remote da sala. O OnCallVideo da sala sai atrás do OnRoom dela (PublishRoom). O plano dos mosaicos (PlanRoom) é
// refeito com mutex_ presa a cada mudança da sala e do remote. A pjsua acha as janelas pelo id do dispositivo, que uma
// releitura da lista pode mudar: depois de uma releitura que muda algum id da sala com ela de pé (restartRoom_), uma
// passada para o envio de cada ligação da sala e a prévia do lugar 0 com os ids de antes, e a seguinte liga tudo de
// novo com os ids novos. Um passo da sala que falha (a troca da fonte ou o START de um lugar, a prévia do lugar 0) dá
// uma linha no log por sequência de falhas e volta numa passada kSyncRetryMs depois (o kRetryTimer).
//
// A qualidade (o desenho da sala, item 10): os parâmetros de fábrica dos codecs de vídeo (o tamanho, os quadros por
// segundo e a taxa do codificador dos próximos streams) ficam no alvo (TargetQuality): com a sala de pé, o teto pelo
// número de convidados, contando os chamados (RoomQuality); sem ela, a escolhida. Ele vai aos codecs quando muda
// (ApplyQuality, com videoMutex_ presa): na hora, no SetVideoSettings e no RoomAdd (antes do makeCall: o convidado novo
// nasce nele), e no SyncVideo, que acha as saídas e o fim da sala. Cada mudança sobe o qualitySerial_ uma vez, e o
// SyncVideo manda um re-INVITE com o vídeo a cada ligação da sala (ou à que ficou, no fim dela: stayed) confirmada, com
// o vídeo e com o codificador diferente do alvo, um por mudança (o qualitySerial dela), mesmo que o aparelho não chegue
// a ele: a pjsua refaz o stream com os parâmetros novos, sem o envio, que a passada seguinte liga de novo (com a linha
// "video: ..."). O que encontra outro re-INVITE em andamento (o PJ_EINVALIDOP) volta numa passada kReinviteRetryMs
// depois (o kReinviteTimer). A taxa da conta fica a da escolhida, o teto de todas.
#include <pjsua2.hpp>

#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "EngineEndpoint.h"
#include "EngineEvents.h"
#include "Profile.h"
#include "RoomVideo.h"
#include "SipEngine.h"
#include "Video.h"
#include "VideoRenderer.h"

namespace starsonic {

class CallTable;

// O vídeo que uma ligação que chega oferece: o primeiro m=video com a porta diferente de zero do INVITE.
struct VideoOffer {
    bool video = false;                 // a oferta tem um m=video com porta
    int index = -1;                     // a posição dele entre os m= da oferta (o media_dir da pjsua)
    std::vector<std::string> codecs;    // os nomes do a=rtpmap dele, na ordem dos formatos ("H264", "VP8"...)
};

// O VideoOffer do INVITE (rdata: o pjsip_rx_data, o pjRxData do OnIncomingCallParam); sem SDP, nenhum vídeo.
VideoOffer VideoOfferOf(void* rdata);

#if PJMEDIA_HAS_VIDEO
// O vídeo de uma ligação no PJSIP agora: a primeira mídia de vídeo com um stream.
struct VideoMedia {
    bool up = false;        // um stream de vídeo negociado (a porta nos dois lados)
    bool canSend = false;   // a direção negociada deixa mandar
    bool sending = false;   // a captura ligada ao stream (o START_TRANSMIT de pé)
    // O dispositivo que manda, com o envio de pé (a câmera ou um lugar da sala).
    pjmedia_vid_dev_index device = PJMEDIA_VID_INVALID_DEV;
    int index = -1;         // o índice dela na ligação
    // Do stream (só no MediaChanged, com a trava do diálogo): o codec e o codificador.
    std::string codec;
    int width = 0;
    int height = 0;
    int fps = 0;
};

// Do EngineCallVideo.cpp, para os ganchos do vídeo no EngineCall.cpp (o Incoming e o MediaChanged). O VideoMedia da
// ligação pjsuaId, ou o de uma leitura dela que já está feita (o pjsua_call_get_info).
VideoMedia VideoMediaOf(int pjsuaId);
VideoMedia VideoMediaOf(const pjsua_call_info& info);
void ReadVideoStream(int pjsuaId, VideoMedia* media);
bool CommonCodec(const std::vector<std::string>& offered, const VideoSettings& settings);
// O pjsua_call_setting do 180 ou do 183 de uma recebida, que o 200 repete igual: videoCount vídeos e, com
// recvOnlyIndex >= 0, o m= dessa posição só recebe (a recebida sem câmera).
pjsua_call_setting RingSetting(unsigned videoCount, int recvOnlyIndex);
// Os quadros da janela da imagem que chega da ligação pjsuaId (a pjsua a cria a cada stream de vídeo) passam a sair
// com o id callId. Sem a janela, nada.
void BindCallWindow(int pjsuaId, int callId);

// Os ids de agora, na lista de vídeo da PJSIP, da câmera escolhida (PJMEDIA_VID_INVALID_DEV sem câmera) e do
// desenhista nosso.
struct VideoDeviceIds {
    pjmedia_vid_dev_index camera = PJMEDIA_VID_INVALID_DEV;
    pjmedia_vid_dev_index renderer = PJMEDIA_VID_INVALID_DEV;
};

// As câmeras da lista de vídeo da PJSIP de agora, na ordem dela: o id e o nome como a PJSIP o dá.
std::vector<std::pair<pjmedia_vid_dev_index, std::string>> Cameras();
#endif

// Quanto SetHold espera uma renegociação anterior terminar (o PJSIP só aceita um re-INVITE por vez).
const int kRenegotiationWaitMs = 2000;

// Um pedido que renegocia a ligação (a espera, a retomada, o vídeo pedido, o sendrecv da sala): attempt é uma
// tentativa, com o código dela. Enquanto ele é o PJ_EINVALIDOP (a renegociação anterior ainda não terminou), outra
// tentativa a cada 10 ms, até kRenegotiationWaitMs depois da primeira. O código da última tentativa.
pj_status_t RetryWhileRenegotiating(const std::function<pj_status_t()>& attempt);

// Os callbacks chegam numa thread do PJSIP, ou na que chamou o PJSIP, sempre com a trava do diálogo
// da ligação.
class EngineCall : public pj::Call {
public:
    EngineCall(pj::Account& account, int pjsuaId, CallTable* table);

    void onCallState(pj::OnCallStateParam& param) override;
    void onCallMediaState(pj::OnCallMediaStateParam& param) override;
    void onCallTransferStatus(pj::OnCallTransferStatusParam& param) override;
    void onCallTransferRequest(pj::OnCallTransferRequestParam& param) override;
    void onCallReplaceRequest(pj::OnCallReplaceRequestParam& param) override;
    void onCallTsxState(pj::OnCallTsxStateParam& param) override;

private:
    CallTable* table_;
};

// Só a ligação ativa fica ligada ao dispositivo de som; a outra fica em espera (re-INVITE sendonly)
// ou, se ainda não foi atendida, sem som. Na conferência não há uma ativa: as duas ficam ligadas ao
// dispositivo e entre si. Na sala, a ativa é a sala (activeId_ é o id dela): os convidados na sala ficam
// ligados ao dispositivo e entre si; com a ligação de fora ativa (você fora da sala), só entre si.
class CallTable : public TimerTarget {
public:
    // Os ids dos temporizadores da tabela no EngineEndpoint (as contas usam os delas, que começam em 1): o SyncVideo,
    // o do remote, o do quadro-chave, o da passada que tenta de novo um passo da sala que falhou e o da que tenta de
    // novo um re-INVITE da qualidade. Os testes também os usam (o EngineEndpoint::FailNextSchedule).
    static constexpr int kCallTableTimer = 0;
    static constexpr int kRemoteTimer = -1;
    static constexpr int kKeyframeTimer = -2;
    static constexpr int kRetryTimer = -3;
    static constexpr int kReinviteTimer = -4;

    CallTable(EventQueue* events, DtmfMethod dtmf);

    CallTable(const CallTable&) = delete;
    CallTable& operator=(const CallTable&) = delete;

    // Do motor, depois do libStart e antes de qualquer ligação: os temporizadores da tabela (o SyncVideo fora dos
    // callbacks e o do remote), o portão dos quadros do desenhista e o aviso dos erros da captura. Sem o vídeo, nada.
    void Start(EngineEndpoint* endpoint);
    // Do motor, numa thread registrada no PJLIB, antes do libDestroy: o desenhista e os avisos da PJSIP deixam a
    // tabela.
    void Stop();

    // Do PJSIP. Incoming vem de EngineAccount::onIncomingCall; accepting = false recusa com 480. offer: o vídeo do
    // INVITE (VideoOfferOf).
    void Incoming(pj::Account& account, int pjsuaId, bool accepting, const VideoOffer& offer);
    void StateChanged(EngineCall* call, CallState state, int sipCode);
    // A mídia da ligação mudou (um re-INVITE pode recriá-la, com outra porta na mesa): a tabela refaz
    // as ligações da mesa.
    void MediaChanged(EngineCall* call);
    // O fim da ligação: o último evento dela e o fim do objeto (delete). Na conferência, a outra vira
    // a ativa.
    void Ended(EngineCall* call, int sipCode);
    // O resultado de uma transferência pedida em call: o aviso e, com 2xx, o fim dela (e o do colega,
    // na consulta). Pode apagar call: quem chama não mexe nele depois.
    void Transferred(EngineCall* call, int sipCode);
    // Um re-INVITE nosso recusado (resposta final sipCode, fora de 2xx): o vídeo que ele pedia, se pedia, foi recusado;
    // o sendrecv da ligação de onde a sala nasceu (SendReceive), se era ele, dá uma linha no log.
    void ReofferFailed(EngineCall* call, int sipCode);
    // O temporizador da tabela (ScheduleSync): o SyncVideo, fora dos callbacks das ligações.
    void OnEngineTimer() override;

    // Da API: thread registrada no PJLIB, um pedido por vez (o motor serializa). uri é a URI SIP inteira.
    // video: a oferta leva o vídeo (com o VideoEnabled; sem ele, o refused); sem o vídeo no motor, nunca, e com a sala
    // de pé também não, sem o refused (a ligação de fora é só de voz).
    int Make(pj::Account& account, const std::string& uri, bool video);
    bool Answer(int callId, bool video);
    bool Reject(int callId);
    bool Hangup(int callId);
    bool Activate(int callId);
    bool SetHold(int callId, bool hold);
    bool SendDtmf(int callId, const std::string& digits);
    bool Transfer(int callId, const std::string& uri);
    bool TransferAttended(int callId, int targetCallId);
    bool Join(int callId, int otherId);
    bool Split(int callId, int otherId);
    std::vector<int> AudioLinks(int callId);
    int CallCount();
    // O vídeo (ver SipEngine.h). Sem o vídeo no motor, SetCamera devolve false e Video, o CallVideo{}.
    bool SetCamera(int callId, bool on);
    void SetCameraPaused(bool paused);
    // As escolhas, e nos codecs, com videoMutex_ presa: primeiro engineCodecs (as prioridades e o fmtp do motor, o
    // ApplyVideoSettings dele), depois o alvo da qualidade, se mudou (com a sala de pé, os re-INVITE saem no
    // SyncVideo).
    void SetVideoSettings(const VideoSettings& settings, const std::function<void()>& engineCodecs);
    CallVideo Video(int callId);
#if PJMEDIA_HAS_VIDEO
    // As câmeras (ver SipEngine.h), da thread da API. Os ids da câmera escolhida e do desenhista, para a próxima vez
    // que a câmera abre.
    void SetVideoDevices(const VideoDeviceIds& ids);
    // A releitura da lista: refresh relê (o pjmedia_vid_dev_refresh) e devolve os ids novos, com a câmera parada no
    // meio (videoMutex_). A câmera em uso, pelo nome de quando ela abriu: fora da lista nova (também a que já tinha
    // saído dela), o Disconnected; noutro id, ela fecha e abre de novo. Com a sala de pé e algum id dela mudado, o
    // envio dela e o mosaico de quem montou também (restartRoom_). Uma volta já pedida segue pedida.
    void RefreshCameras(const std::function<VideoDeviceIds()>& refresh);
    bool StartCameraTest();
    void StopCameraTest();
#endif
    // A sala (ver SipEngine.h; EngineRoom.cpp). RoomAdd: uri é a URI SIP inteira do convidado; o id da ligação, ou -1
    // (sempre, sem o vídeo no motor). Room: a sala como o último OnRoom (RoomInfo{} sem sala), sem esperar a API.
    int RoomAdd(pj::Account& account, const std::string& uri);
    RoomInfo Room();

    // Desliga as ligações e espera até timeoutMs que os objetos delas sumam. false: não sumiram. A sala, se há, fecha
    // como no Hangup do id dela.
    bool End(int timeoutMs);
    // Daqui em diante nenhuma ligação nova (o motor está saindo): MakeCall dá -1 e as que chegam, 480.
    void Close();

private:
    // Uma vaga da tabela; livre com callId 0.
    struct Slot {
        EngineCall* call = nullptr;
        int callId = 0;                   // o id para o listener
        int pjsuaId = PJSUA_INVALID_ID;   // o id no pjsua (numa feita, depois do makeCall ou da mídia)
        bool held = false;                // posta em espera por aqui
        bool confirmed = false;           // já chegou ao Confirmed
        int transferTarget = 0;           // o colega (callId) da transferência com consulta em andamento
        // O vídeo (ver o topo do arquivo).
        unsigned videoCount = 0;          // os vídeos das ofertas e respostas dela (0 ou 1): o vid_cnt
        unsigned ringVideoCount = 0;      // o vid_cnt do 180 ou do 183 da recebida, que o 200 do Answer repete
        int ringRecvOnly = -1;            // o m=video que o 180 ou o 183 aceitou só para receber (sem câmera), ou -1
        bool wish = false;                // o desejo da câmera (MakeCall e Answer com vídeo, SetCamera)
        bool offered = false;             // a recebida oferece vídeo com um codec em comum
        bool early = false;               // o 183 de um Porteiro, até o atender
        bool doorphone = false;           // um Porteiro (junto com o early), do toque ao fim: a imagem dele segue com
                                          // a outra ligação (ReceivePaused)
        bool videoUp = false;             // o vídeo negociado (o último MediaChanged)
        bool canSend = false;             // a direção negociada deixa a câmera mandar
        bool askingVideo = false;         // uma oferta nossa com o vídeo espera a resposta: sem o vídeo nela, recusa
        bool transferring = false;        // um Transfer ou TransferAttended ainda sem resultado
        bool sending = false;             // o envio que o SyncVideo aplicou
        bool seatSending = false;         // ...e ele é o lugar da sala (o mosaico do convidado), e não a câmera
        bool sendFailed = false;          // o último START_TRANSMIT falhou (a linha "camera: falhou" já saiu)
        bool seatFailed = false;          // o último passo do lugar da sala falhou (a linha do log já saiu)
        bool receiveOnly = false;         // o vídeo só recebe por aqui (o media_dir DECODING, sem câmera), também nas
                                          // próximas ofertas e respostas: o pjsua o guarda
        bool askingSendRecv = false;      // o re-INVITE sendrecv do SendReceive espera a resposta
        bool remote = false;              // a imagem da outra ponta chegando (ver o topo do arquivo)
        std::chrono::steady_clock::time_point lastFrame;   // o último quadro da outra ponta que saiu
        std::chrono::steady_clock::time_point keyframeAt;  // mandando a imagem: o próximo pedido de quadro-chave dela
        std::string codec;                // o codec do vídeo negociado ("H264", "VP8" ou "VP9")
        int width = 0;                    // o codificador do vídeo negociado: o tamanho e os quadros por segundo
        int height = 0;
        int fps = 0;
        CallVideo shown;                  // o último OnCallVideo (sem o refused)
        // A sala (ver o topo do arquivo).
        bool member = false;              // um convidado da sala
        int seat = 0;                     // o lugar dele, de 1 a kRoomMaxGuests: o menor livre quando ele entrou
        bool remoteHold = false;          // o áudio em espera do outro lado (REMOTE_HOLD), do último MediaChanged
        int joined = 0;                   // a ordem de entrada na sala (a dos convidados no OnRoom)
        // A qualidade (ver o topo do arquivo).
        int qualitySerial = 0;            // o qualitySerial_ do último re-INVITE dela (ou do alvo em que ela nasceu)
        bool stayed = false;              // a que ficou no fim da sala, até o SyncVideo conferir o codificador dela
    };

    // Com mutex_ preso. A vaga de callId (ou de call), ou nullptr.
    Slot* Find(int callId);
    Slot* Find(const EngineCall* call);
    // Com mutex_ preso. Uma vaga livre, ou nullptr; outra vaga ocupada fora da sala que não é slot (sem a sala, há no
    // máximo duas ligações: a outra; com ela, a ligação de fora), ou nullptr; quantas vagas estão ocupadas.
    Slot* FreeSlot();
    Slot* Other(const Slot* slot);
    int Occupied();
    // O id no pjsua da ligação callId, se ela está na tabela; senão PJSUA_INVALID_ID.
    int PjsuaId(int callId);
    // callId vira a ativa (e a conferência, se havia, acaba): a outra, confirmada e fora da espera, vai
    // para a espera, e o dispositivo de som fica só com callId. Com a sala de pé, callId é o id dela (você volta para
    // ela, e a outra é a ligação de fora) ou a ligação de fora (você sai da sala, e nada vai para a espera).
    void Focus(int callId);
    // Põe em espera (re-INVITE sendonly) ou retoma (sendrecv), esperando a renegociação anterior.
    bool Renegotiate(int callId, bool hold);
    // Sem mutex_ presa. Refaz as ligações da mesa de áudio a partir do que a tabela quer: a ativa (ou,
    // na conferência, as duas) com o dispositivo de som, e na conferência as duas entre si; cada uma só
    // com a mídia ativa (ou em espera do outro lado). Na sala, cada convidado na sala (confirmado e fora
    // da espera do outro lado, só com a mídia ativa) com cada outro e, com a sala ativa, com o
    // dispositivo de som; um chamado ou em espera, com nada.
    void Route();
    // Com routeMutex_ presa: pede à mesa que source transmita (on) ou não para sink.
    void Link(int source, int sink, bool on);
    // Com mutex_ preso: o evento sai na hora ou, durante o makeCall do Make ou do RoomAdd, espera em held_.
    void Emit(int callId, EventQueue::Event event);
    // Sem mutex_ presa: o fim do makeCall de uma ligação feita (Make e RoomAdd), com dialing_ ligado desde antes dele;
    // made: ele saiu. Os eventos que esperaram em held_ saem, menos os dela se ela não saiu (o -1 sai sem evento
    // nenhum dela); a vaga fica com o id no pjsua, ou volta a ficar livre, e o objeto que o pjsua não usou é apagado.
    // settle, com mutex_ presa e depois dos eventos, é o que só quem discou faz (slot: a vaga dela, ou nullptr se ela
    // não está mais na tabela). Por fim, a sala, que ninguém avisa durante o makeCall: o que mudou nele, ou o fim
    // dela (e então o vídeo de quem ficou), e a mesa de áudio dela.
    void FinishDial(EngineCall* call, int callId, bool made, const std::function<void(Slot* slot)>& settle);

    // Com mutex_ preso. O envio da ligação está pausado (a nossa câmera não manda): a espera, a transferência, a
    // conferência ou a outra ligação (ver SipEngine::Video). Um convidado da sala não olha outra ligação: só a espera
    // daqui e a transferência dele.
    bool SendPaused(const Slot& slot);
    // Com mutex_ preso. A imagem que chega da ligação está pausada (o active, o remote e o portão dos quadros): a
    // espera, a transferência, a conferência ou a outra ligação, menos num Porteiro, cuja imagem segue com a outra
    // ligação. Um convidado da sala, como no SendPaused.
    bool ReceivePaused(const Slot& slot);
    // Com mutex_ preso. A câmera da ligação deve mandar agora (num convidado, só sozinho na sala, com o desejo da
    // câmera da sala e você nela).
    bool WantsToSend(const Slot& slot);
    // Com mutex_ preso. A ligação manda a imagem agora: o envio aplicado, e a tabela ainda o quer (a câmera, ou o lugar
    // da sala).
    bool SendsImage(const Slot& slot);
    // Com mutex_ preso. O CallVideo de agora da ligação (sem o refused).
    CallVideo Current(const Slot& slot);
    // Com mutex_ preso: o OnCallVideo de cada ligação cujo CallVideo mudou.
    void PublishVideo();
    // Com mutex_ preso: o OnCallVideo de uma recusa do vídeo (o refused, com os outros campos de agora).
    void Refuse(Slot& slot);
    // Com mutex_ preso: a linha "video: ..." do log, com o codificador e o envio da ligação.
    void LogVideo(const Slot& slot);
    // Só no temporizador da tabela (OnEngineTimer), sem trava nenhuma presa: liga e desliga o envio de cada ligação
    // como a tabela quer.
    void SyncVideo();
    // Qualquer thread, também num callback, sem mutex_ presa: um SyncVideo no temporizador da tabela, logo.
    void ScheduleSync();
    // Pede o vídeo numa ligação confirmada sem vídeo (re-INVITE com o vídeo), esperando a renegociação anterior. Sem
    // câmera, o vídeo pedido só recebe.
    bool AddVideo(int callId);

    // A sala (EngineRoom.cpp). Com mutex_ preso: quantos convidados há (contando os chamados); o lugar livre de menor
    // número, de 1 a kRoomMaxGuests (0: nenhum); por que o RoomAdd não sai agora (nullptr: ele sai), e a ligação de
    // onde a sala nasce, sem sala.
    int Members();
    int FreeSeat();
    const char* RoomAddRefusal(Slot** base);
    // Com mutex_ preso. A sala de agora (RoomInfo{} sem sala): os convidados pela ordem de entrada, cada um com o
    // estado, a imagem e o quadro dele no mosaico de quem montou.
    RoomInfo CurrentRoom();
    // Com mutex_ preso: o OnRoom da sala, se ela mudou desde o último (roomShown_), e atrás dele o OnCallVideo da sala,
    // se ele mudou. Com um convidado só ou nenhum (com a sala fechando, só sem nenhum), ela acaba: o último
    // OnCallVideo dela (o CallVideo{}) e o OnRoom com o ended (se o último avisado era dela), e quem ficou volta a ser
    // uma ligação comum, a ativa se a sala era a ativa. Durante um makeCall (dialing_), nada disso: o FinishDial o
    // chama depois. Por fim, sempre, o plano dos mosaicos (PlanRoom).
    void PublishRoom();
#if PJMEDIA_HAS_VIDEO
    // Com mutex_ preso, a sala de pé e fora de um makeCall: os avisos do PublishRoom.
    void AnnounceRoom();
#endif
    // Sem mutex_ presa. callId é o id da sala: ela fecha (ver o topo do arquivo), e a lista traz os ids no pjsua dos
    // convidados, para o Hangup. Senão, vazia.
    std::vector<int> CloseRoom(int callId);
    // Com mutex_ preso. Os convidados da sala, na ordem de entrada.
    std::vector<const Slot*> MembersInOrder();

#if PJMEDIA_HAS_VIDEO
    // Os mosaicos (EngineRoom.cpp; ver o topo do arquivo). Com mutex_ preso: a sala de pé com dois ou mais convidados
    // que já atenderam, também os em espera (cada um recebe o mosaico dele); o convidado manda o lugar dele agora
    // (confirmado, com o vídeo negociado e a direção que deixa mandar, sem olhar a câmera); a nossa câmera vai para os
    // mosaicos (o desejo da câmera da sala, fora da tela bloqueada e você nela: o kHostTile no live).
    bool RoomMosaic();
    bool SendsSeat(const Slot& slot);
    bool RoomCameraWanted();
    // Com mutex_ preso. O CallVideo de agora da sala (CallVideo{} sem sala): o active com ela de pé, o remote do
    // mosaico de quem montou e o camera da nossa câmera chegando aos convidados.
    CallVideo CurrentRoomVideo();
    // Com mutex_ preso: o plano dos mosaicos (RoomPlan{} sem sala) vai para a loja, se mudou.
    void PlanRoom();
    // Só no SyncVideo (com videoMutex_ presa, sem mutex_): com a sala de pé, a prévia do lugar 0 (host, o id de agora)
    // no desenhista nosso, ligada ao id da sala, e o tap da loja; sem sala (ou na passada da releitura, restart), a
    // prévia fecha pelo id com que abriu. Sem sala, nenhum tap. false: a prévia devia abrir e não abriu (a linha do log
    // sai uma vez por sequência de falhas).
    bool SyncHostMosaic(bool restart, pjmedia_vid_dev_index host);
    // Sem mutex_ presa: a ligação de onde a sala nasceu só recebia o vídeo (receiveOnly): um re-INVITE sendrecv, para
    // ela mandar o mosaico dela, esperando a renegociação anterior como o Renegotiate (a recusa vai ao ReofferFailed).
    void SendReceive(int callId);

    // A qualidade (ver o topo do arquivo). Com mutex_ presa (EngineRoom.cpp): o alvo de agora.
    QualityValues TargetQuality();
    // Com videoMutex_ presa, sem mutex_ (EngineCallVideo.cpp): o alvo vai aos codecs, se mudou desde o último (cada
    // mudança sobe o qualitySerial_ uma vez).
    void ApplyQuality();
    // Só no SyncVideo (com videoMutex_ presa, sem mutex_; EngineRoom.cpp): o re-INVITE de cada ligação da sala, ou da
    // que ficou no fim dela, que ainda não o recebeu por esta mudança do alvo e tem o codificador diferente dele. true:
    // algum encontrou outro re-INVITE em andamento (o PJ_EINVALIDOP), e uma passada daqui a pouco tenta de novo.
    bool ReinviteForQuality();

    // Os quadros das ligações que chegam ao desenhista (RemoteFrameGate) e o temporizador do remote.
    struct FrameGate : RemoteFrameGate {
        CallTable* table = nullptr;
        bool OnRemoteFrameArrived(int callId) override;
    };
    struct RemoteTimer : TimerTarget {
        CallTable* table = nullptr;
        void OnEngineTimer() override;
    };
    struct KeyframeTimer : TimerTarget {
        CallTable* table = nullptr;
        void OnEngineTimer() override;
    };
    struct RetryTimer : TimerTarget {
        CallTable* table = nullptr;
        void OnEngineTimer() override;
    };
    struct ReinviteTimer : TimerTarget {
        CallTable* table = nullptr;
        void OnEngineTimer() override;
    };
    // Na thread do desenhista, com a trava dele presa: a pausa da imagem segura o quadro, e o primeiro liga o remote. O
    // do mosaico de quem montou (o id da sala) liga o remote da sala, e o de uma sala que acabou não sai.
    bool RemoteFrameArrived(int callId);
    // No temporizador do remote: desliga o remote das ligações (e o da sala) sem quadro há 2 s e marca a próxima
    // conferência.
    void CheckRemote();
    // Com mutex_ presa: alguma ligação manda a imagem agora (SendsImage: a câmera, ou o mosaico de um convidado da
    // sala) e o temporizador do quadro-chave não está marcado. true: ele fica marcado, e quem chamou o agenda
    // (ScheduleKeyframes), sem mutex_ presa, daqui a *delayMs: o prazo mais cedo das que mandam (o keyframeAt).
    bool KeyframeTimerNeeded(unsigned* delayMs);
    // Só no temporizador do quadro-chave (OnEngineTimer), sem trava nenhuma presa; pega a videoMutex_, como o
    // SyncVideo: pede um quadro-chave ao stream de cada ligação que manda a imagem e cujo prazo chegou, e marca o
    // próximo prazo dela (mais cedo quando a PJSIP recusou o pedido dela); sem nenhuma mandando, o temporizador para.
    void SendKeyframes();
    // Sem mutex_ presa, com o temporizador do quadro-chave marcado: agenda-o para daqui a delayMs. Se o agendamento
    // falha, desmarca (o próximo SyncVideo marca de novo), em vez de deixar o quadro-chave parado até o fim do motor.
    void ScheduleKeyframes(unsigned delayMs);
    // Sem mutex_ presa, com o temporizador do remote marcado: agenda a próxima conferência. Se o agendamento falha,
    // desmarca (o próximo quadro marca de novo).
    void ScheduleRemoteCheck();
    // Sem mutex_ presa, no fim de um SyncVideo em que um passo da sala falhou: a passada que tenta de novo, daqui a
    // kSyncRetryMs, se ela ainda não está marcada (uma só por vez, por mais passadas que falhem). Se o agendamento
    // falha, desmarca (a próxima passada que falha marca de novo).
    void ScheduleRetry();
    // O mesmo para um re-INVITE da qualidade que encontrou outro em andamento: a passada daqui a kReinviteRetryMs.
    void ScheduleReinvite();
    // O aviso de um erro da câmera aberta (o PJMEDIA_EVENT_VID_DEV_ERROR da captura), numa thread da PJSIP.
    static pj_status_t OnMediaEvent(pjmedia_event* event, void* table);
    // Com mutex_ presa. A câmera em uso sumiu: o Disconnected, o desejo da câmera desliga em todas as ligações e o
    // teste da câmera para (o SyncVideo fecha a câmera).
    void LoseCamera();
    // Qualquer thread, com ou sem mutex_: o OnCameraProblem, pela fila dos eventos.
    void Problem(CameraProblem problem);
    // Com videoMutex_ presa (sem mutex_): a prévia roda com o teste da câmera ligado fora da tela bloqueada, com uma
    // ligação mandando a câmera ou com a câmera nos mosaicos da sala (RoomCameraWanted); device é a câmera para abrir.
    // PJ_SUCCESS, ou o código da prévia que não abriu.
    pj_status_t SyncPreview(pjmedia_vid_dev_index device);
    // Com videoMutex_ presa: fecha a prévia, se está aberta.
    void StopPreview();
    // Com videoMutex_ presa (sem mutex_): a prévia que o SyncVideo abriria não abriu (a câmera do teste, aberta de
    // novo depois de mudar de lugar na lista). A linha "camera: falhou" e o OpenFailed, se o START da mesma passada
    // (reported) já não os deu; o teste da câmera para, e o desejo da câmera das ligações que mandam a câmera (e o da
    // sala, se os mosaicos a queriam) desliga. true: alguma ligação mandava a câmera (a próxima passada para o envio
    // dela).
    bool PreviewFailed(pj_status_t status, bool reported);
#endif

    struct HeldEvent {
        int callId;
        EventQueue::Event event;
    };

    EventQueue* events_;
    const DtmfMethod dtmf_;
    std::mutex mutex_;
    std::condition_variable gone_;
    Slot slots_[kRoomMaxGuests + 1];  // os convidados da sala e mais uma; sem a sala, até duas ligações
    int activeId_ = 0;                // a ligação ativa, ou o id da sala (0: nenhuma, e na conferência)
    bool conference_ = false;         // as duas juntas (Join) até o Split, um Activate ou uma acabar
    int alive_ = 0;                   // objetos EngineCall que ainda não se apagaram
    int nextId_ = 1;                  // o próximo id, de uma ligação ou da sala
    bool dialing_ = false;            // Make ou RoomAdd está dentro do makeCall: os eventos esperam em held_
    std::vector<HeldEvent> held_;
    bool closed_ = false;
    VideoSettings settings_;          // as escolhas do vídeo (SetVideoSettings)
    bool cameraPaused_ = false;       // a tela bloqueada (SetCameraPaused)
    // A sala (ver o topo do arquivo), com mutex_.
    int roomId_ = 0;                  // o id da sala de pé (0: nenhuma)
    bool roomWish_ = false;           // o desejo da câmera da sala: o da ligação de onde ela nasceu
    bool roomClosing_ = false;        // o Hangup do id da sala (ou o End): ela só acaba sem nenhum convidado
    int joins_ = 0;                   // o joined do último convidado que entrou
    RoomInfo roomShown_;              // o último OnRoom (RoomInfo{} sem sala e depois do ended)

    EngineEndpoint* endpoint_ = nullptr;   // o temporizador da tabela (Start); não muda depois
    std::mutex videoMutex_;           // uma passada de SyncVideo, ou um fim de ligação pela API, por vez (o topo)
#if PJMEDIA_HAS_VIDEO
    FrameGate frameGate_;
    RemoteTimer remoteTimer_;
    KeyframeTimer keyframeTimer_;
    RetryTimer retryTimer_;
    ReinviteTimer reinviteTimer_;
    // Com mutex_ (a prévia muda também com videoMutex_ presa).
    pjmedia_vid_dev_index camera_ = PJMEDIA_VID_INVALID_DEV;     // a câmera escolhida (sem câmera: inválida)
    pjmedia_vid_dev_index renderer_ = PJMEDIA_VID_INVALID_DEV;   // o desenhista nosso
    bool cameraTest_ = false;           // o teste da câmera ligado
    bool previewRunning_ = false;       // a prévia aberta, na câmera previewDevice_
    pjmedia_vid_dev_index previewDevice_ = PJMEDIA_VID_INVALID_DEV;   // o id dela na lista de quando ela abriu
    std::string previewName_;           // ...e o nome: uma releitura pode dar esse id a outro dispositivo, ou a nenhum
    bool cameraLost_ = false;           // a câmera da prévia sumiu (o Disconnected já saiu), até a prévia fechar
    bool restartCamera_ = false;        // a câmera em uso mudou de lugar na lista: o SyncVideo fecha e abre de novo
    bool remoteCheckPending_ = false;   // o temporizador do remote está marcado
    bool keyframePending_ = false;      // o temporizador do quadro-chave está marcado
    bool retryPending_ = false;         // o temporizador da passada que tenta de novo está marcado
    bool reinvitePending_ = false;      // ...e o da que tenta de novo um re-INVITE da qualidade
    // A qualidade (ver o topo do arquivo), com mutex_: o alvo que está nos codecs e quantas vezes ele mudou.
    QualityValues quality_{};
    int qualitySerial_ = 0;
    // Os mosaicos da sala (ver o topo do arquivo), com mutex_.
    bool restartRoom_ = false;          // uma releitura mudou um id da sala de pé: o SyncVideo para tudo dela e religa
    bool roomRemote_ = false;           // o mosaico de quem montou chegando: o remote da sala
    std::chrono::steady_clock::time_point roomLastFrame_;   // o último quadro dele que saiu
    CallVideo roomVideoShown_;          // o último OnCallVideo da sala
    RoomPlan plan_;                     // o último plano que foi para a loja
    // A prévia do lugar 0 (o SyncHostMosaic): aberta no id hostDevice_ e ligada ao id da sala hostRoom_ (0: fechada).
    pjmedia_vid_dev_index hostDevice_ = PJMEDIA_VID_INVALID_DEV;
    int hostRoom_ = 0;
    bool hostFailed_ = false;           // a última abertura dela falhou (a linha do log já saiu)
#endif

    std::mutex routeMutex_;           // uma passada de Route por vez (ver o topo do arquivo)
    // Com routeMutex_: os pares (origem, destino) de portas da mesa que o último pedido ligou.
    std::set<std::pair<int, int>> linksAsked_;
};

}  // namespace starsonic
