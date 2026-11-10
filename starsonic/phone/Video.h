#pragma once
// Os tipos portáteis do vídeo (spec da videochamada, 4.2, 6.2 e 7): a qualidade, as escolhas do cartão Vídeo, a ordem
// dos codecs, os Porteiros, o vídeo de uma ligação, as câmeras, os problemas da câmera, o quadro I420 e quem recebe os
// quadros (FrameSink). Nada de PJSIP aqui: o núcleo e os testes do desktop usam estes tipos sem o motor.
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace starsonic {

enum class VideoCodec { H264, Vp8, Vp9 };
enum class VideoQuality { Low, Medium, High };

// Os nomes das escolhas na ponte e no admin.json: o codec "h264", "vp8" ou "vp9", e a qualidade "baixa", "media" ou
// "alta". Parse devolve nada para outro texto (nao muda a caixa).
const char* CodecKey(VideoCodec codec);
std::optional<VideoCodec> ParseCodecKey(const std::string& key);
const char* QualityKey(VideoQuality quality);
std::optional<VideoQuality> ParseQualityKey(const std::string& key);

// A imagem do codificador: largura e altura em pixels, quadros por segundo e a taxa em kbit/s.
struct QualityValues {
    int width;
    int height;
    int fps;
    int kbps;
};

// Os valores da spec (seção 7): Low 320x240, 15 qps, 300 kbit/s; Medium 640x480, 25 qps, 800 kbit/s; High 1280x720,
// 30 qps, 1500 kbit/s.
QualityValues ValuesOf(VideoQuality quality);

// O nome do codec no SDP (o a=rtpmap): "H264", "VP8" ou "VP9".
std::string CodecName(VideoCodec codec);

// As escolhas do vídeo (o cartão Vídeo da área do administrador), com os padrões de fábrica.
struct VideoSettings {
    bool h264 = true;
    bool vp8 = true;
    bool vp9 = false;
    VideoCodec first = VideoCodec::H264;
    VideoQuality quality = VideoQuality::Medium;
    bool h264Available = false;                // o módulo carregado (Windows) ou o OpenH264 do sistema (testes)
    std::vector<std::string> doorphones;       // os Porteiros, só dígitos
};

// Os codecs ligados e disponíveis, do mais para o menos preferido: o first na frente (se estiver ligado e disponível) e
// os outros na ordem H.264, VP8, VP9. O H.264 só entra com o h264Available.
std::vector<VideoCodec> CodecOrder(const VideoSettings& settings);

// Há vídeo: algum codec ligado e disponível (!CodecOrder(settings).empty()).
bool VideoEnabled(const VideoSettings& settings);

// O usuário (o do From de quem liga) é um dos Porteiros. Compara só os dígitos dos dois lados; sem dígito, false.
bool IsDoorphone(const VideoSettings& settings, const std::string& user);

// O vídeo de uma ligação, como o motor o avisa (EngineListener::OnCallVideo) e o devolve (SipEngine::Video).
struct CallVideo {
    bool offered = false;   // a recebida oferece vídeo com um codec em comum
    bool active = false;    // o vídeo negociado e a ligação sem pausa
    bool remote = false;    // a imagem da outra ponta chegando: o primeiro quadro liga; 2 s sem quadro, a pausa e o
                            // fim desligam
    bool camera = false;    // a nossa câmera mandando agora
    bool early = false;     // o 183 com SDP de um Porteiro, até o atender ou o fim
    bool refused = false;   // só no evento de uma recusa do vídeo
};

bool operator==(const CallVideo& a, const CallVideo& b);

struct VideoDevice { std::string name; };   // só as câmeras; o nosso dispositivo de saída não entra

// O problema da câmera que o motor avisa (EngineListener::OnCameraProblem): nenhuma câmera quando ela foi pedida, a
// câmera que não abre (em uso por outro programa, bloqueada pelo Windows) e a câmera em uso que some.
enum class CameraProblem { NoCamera, OpenFailed, Disconnected };

// Um quadro I420 (os três planos, cada um com o seu passo em bytes). Os ponteiros só valem durante a chamada que o
// entrega.
struct I420Frame {
    int width = 0;
    int height = 0;
    const uint8_t* y = nullptr; int yStride = 0;
    const uint8_t* u = nullptr; int uStride = 0;
    const uint8_t* v = nullptr; int vStride = 0;
};

// Quem recebe os quadros do motor (SipEngine::SetFrameSink): os da outra ponta de cada ligação e os da nossa câmera.
// O sink não chama o motor (nenhum método do SipEngine): a entrega do quadro travaria com uma chamada à API em
// andamento.
class FrameSink {
public:
    virtual ~FrameSink() = default;
    // Na thread de mídia da PJSIP: copie e volte logo; o quadro só vale durante a chamada.
    virtual void OnRemoteFrame(int callId, const I420Frame& frame) = 0;
    virtual void OnLocalFrame(const I420Frame& frame) = 0;
};

}  // namespace starsonic
