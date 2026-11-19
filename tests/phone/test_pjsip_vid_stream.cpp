// O patch da PJSIP build/patches/pjproject/0001-vid-stream-para-o-envio-antes-da-trava.patch: o
// pjmedia_vid_stream_destroy para a thread de envio da stream antes de pegar a trava do grupo dela. Sem o patch, um
// destroy que chega com um pacote da stream em envio trava para sempre: ele pega a trava e espera a thread de envio, e
// a thread, depois de mandar o pacote, espera a mesma trava para devolver o buffer. Aqui, uma stream de vídeo da pjmedia
// sozinha (sem o pjsua), com o VP8 e um transporte nosso, cujo send_rtp segura os pacotes até o teste soltar. Só com o
// vídeo da PJSIP (o do Linux dos testes, como o do Windows).
#include <pjmedia/config.h>

#if PJMEDIA_HAS_VIDEO

#include <pjlib.h>
#include <pjmedia.h>
#include <pjmedia-codec/vpx.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "test_support.h"

namespace {

using Clock = std::chrono::steady_clock;

// As linhas da PJSIP do caso vão para um texto (as mensagens das falhas), e não para o terminal.
std::mutex logMutex;
std::string logText;

void CaptureLog(int /*level*/, const char* data, int len) {
    std::lock_guard<std::mutex> lock(logMutex);
    logText.append(data, static_cast<size_t>(len));
    if (logText.size() > 6000) logText.erase(0, logText.size() - 6000);
}

std::string LogTail() {
    std::lock_guard<std::mutex> lock(logMutex);
    return logText;
}

// Durante o caso, o registro da PJSIP vai para o CaptureLog; no fim, voltam a função e o nível de antes (os do pjsua,
// se um motor rodou antes).
class LogScope {
public:
    LogScope() : previous_(pj_log_get_log_func()), level_(pj_log_get_level()) {
        {
            std::lock_guard<std::mutex> lock(logMutex);
            logText.clear();
        }
        pj_log_set_log_func(&CaptureLog);
        pj_log_set_level(4);
    }
    ~LogScope() {
        pj_log_set_log_func(previous_);
        pj_log_set_level(level_);
    }
    LogScope(const LogScope&) = delete;
    LogScope& operator=(const LogScope&) = delete;

private:
    pj_log_func* previous_;
    int level_;
};

// O transporte da stream: o send_rtp segura cada pacote até o teste soltar (a thread de envio da stream fica presa no
// primeiro); o resto do que a stream chama do transporte (o attach, o detach e o RTCP) só responde que deu certo.
class HoldingTransport {
public:
    HoldingTransport() {
        pj_bzero(&op_, sizeof(op_));
        op_.attach2 = &Attach;
        op_.detach = &Detach;
        op_.send_rtp = &SendRtp;
        op_.send_rtcp = &SendRtcp;
        op_.send_rtcp2 = &SendRtcp2;
        pj_bzero(&transport_, sizeof(transport_));
        std::snprintf(transport_.name, sizeof(transport_.name), "segura-rtp");
        transport_.type = PJMEDIA_TRANSPORT_TYPE_USER;
        transport_.op = &op_;
        transport_.user_data = this;
    }
    HoldingTransport(const HoldingTransport&) = delete;
    HoldingTransport& operator=(const HoldingTransport&) = delete;

    pjmedia_transport* Get() { return &transport_; }

    // Espera a thread de envio entrar no send_rtp com um pacote.
    bool WaitHolding(std::chrono::milliseconds timeout) {
        std::unique_lock<std::mutex> lock(mutex_);
        return changed_.wait_for(lock, timeout, [this] { return holding_; });
    }

    // Solta o pacote preso e os que vierem depois.
    void Release() {
        std::lock_guard<std::mutex> lock(mutex_);
        released_ = true;
        changed_.notify_all();
    }

private:
    static HoldingTransport* Of(pjmedia_transport* tp) { return static_cast<HoldingTransport*>(tp->user_data); }

    static pj_status_t Attach(pjmedia_transport*, pjmedia_transport_attach_param*) { return PJ_SUCCESS; }
    static void Detach(pjmedia_transport*, void*) {}
    static pj_status_t SendRtcp(pjmedia_transport*, const void*, pj_size_t) { return PJ_SUCCESS; }
    static pj_status_t SendRtcp2(pjmedia_transport*, const pj_sockaddr_t*, unsigned, const void*, pj_size_t) {
        return PJ_SUCCESS;
    }

    static pj_status_t SendRtp(pjmedia_transport* tp, const void*, pj_size_t) {
        HoldingTransport* self = Of(tp);
        std::unique_lock<std::mutex> lock(self->mutex_);
        self->holding_ = true;
        self->changed_.notify_all();
        self->changed_.wait(lock, [self] { return self->released_; });
        return PJ_SUCCESS;
    }

    pjmedia_transport_op op_;
    pjmedia_transport transport_;
    std::mutex mutex_;
    std::condition_variable changed_;
    bool holding_ = false;
    bool released_ = false;
};

// A PJSIP mínima para uma stream de vídeo, sem o pjsua: o PJLIB, a fábrica de pools, o endpoint da pjmedia (sem
// threads), os gerentes do vídeo (os formatos, os avisos e os codecs), o VP8 da libvpx, o transporte e a stream. O
// destrutor desfaz o que o Start montou, na ordem inversa; a stream, só se ninguém a levou (o Hand).
class VideoBench {
public:
    VideoBench() = default;
    VideoBench(const VideoBench&) = delete;
    VideoBench& operator=(const VideoBench&) = delete;

    ~VideoBench() {
        if (stream_) {
            transport_.Release();
            pjmedia_vid_stream_destroy(stream_);
        }
        if (vpx_) pjmedia_codec_vpx_vid_deinit();
        if (codecs_) pjmedia_vid_codec_mgr_destroy(codecs_);
        if (events_) pjmedia_event_mgr_destroy(events_);
        if (formats_) pjmedia_video_format_mgr_destroy(formats_);
        if (endpt_) pjmedia_endpt_destroy2(endpt_);
        if (pool_) pj_pool_release(pool_);
        if (cacheReady_) pj_caching_pool_destroy(&cache_);
        if (initialized_) pj_shutdown();
    }

    void Start() {
        REQUIRE(pj_init() == PJ_SUCCESS);
        initialized_ = true;
        if (!pj_thread_is_registered()) {
            // Só quando outra thread já iniciou o PJLIB (este pj_init não registra esta). O PJLIB guarda o endereço do
            // descritor nesta thread, e o pj_shutdown do fim não leva a contagem a zero: o registro segue depois do
            // caso. Por isso o descritor é estático, e não da bancada, que sai da memória.
            static pj_thread_desc mainThreadDesc;
            pj_bzero(mainThreadDesc, sizeof(mainThreadDesc));
            pj_thread_t* thread = nullptr;
            REQUIRE(pj_thread_register("teste", mainThreadDesc, &thread) == PJ_SUCCESS);
        }
        pj_caching_pool_init(&cache_, &pj_pool_factory_default_policy, 0);
        cacheReady_ = true;
        pool_ = pj_pool_create(&cache_.factory, "teste", 4000, 4000, nullptr);
        REQUIRE(pool_ != nullptr);
        REQUIRE(pjmedia_endpt_create2(&cache_.factory, nullptr, 0, &endpt_) == PJ_SUCCESS);

        // Os gerentes são únicos no processo: o motor de um caso anterior já desmontou os dele (o libDestroy).
        REQUIRE_MESSAGE((pjmedia_video_format_mgr_instance() == nullptr && pjmedia_event_mgr_instance() == nullptr &&
                         pjmedia_vid_codec_mgr_instance() == nullptr),
                        "o video da PJSIP de outro caso ainda esta de pe");
        REQUIRE(pjmedia_video_format_mgr_create(pool_, 64, 0, &formats_) == PJ_SUCCESS);
        REQUIRE(pjmedia_event_mgr_create(pool_, 0, &events_) == PJ_SUCCESS);
        REQUIRE(pjmedia_vid_codec_mgr_create(pool_, &codecs_) == PJ_SUCCESS);
        REQUIRE(pjmedia_codec_vpx_vid_init(codecs_, &cache_.factory) == PJ_SUCCESS);
        vpx_ = true;
        CreateStream();
    }

    pjmedia_vid_stream* stream() const { return stream_; }
    HoldingTransport& transport() { return transport_; }

    // Entrega a stream a quem vai destruí-la: o destrutor não mexe mais nela.
    pjmedia_vid_stream* Hand() {
        pjmedia_vid_stream* stream = stream_;
        stream_ = nullptr;
        return stream;
    }

private:
    // Uma stream de vídeo só de envio, com o VP8 e o transporte que segura os pacotes, já começada. O controle de taxa
    // é o padrão, o mesmo do pjsua e do motor: a thread de envio (PJMEDIA_VID_STREAM_RC_SEND_THREAD).
    void CreateStream() {
        pj_str_t vp8 = pj_str(const_cast<char*>("VP8"));
        unsigned count = 1;
        const pjmedia_vid_codec_info* codec = nullptr;
        REQUIRE(pjmedia_vid_codec_mgr_find_codecs_by_id(codecs_, &vp8, &count, &codec, nullptr) == PJ_SUCCESS);
        REQUIRE(count == 1);

        pjmedia_vid_stream_info info;
        pj_bzero(&info, sizeof(info));
        info.type = PJMEDIA_TYPE_VIDEO;
        info.proto = PJMEDIA_TP_PROTO_RTP_AVP;
        info.dir = PJMEDIA_DIR_ENCODING;
        pj_str_t host = pj_str(const_cast<char*>("127.0.0.1"));
        REQUIRE(pj_sockaddr_init(pj_AF_INET(), &info.rem_addr, &host, 4000) == PJ_SUCCESS);
        info.codec_info = *codec;
        info.tx_pt = codec->pt;
        info.rx_pt = codec->pt;
        info.ssrc = static_cast<pj_uint32_t>(pj_rand());
        info.rtcp_sdes_bye_disabled = PJ_TRUE;
        pjmedia_vid_stream_rc_config_default(&info.rc_cfg);
        pjmedia_vid_stream_sk_config_default(&info.sk_cfg);
        REQUIRE(info.rc_cfg.method == PJMEDIA_VID_STREAM_RC_SEND_THREAD);

        REQUIRE(pjmedia_vid_stream_create(endpt_, nullptr, &info, transport_.Get(), nullptr, &stream_) == PJ_SUCCESS);
        REQUIRE(pjmedia_vid_stream_start(stream_) == PJ_SUCCESS);
    }

    bool initialized_ = false;
    bool cacheReady_ = false;
    pj_caching_pool cache_;
    pj_pool_t* pool_ = nullptr;
    pjmedia_endpt* endpt_ = nullptr;
    pjmedia_video_format_mgr* formats_ = nullptr;
    pjmedia_event_mgr* events_ = nullptr;
    pjmedia_vid_codec_mgr* codecs_ = nullptr;
    bool vpx_ = false;
    HoldingTransport transport_;
    pjmedia_vid_stream* stream_ = nullptr;
};

// Uma imagem cinza do tamanho da porta de codificação (I420) entra na stream: o VP8 a codifica e os pacotes vão para
// a fila da thread de envio.
void SendOneFrame(pjmedia_port* port) {
    const pjmedia_rect_size size = port->info.fmt.det.vid.size;
    std::vector<unsigned char> image(static_cast<size_t>(size.w) * size.h * 3 / 2, 128);
    pjmedia_frame frame;
    pj_bzero(&frame, sizeof(frame));
    frame.type = PJMEDIA_FRAME_TYPE_VIDEO;
    frame.buf = image.data();
    frame.size = image.size();
    REQUIRE(pjmedia_port_put_frame(port, &frame) == PJ_SUCCESS);
}

// A trava presa por outra thread: o tryacquire desta falha.
bool HeldElsewhere(pj_grp_lock_t* lock) {
    if (pj_grp_lock_tryacquire(lock) != PJ_SUCCESS) return true;
    pj_grp_lock_release(lock);
    return false;
}

bool WaitUntilMs(const std::function<bool()>& condition, int milliseconds) {
    const auto deadline = Clock::now() + std::chrono::milliseconds(milliseconds);
    while (!condition()) {
        if (Clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return true;
}

}  // namespace

TEST_CASE("the video stream destroy returns while its send thread is still sending a packet") {
    LogScope logScope;
    INFO(LogTail());
    std::unique_ptr<VideoBench> bench(new VideoBench);
    bench->Start();
    pjmedia_port* port = nullptr;
    REQUIRE(pjmedia_vid_stream_get_port(bench->stream(), PJMEDIA_DIR_ENCODING, &port) == PJ_SUCCESS);
    // A trava do grupo da stream: a porta de codificação usa a mesma.
    pj_grp_lock_t* streamLock = port->grp_lock;
    REQUIRE(streamLock != nullptr);

    SendOneFrame(port);
    REQUIRE_MESSAGE(bench->transport().WaitHolding(std::chrono::seconds(5)),
                    "a thread de envio da stream nao chegou ao send_rtp");

    // O destroy noutra thread, registrada no PJLIB, com a thread de envio presa no send_rtp. A promessa diz se o destroy
    // rodou (sem o registro, ele nem é chamado).
    auto destroyed = std::make_shared<std::promise<bool>>();
    std::future<bool> returned = destroyed->get_future();
    std::thread destroyer([stream = bench->Hand(), destroyed] {
        pj_thread_desc desc;
        pj_bzero(desc, sizeof(desc));
        pj_thread_t* thread = nullptr;
        const bool registered = pj_thread_register("destroy", desc, &thread) == PJ_SUCCESS;
        if (registered) pjmedia_vid_stream_destroy(stream);
        destroyed->set_value(registered);
    });

    // Sem o patch, o destroy pega a trava da stream e, com ela presa, espera a thread de envio: soltar o pacote depois
    // disso deixa o travamento certo (a thread, ao voltar do send_rtp, espera essa trava). Com o patch, ele espera a
    // thread antes de pegar a trava, e a trava fica livre: depois de 1 s, o pacote sai assim mesmo.
    WaitUntilMs([streamLock] { return HeldElsewhere(streamLock); }, 1000);
    bench->transport().Release();

    const bool back = returned.wait_for(std::chrono::seconds(5)) == std::future_status::ready;
    CHECK_MESSAGE(back, "o pjmedia_vid_stream_destroy nao voltou em 5 s (a PJSIP sem o patch 0001 trava aqui)");
    if (back) {
        destroyer.join();
        CHECK_MESSAGE(returned.get(), "a thread do destroy nao entrou no PJLIB");
    } else {
        // As duas threads ficam presas para sempre, com a stream, a PJSIP do caso e o transporte: nada disso pode sair
        // da memória. A suíte segue.
        destroyer.detach();
        static_cast<void>(bench.release());
    }
}

#endif
