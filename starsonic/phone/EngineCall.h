#pragma once
// As ligações do motor (internas). EngineCall é a ligação do pjsua2, que recebe os callbacks do
// PJSIP; CallTable guarda as ligações (até duas: uma delas a ativa ou, na conferência, as duas juntas)
// e faz o que a API pede a elas.
//
// Vida de um EngineCall: a tabela cria o objeto (MakeCall ou ligação que chega) e ele se apaga no
// próprio último callback, o do fim da ligação, quando o pjsua2 já o desligou da ligação do PJSIP
// (nenhum callback chega a ele depois). Fora dos callbacks dele ninguém usa o objeto: a API fala com o
// PJSIP pelo id da ligação no pjsua. Apagar o objeto mais tarde seria pior: o destrutor do pj::Call
// mexe na vaga da ligação no pjsua, que a essa altura pode ser de outra ligação.
//
// A mesa de áudio (a ponte do pjsua): o que a tabela quer dela (a ativa, activeId_, e a conferência,
// conference_) fica com mutex_, e Route refaz a mesa a partir disso: depois de Focus e de Join e a
// cada mudança de mídia (um re-INVITE pode recriar a porta de uma ligação). O fim de uma ligação não
// precisa de Route: a mesa tira a porta dela junto com as ligações que ela tinha. A ponte só enfileira
// os pedidos (aplica no tique seguinte do relógio, ~20 ms), então Route não se guia só pelo estado
// aplicado: guarda também o último pedido de cada par de portas (linksAsked_). Cada passada de Route
// vai do começo ao fim com routeMutex_ presa: as da API e as dos callbacks de mídia não se misturam, e
// a última lê o querer mais novo. routeMutex_ é pedida sem mutex_ presa, às vezes com a trava de um
// diálogo (no callback de mídia, que o pjsua chama sem a trava global dele); com ela presa só se chama
// pjsua_call_get_info e pjsua_conf_* (que pedem a trava global do pjsua e a da ponte, nenhuma de
// diálogo) e se pega mutex_ por um instante.
//
// O vídeo (só com o PJMEDIA_HAS_VIDEO; as funções dele ficam no EngineCallVideo.cpp, e os ganchos nos métodos de
// sempre, no EngineCall.cpp): o que a tabela sabe do vídeo de cada ligação (o desejo da câmera, a pausa, o
// 183 dos Porteiros, o vídeo negociado) fica com mutex_, e o OnCallVideo sai pelo Emit, com mutex_ presa, quando o
// CallVideo de uma ligação muda (PublishVideo). Uma ligação com vídeo por vez: a pausa (Paused) vem do que a tabela
// quer, como a mesa de áudio, e o aviso já sai com a câmera desligada. O envio (o START_TRANSMIT e o STOP_TRANSMIT) só
// sai do SyncVideo, que confere o envio de verdade (a captura ligada ao stream) antes de mudá-lo: o pjsua recria o
// stream num re-INVITE que muda a mídia (o envio cai junto) e desfaz a mídia no fim da ligação, e o START dele não
// confere se o stream ainda existe, nem o STOP se a ligação mandava. Por isso o SyncVideo só roda no temporizador da
// tabela (OnEngineTimer), na thread do PJSIP: é nela que chegam as respostas, os re-INVITE e os BYE que mexem na mídia,
// um de cada vez, e nada muda a mídia entre a conferência do envio e o pedido ao pjsua. A API e os callbacks só pedem o
// temporizador (ScheduleSync); o Hangup e o End da API, que desfazem a mídia em outra thread, seguram videoMutex_ (a de
// cada passada do SyncVideo) em volta do pjsua_call_hangup. Com videoMutex_ presa só se chama o pjsua
// (pjsua_call_get_info, pjsua_call_set_vid_strm, pjsua_call_hangup e a prévia, que pegam as travas dele, a de diálogo
// pelo try-lock do acquire_call), a lista de vídeo da PJSIP e mutex_, por um instante; nenhum callback (que roda com a
// trava do diálogo) a pede.
//
// A imagem e a câmera (também no EngineCallVideo.cpp): o desenhista nosso (VideoRenderer.h) pergunta à tabela, a cada
// quadro de uma ligação e com a trava dele presa, se o quadro sai (FrameGate): a pausa o segura, e o primeiro quadro
// liga o remote, que o temporizador do remote (RemoteTimer) desliga depois de 2 s sem quadro. A tabela nunca chama o
// desenhista com mutex_ presa: a ordem é videoMutex_, as travas do pjsua, a do desenhista e mutex_. A câmera abre e
// fecha com videoMutex_ presa: o envio de cada ligação no SyncVideo (na thread do PJSIP) e a prévia (SyncPreview, no
// SyncVideo e no teste da câmera, na thread da API), que roda enquanto o teste está ligado ou alguma ligação manda a
// imagem; a câmera aberta segue até fechar (o envio que começa usa a da prévia). Os problemas da câmera saem pela fila
// dos eventos (Problem).
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
    int index = -1;         // o índice dela na ligação
    // Do stream (só no MediaChanged, com a trava do diálogo): o codec e o codificador.
    std::string codec;
    int width = 0;
    int height = 0;
    int fps = 0;
};

// Do EngineCallVideo.cpp, para os ganchos do vídeo no EngineCall.cpp (o Incoming e o MediaChanged).
VideoMedia VideoMediaOf(int pjsuaId);
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
// dispositivo e entre si.
class CallTable : public TimerTarget {
public:
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
    // Um re-INVITE nosso recusado (resposta final fora de 2xx): o vídeo que ele pedia, se pedia, foi recusado.
    void ReofferFailed(EngineCall* call);
    // O temporizador da tabela (ScheduleSync): o SyncVideo, fora dos callbacks das ligações.
    void OnEngineTimer() override;

    // Da API: thread registrada no PJLIB, um pedido por vez (o motor serializa). uri é a URI SIP inteira.
    // video: a oferta leva o vídeo (com o VideoEnabled; sem ele, o refused); sem o vídeo no motor, nunca.
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
    void SetVideoSettings(const VideoSettings& settings);
    CallVideo Video(int callId);
#if PJMEDIA_HAS_VIDEO
    // As câmeras (ver SipEngine.h), da thread da API. Os ids da câmera escolhida e do desenhista, para a próxima vez
    // que a câmera abre.
    void SetVideoDevices(const VideoDeviceIds& ids);
    // A releitura da lista: refresh relê (o pjmedia_vid_dev_refresh) e devolve os ids novos, com a câmera parada no
    // meio (videoMutex_). A câmera em uso que sumiu é o Disconnected; a que mudou de lugar fecha e abre de novo.
    void RefreshCameras(const std::function<VideoDeviceIds()>& refresh);
    bool StartCameraTest();
    void StopCameraTest();
#endif

    // Desliga as ligações e espera até timeoutMs que os objetos delas sumam. false: não sumiram.
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
        bool videoUp = false;             // o vídeo negociado (o último MediaChanged)
        bool canSend = false;             // a direção negociada deixa a câmera mandar
        bool askingVideo = false;         // uma oferta nossa com o vídeo espera a resposta: sem o vídeo nela, recusa
        bool transferring = false;        // um Transfer ou TransferAttended ainda sem resultado
        bool sending = false;             // o envio que o SyncVideo aplicou
        bool sendFailed = false;          // o último START_TRANSMIT falhou (a linha "camera: falhou" já saiu)
        bool remote = false;              // a imagem da outra ponta chegando (ver o topo do arquivo)
        std::chrono::steady_clock::time_point lastFrame;   // o último quadro da outra ponta que saiu
        std::string codec;                // o codec do vídeo negociado ("H264", "VP8" ou "VP9")
        int width = 0;                    // o codificador do vídeo negociado: o tamanho e os quadros por segundo
        int height = 0;
        int fps = 0;
        CallVideo shown;                  // o último OnCallVideo (sem o refused)
    };

    // Com mutex_ preso. A vaga de callId (ou de call), ou nullptr.
    Slot* Find(int callId);
    Slot* Find(const EngineCall* call);
    // Com mutex_ preso. Uma vaga livre, ou nullptr; a outra vaga, se está ocupada, ou nullptr.
    Slot* FreeSlot();
    Slot* Other(const Slot* slot);
    // O id no pjsua da ligação callId, se ela está na tabela; senão PJSUA_INVALID_ID.
    int PjsuaId(int callId);
    // callId vira a ativa (e a conferência, se havia, acaba): a outra, confirmada e fora da espera, vai
    // para a espera, e o dispositivo de som fica só com callId.
    void Focus(int callId);
    // Põe em espera (re-INVITE sendonly) ou retoma (sendrecv), esperando a renegociação anterior.
    bool Renegotiate(int callId, bool hold);
    // Sem mutex_ presa. Refaz as ligações da mesa de áudio a partir do que a tabela quer: a ativa (ou,
    // na conferência, as duas) com o dispositivo de som, e na conferência as duas entre si; cada uma só
    // com a mídia ativa (ou em espera do outro lado).
    void Route();
    // Com routeMutex_ presa: pede à mesa que source transmita (on) ou não para sink.
    void Link(int source, int sink, bool on);
    // Com mutex_ preso: o evento sai na hora ou, durante o makeCall de Make, espera em held_.
    void Emit(int callId, EventQueue::Event event);

    // Com mutex_ preso. A ligação está pausada: uma ligação com vídeo por vez (ver SipEngine::Video).
    bool Paused(const Slot& slot);
    // Com mutex_ preso. A câmera da ligação deve mandar agora.
    bool WantsToSend(const Slot& slot);
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

#if PJMEDIA_HAS_VIDEO
    // Os quadros das ligações que chegam ao desenhista (RemoteFrameGate) e o temporizador do remote.
    struct FrameGate : RemoteFrameGate {
        CallTable* table = nullptr;
        bool OnRemoteFrameArrived(int callId) override;
    };
    struct RemoteTimer : TimerTarget {
        CallTable* table = nullptr;
        void OnEngineTimer() override;
    };
    // Na thread do desenhista, com a trava dele presa: a pausa segura o quadro, e o primeiro liga o remote.
    bool RemoteFrameArrived(int callId);
    // No temporizador do remote: desliga o remote das ligações sem quadro há 2 s e marca a próxima conferência.
    void CheckRemote();
    // O aviso de um erro da câmera aberta (o PJMEDIA_EVENT_VID_DEV_ERROR da captura), numa thread da PJSIP.
    static pj_status_t OnMediaEvent(pjmedia_event* event, void* table);
    // Com mutex_ presa. A câmera em uso sumiu: o Disconnected, o desejo da câmera desliga em todas as ligações e o
    // teste da câmera para (o SyncVideo fecha a câmera).
    void LoseCamera();
    // Qualquer thread, com ou sem mutex_: o OnCameraProblem, pela fila dos eventos.
    void Problem(CameraProblem problem);
    // Com videoMutex_ presa (sem mutex_): a prévia roda com o teste da câmera ligado fora da tela bloqueada, ou com uma
    // ligação mandando a imagem; device é a câmera para abrir. PJ_SUCCESS, ou o código da prévia que não abriu.
    pj_status_t SyncPreview(pjmedia_vid_dev_index device);
    // Com videoMutex_ presa: fecha a prévia, se está aberta.
    void StopPreview();
    // Com videoMutex_ presa (sem mutex_): a prévia que o SyncVideo abriria não abriu (a câmera do teste, aberta de
    // novo depois de mudar de lugar na lista). A linha "camera: falhou" e o OpenFailed, se o START da mesma passada
    // (reported) já não os deu; o teste da câmera para, e o desejo da câmera das ligações que mandam desliga. true:
    // alguma ligação mandava (a próxima passada para o envio dela).
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
    Slot slots_[2];
    int activeId_ = 0;                // a ligação ativa (0: nenhuma, e na conferência)
    bool conference_ = false;         // as duas juntas (Join) até o Split, um Activate ou uma acabar
    int alive_ = 0;                   // objetos EngineCall que ainda não se apagaram
    int nextId_ = 1;
    bool dialing_ = false;            // Make está dentro do makeCall: os eventos esperam em held_
    std::vector<HeldEvent> held_;
    bool closed_ = false;
    VideoSettings settings_;          // as escolhas do vídeo (SetVideoSettings)
    bool cameraPaused_ = false;       // a tela bloqueada (SetCameraPaused)

    EngineEndpoint* endpoint_ = nullptr;   // o temporizador da tabela (Start); não muda depois
    std::mutex videoMutex_;           // uma passada de SyncVideo, ou um fim de ligação pela API, por vez (o topo)
#if PJMEDIA_HAS_VIDEO
    FrameGate frameGate_;
    RemoteTimer remoteTimer_;
    // Com mutex_ (a prévia muda também com videoMutex_ presa).
    pjmedia_vid_dev_index camera_ = PJMEDIA_VID_INVALID_DEV;     // a câmera escolhida (sem câmera: inválida)
    pjmedia_vid_dev_index renderer_ = PJMEDIA_VID_INVALID_DEV;   // o desenhista nosso
    bool cameraTest_ = false;           // o teste da câmera ligado
    bool previewRunning_ = false;       // a prévia aberta, na câmera previewDevice_
    pjmedia_vid_dev_index previewDevice_ = PJMEDIA_VID_INVALID_DEV;
    bool cameraLost_ = false;           // a câmera da prévia sumiu (o Disconnected já saiu), até a prévia fechar
    bool restartCamera_ = false;        // a câmera em uso mudou de lugar na lista: o SyncVideo fecha e abre de novo
    bool remoteCheckPending_ = false;   // o temporizador do remote está marcado
#endif

    std::mutex routeMutex_;           // uma passada de Route por vez (ver o topo do arquivo)
    // Com routeMutex_: os pares (origem, destino) de portas da mesa que o último pedido ligou.
    std::set<std::pair<int, int>> linksAsked_;
};

}  // namespace starsonic
