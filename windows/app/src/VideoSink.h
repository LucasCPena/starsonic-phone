#pragma once
// A imagem do video ate a pagina (spec da videochamada, 6.4; docs/ponte-windows.md, "A memoria do video"): o FrameSink
// do motor (SipEngine::SetFrameSink, pelo EngineHost). Cada vista (remoto, local e porteiro) e uma memoria dividida com
// a pagina dela (a do WebView2, atras do SharedMemoryPages), e cada quadro vai, pela rota (FrameRouter.h), as vistas a
// vista, escrito pelo FrameWriter (FrameBuffer.h). C++ portatil.
//
// Threads:
// - As memorias so sao criadas, entregues e largadas na thread da janela (SetRouteState, PageReady, BrowserRestarted e
//   Close), porque o WebView2 so aceita essa thread. O SharedMemoryPages nunca e chamado com a trava presa.
// - Os quadros chegam nas threads de midia da PJSIP (OnRemoteFrame e OnLocalFrame) e so escrevem nas memorias que ja
//   existem: um quadro nunca cria uma memoria, e o de uma vista sem memoria e descartado. Eles copiam e voltam logo, e
//   nunca chamam o motor (nenhum metodo do SipEngine nem do EngineHost): uma thread da API pode estar esperando a trava
//   do desenhista com as travas do motor presas, e a entrega do quadro travaria com ela (Video.h).
// - Uma trava protege a rota e as memorias entre as threads de midia e a da janela. O BrowserRestarted e o Close largam
//   os ponteiros com a trava presa, antes do ReleaseAll: dali em diante, nenhum quadro chega a uma memoria largada.
//
// O limite de 30 quadros por segundo: um credito inteiro por vista, que comeca com 2000 pontos (com a memoria nova) e
// ganha 30 por milissegundo ate 2000; um quadro escrito gasta 1000, e o quadro sem os 1000 pontos e descartado. Assim
// a variacao de uma camera de 30 qps nao perde quadros (a folga de um quadro), e uma fonte mais rapida fica em 30.
//
// Fechar (main.cpp): o MainWindow chama o Close antes de o WebView fechar, e o VideoSink dura mais que o motor (ele e
// destruido depois do EngineHost::Stop, que leva o motor e o ultimo quadro dele).
#include <cstddef>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <vector>

#include "FrameBuffer.h"
#include "FrameRouter.h"
#include "Video.h"

namespace starsonic {

// A parte do WebView2, atras de uma interface; tudo na thread da janela.
class SharedMemoryPages {
public:
    virtual ~SharedMemoryPages() = default;
    virtual uint8_t* Create(ViewName view, size_t bytes) = 0;   // nullptr: nao deu
    virtual void Post(ViewName view) = 0;                       // entrega a memoria da vista a pagina dela
    virtual void ReleaseAll() = 0;                              // larga todas as memorias
};

class VideoSink : public FrameSink {
public:
    static constexpr int64_t kMaxCredit = 2000;
    static constexpr int64_t kCreditPerMs = 30;
    static constexpr int64_t kFrameCost = 1000;

    // nowMs: um relogio monotonico, em milissegundos (o credito), lido nas threads de midia.
    VideoSink(SharedMemoryPages& pages, std::function<int64_t()> nowMs);

    VideoSink(const VideoSink&) = delete;
    VideoSink& operator=(const VideoSink&) = delete;

    // Na thread da janela (a do WebView2). Depois do Close, nada.
    // A rota nova. Uma vista a vista sem memoria ganha a sua aqui (Create e Post); a escondida fica com a dela. A vista
    // cuja ligacao mudou (o remoto com o topCallId, o porteiro com o noticeCallId; tambem para o 0) esvazia (o seq 0),
    // e o local tambem, quando deixa de receber quadros (RouteLocal vazio).
    void SetRouteState(const RouteState& state);
    // A pagina carregou ou recarregou (o ready dela): entrega de novo as memorias dela (as do porteiro vao ao aviso, as
    // outras a janela principal).
    void PageReady(bool noticePage);
    // O ambiente novo (o navegador refeito): larga as memorias e cria as das vistas a vista. A entrega vai no PageReady
    // de cada pagina.
    void BrowserRestarted();
    // Antes de o WebView fechar: larga tudo; nenhum quadro depois.
    void Close();

    // Na thread de midia: so escrevem nas memorias que ja existem.
    void OnRemoteFrame(int callId, const I420Frame& frame) override;
    void OnLocalFrame(const I420Frame& frame) override;

private:
    // A memoria de uma vista e o escritor dela (sem memoria: os dois vazios), com o credito do limite.
    struct Slot {
        uint8_t* memory = nullptr;
        std::optional<FrameWriter> writer;
        int64_t credit = kMaxCredit;
        std::optional<int64_t> lastMs;   // o quadro anterior: o credito cresce com o tempo desde ele
    };

    Slot& SlotOf(ViewName view);
    // Com a trava: o quadro nas vistas da rota que tem memoria e credito.
    void Write(const std::vector<ViewName>& views, const I420Frame& frame, int64_t now);
    // Sem a trava: cada vista a vista sem memoria ganha a sua (e, com post, a entrega).
    void GiveMemories(bool post);
    // Com a trava: todas as vistas sem memoria (os ponteiros largados, antes do ReleaseAll).
    void DropMemories();
    // Com a trava: a vista vazia (FrameWriter::Clear), se ela tem memoria.
    void ClearView(ViewName view);

    SharedMemoryPages& pages_;
    std::function<int64_t()> nowMs_;
    std::mutex mutex_;
    RouteState state_;       // com a trava: as threads de midia decidem a rota por ele
    Slot slots_[3];          // com a trava: o remoto, o local e o porteiro
    bool closed_ = false;    // com a trava
};

}  // namespace starsonic
