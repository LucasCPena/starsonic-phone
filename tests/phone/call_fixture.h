#pragma once
// Apoio aos testes de ligações do motor: o Phone (um motor registrado no registrador falso, com as esperas das
// ligações) e as funções que leem os eventos de ligação que o listener guardou.
#include "engine_fixture.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "Profile.h"
#include "SipEngine.h"
#include "Video.h"

namespace phone_test {

using starsonic::CallState;
using starsonic::Profile;
using starsonic::SipEngine;
using starsonic::Transport;

using Lines = std::vector<std::string>;

// O evento `kind` mais recente; em State, o mais recente OnCallState(callId, state). Falha o teste
// se não houve.
inline CallEvent Last(const std::vector<CallEvent>& events, CallEvent::Kind kind, int callId = 0,
                      CallState state = CallState::Incoming) {
    for (auto it = events.rbegin(); it != events.rend(); ++it) {
        if (it->kind == kind && (kind != CallEvent::State || (it->callId == callId && it->state == state))) {
            return *it;
        }
    }
    FAIL("o evento esperado nao chegou");
    return CallEvent();
}

// Os eventos da ligação callId em ordem: "Incoming" para OnIncomingCall, "<estado>/<código>" para
// OnCallState e "Transfer/<código>" para OnTransfer, como "Incoming Early/180 Confirmed/200". Com o id
// de uma sala, "Room" para cada OnRoom dela.
inline std::string History(const std::vector<CallEvent>& events, int callId) {
    std::string text;
    for (const CallEvent& event : events) {
        if (event.callId != callId) continue;
        if (!text.empty()) text += " ";
        if (event.kind == CallEvent::Incoming) {
            text += "Incoming";
        } else if (event.kind == CallEvent::Transfer) {
            text += "Transfer/" + std::to_string(event.code);
        } else if (event.kind == CallEvent::Room) {
            text += "Room";
        } else {
            text += std::string(phone_test::StateName(event.state)) + "/" + std::to_string(event.code);
        }
    }
    return text;
}

// Os códigos dos OnTransfer da ligação callId, em ordem.
inline std::vector<int> Transfers(const std::vector<CallEvent>& events, int callId) {
    std::vector<int> codes;
    for (const CallEvent& event : events) {
        if (event.kind == CallEvent::Transfer && event.callId == callId) codes.push_back(event.code);
    }
    return codes;
}

// Os itens em ordem crescente: o AudioLinks não promete ordem.
inline std::vector<int> Sorted(std::vector<int> items) {
    std::sort(items.begin(), items.end());
    return items;
}

// Um FrameSink de teste: guarda o id, o tamanho e a hora de cada quadro (os da prévia com o id kLocal, como o
// kLocalFrames do desenhista) e uma cópia da última imagem de cada id. Os quadros chegam na thread do vídeo da PJSIP.
class TestSink : public starsonic::FrameSink {
public:
    static constexpr int kLocal = -1;
    using Clock = std::chrono::steady_clock;

    struct Frame {
        int callId;
        int width;
        int height;
        Clock::time_point at;
    };

    void OnRemoteFrame(int callId, const starsonic::I420Frame& frame) override { Add(callId, frame); }
    void OnLocalFrame(const starsonic::I420Frame& frame) override { Add(kLocal, frame); }

    std::vector<Frame> Frames() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return frames_;
    }

    // Quantos quadros do id chegaram depois de since; com width > 0, só os desse tamanho.
    size_t Count(int callId, int width = 0, int height = 0, Clock::time_point since = Clock::time_point()) const {
        std::lock_guard<std::mutex> lock(mutex_);
        return static_cast<size_t>(std::count_if(frames_.begin(), frames_.end(), [&](const Frame& frame) {
            return frame.callId == callId && frame.at > since &&
                   (width <= 0 || (frame.width == width && frame.height == height));
        }));
    }

    // Quantos quadros, de qualquer id, chegaram depois de since.
    size_t CountAll(Clock::time_point since) const {
        std::lock_guard<std::mutex> lock(mutex_);
        return static_cast<size_t>(
            std::count_if(frames_.begin(), frames_.end(), [&](const Frame& frame) { return frame.at > since; }));
    }

    // Espera até `seconds` que o Count(callId, width, height) chegue a count.
    bool WaitFor(int callId, size_t count, int seconds, int width = 0, int height = 0) const {
        const auto deadline = Clock::now() + std::chrono::seconds(seconds);
        while (Count(callId, width, height) < count) {
            if (Clock::now() >= deadline) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return true;
    }

    // Um pixel de uma imagem, em Y, U e V.
    struct Yuv {
        int y;
        int u;
        int v;
    };

    // O pixel do último quadro do id, na fração da largura (fx) e da altura (fy), de 0 a 1 do canto de cima à
    // esquerda; o U e o V são os do bloco 2x2 dele. Sem valor se nenhum quadro do id chegou.
    std::optional<Yuv> PixelAt(int callId, double fx, double fy) const {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto found = last_.find(callId);
        if (found == last_.end()) return std::nullopt;
        const Image& image = found->second;
        const int x = Clamped(static_cast<int>(fx * image.width), image.width);
        const int y = Clamped(static_cast<int>(fy * image.height), image.height);
        const size_t chroma = static_cast<size_t>(y / 2) * static_cast<size_t>((image.width + 1) / 2) + x / 2;
        return Yuv{image.y[static_cast<size_t>(y) * image.width + x], image.u[chroma], image.v[chroma]};
    }

    // Espera até `seconds` que o PixelAt(callId, fx, fy) esteja a no máximo `tolerance` de `color`, em cada plano.
    bool WaitForColor(int callId, double fx, double fy, Yuv color, int tolerance, int seconds) const {
        const auto deadline = Clock::now() + std::chrono::seconds(seconds);
        for (;;) {
            const std::optional<Yuv> pixel = PixelAt(callId, fx, fy);
            if (pixel && std::abs(pixel->y - color.y) <= tolerance && std::abs(pixel->u - color.u) <= tolerance &&
                std::abs(pixel->v - color.v) <= tolerance) {
                return true;
            }
            if (Clock::now() >= deadline) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
    }

    // O maior Y menos o menor Y do último quadro do id, na linha da fração fy da altura, entre as frações fromX e toX
    // da largura (toX fora): 0 numa linha lisa. -1 se nenhum quadro do id chegou.
    int RowSpanY(int callId, double fy, double fromX, double toX) const {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto found = last_.find(callId);
        if (found == last_.end()) return -1;
        const Image& image = found->second;
        const int y = Clamped(static_cast<int>(fy * image.height), image.height);
        const int from = Clamped(static_cast<int>(fromX * image.width), image.width);
        const int to = std::max(from + 1, std::min(image.width, static_cast<int>(toX * image.width)));
        const uint8_t* row = image.y.data() + static_cast<size_t>(y) * image.width;
        return *std::max_element(row + from, row + to) - *std::min_element(row + from, row + to);
    }

    // Os quadros numa linha só, para as mensagens dos testes: o id e o tamanho de cada sequência igual.
    std::string Text() const {
        std::string text;
        int run = 0;
        const std::vector<Frame> frames = Frames();
        for (size_t index = 0; index < frames.size(); ++index) {
            ++run;
            const Frame& frame = frames[index];
            const bool last = index + 1 == frames.size() || frames[index + 1].callId != frame.callId ||
                              frames[index + 1].width != frame.width || frames[index + 1].height != frame.height;
            if (!last) continue;
            text += std::to_string(frame.callId) + ":" + std::to_string(frame.width) + "x" +
                    std::to_string(frame.height) + "*" + std::to_string(run) + "; ";
            run = 0;
        }
        return text;
    }

private:
    // A cópia de um quadro, com os planos sem os passos.
    struct Image {
        int width = 0;
        int height = 0;
        std::vector<uint8_t> y, u, v;
    };

    static int Clamped(int value, int size) { return std::max(0, std::min(size - 1, value)); }

    static std::vector<uint8_t> CopyPlane(const uint8_t* plane, int stride, int width, int height) {
        std::vector<uint8_t> copy(static_cast<size_t>(width) * height);
        for (int row = 0; row < height; ++row) {
            std::copy(plane + static_cast<size_t>(row) * stride, plane + static_cast<size_t>(row) * stride + width,
                      copy.begin() + static_cast<size_t>(row) * width);
        }
        return copy;
    }

    void Add(int callId, const starsonic::I420Frame& frame) {
        Image image;
        image.width = frame.width;
        image.height = frame.height;
        const int chromaWidth = (frame.width + 1) / 2;
        const int chromaHeight = (frame.height + 1) / 2;
        image.y = CopyPlane(frame.y, frame.yStride, frame.width, frame.height);
        image.u = CopyPlane(frame.u, frame.uStride, chromaWidth, chromaHeight);
        image.v = CopyPlane(frame.v, frame.vStride, chromaWidth, chromaHeight);
        std::lock_guard<std::mutex> lock(mutex_);
        frames_.push_back({callId, frame.width, frame.height, Clock::now()});
        last_[callId] = std::move(image);
    }

    mutable std::mutex mutex_;
    std::vector<Frame> frames_;
    std::map<int, Image> last_;   // a última imagem de cada id
};

// Um motor registrado no registrador falso (ramal 2001). adjust muda o perfil e configure, a configuração do motor
// antes do Create. A ordem dos campos importa: o motor some antes do listener, e o registrador por último.
struct Phone {
    explicit Phone(Transport transport = Transport::Udp, const std::function<void(Profile&)>& adjust = nullptr,
                   const std::function<void(starsonic::EngineConfig&)>& configure = nullptr)
        : registrar("senha") {
        Profile profile = LoadProfile(registrar.port());
        if (adjust) adjust(profile);
        engine = StartEngine(&listener, profile, configure);
        REQUIRE(engine->SetAccount(Input(transport)));
        REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    }

    // RING 2001 e o id que o motor deu à ligação.
    int Ring() {
        const size_t before = Count(CallEvent::Incoming);
        REQUIRE(registrar.Control("RING 2001") == Lines{"OK"});
        REQUIRE(listener.WaitForCalls(RecordingListener::Count(CallEvent::Incoming, before + 1), kWaitSeconds));
        return Last(listener.Calls(), CallEvent::Incoming).callId;
    }

    // RINGVIDEO 2001 <from> <codecs> (um INVITE com o vídeo, do usuário from) e o id que o motor deu à ligação. Com
    // replay, o registrador manda ao telefone os datagramas que a PORTA do vídeo guardou, depois da resposta com o SDP.
    int RingVideo(const std::string& from, const std::string& codecs = "H264,VP8", bool replay = false) {
        const size_t before = Count(CallEvent::Incoming);
        REQUIRE(registrar.Control("RINGVIDEO 2001 " + from + " " + codecs + (replay ? " replay" : "")) == Lines{"OK"});
        REQUIRE(listener.WaitForCalls(RecordingListener::Count(CallEvent::Incoming, before + 1), kWaitSeconds));
        return Last(listener.Calls(), CallEvent::Incoming).callId;
    }

    // RING 2001, Answer e a espera pelo Confirmed.
    int Answered() {
        const int id = Ring();
        REQUIRE(engine->Answer(id));
        REQUIRE(WaitState(id, CallState::Confirmed));
        return id;
    }

    // Duas ligações do RING atendidas: first em espera e second, a ativa, já com o áudio de cada uma
    // no lugar.
    void TwoCalls(int* first, int* second) {
        *first = Answered();
        *second = Answered();
        REQUIRE(WaitLinks(*first, {}));
        REQUIRE(WaitLinks(*second, {0}));
    }

    // MakeCall e a espera pelo Confirmed.
    int Dial(const std::string& number) {
        const int id = engine->MakeCall(number);
        REQUIRE(id >= 0);
        REQUIRE(WaitState(id, CallState::Confirmed));
        return id;
    }

    bool WaitState(int id, CallState state) {
        return listener.WaitForCalls(RecordingListener::StateReached(id, state), kWaitSeconds);
    }

    // Espera até kWaitSeconds pelo primeiro OnTransfer da ligação id.
    bool WaitTransfer(int id) {
        return listener.WaitForCalls([id](const std::vector<CallEvent>& events) { return !Transfers(events, id).empty(); },
                                     kWaitSeconds);
    }

    // Duas ligações feitas daqui: client (2002), que vai para a espera, e colleague (2003), a ativa,
    // com o som; como numa consulta antes da transferência.
    void Consultation(int* client, int* colleague) {
        *client = Dial("2002");
        *colleague = Dial("2003");
        REQUIRE(registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
        REQUIRE(WaitLinks(*client, {}));
        REQUIRE(WaitLinks(*colleague, {0}));
    }

    // Duas ligações feitas daqui, first (2002) e second (2003), juntas na conferência: as duas com o
    // som e ligadas entre si.
    void Conference(int* first, int* second) {
        Consultation(first, second);
        REQUIRE(engine->Join(*first, *second));
        REQUIRE(registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
        REQUIRE(WaitLinks(*first, {0, *second}));
        REQUIRE(WaitLinks(*second, {0, *first}));
    }

    // Espera até kWaitSeconds que AudioLinks(id) tenha os itens de `expected`, em qualquer ordem (a
    // ponte de áudio aplica as ligações no tique seguinte do relógio dela).
    bool WaitLinks(int id, const std::vector<int>& expected) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kWaitSeconds);
        while (Sorted(engine->AudioLinks(id)) != Sorted(expected)) {
            if (std::chrono::steady_clock::now() >= deadline) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return true;
    }

    // Espera até kWaitSeconds que a linha apareça `times` vezes no registro de ligações.
    bool WaitForLogCount(const std::string& line, size_t times) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kWaitSeconds);
        while (LogCount(line) < times) {
            if (std::chrono::steady_clock::now() >= deadline) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return true;
    }

    size_t LogCount(const std::string& line) const {
        const Lines log = registrar.Log();
        return static_cast<size_t>(std::count(log.begin(), log.end(), line));
    }

    size_t Count(CallEvent::Kind kind) const {
        size_t count = 0;
        for (const CallEvent& event : listener.Calls()) count += event.kind == kind ? 1 : 0;
        return count;
    }

    FakeRegistrar registrar;
    RecordingListener listener;
    std::unique_ptr<SipEngine> engine;
};

// O motor sem vídeo (o do baresip, e o do PJSIP sem o PJMEDIA_HAS_VIDEO, como o do Android): nenhum codec de vídeo, a
// ligação com vídeo não sai (-1), o Answer e o SetCamera com o vídeo devolvem false, o Video dá o CallVideo{} e nenhum
// OnCallVideo chega, também numa recebida que oferece vídeo, que só a voz atende. Nenhuma câmera: a escolha e o teste
// da câmera devolvem false, a releitura e o sink não fazem nada, e nenhum OnCameraProblem nem quadro chega.
inline void CheckNoVideo(Phone& phone) {
    TestSink sink;
    phone.engine->SetFrameSink(&sink);
    CHECK(phone.engine->VideoDevices().empty());
    CHECK_FALSE(phone.engine->SetCaptureDevice(""));
    CHECK_FALSE(phone.engine->SetCaptureDevice("Colorbar generator"));
    phone.engine->RefreshVideoDevices();
    CHECK(phone.engine->VideoDevices().empty());
    CHECK_FALSE(phone.engine->StartCameraTest());
    phone.engine->StopCameraTest();
    CHECK(phone.engine->VideoCodecs().empty());
    phone.engine->SetVideoSettings(starsonic::VideoSettings());
    CHECK(phone.engine->MakeCall("2003", true) == -1);
    CHECK(phone.engine->CallCount() == 0);

    const int id = phone.RingVideo("2003");
    CHECK_FALSE(phone.engine->Answer(id, true));
    CHECK_FALSE(phone.engine->SetCamera(id, true));
    CHECK(phone.engine->Video(id) == starsonic::CallVideo());
    REQUIRE(phone.engine->Answer(id, false));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 200 video=nao", kWaitSeconds));
    CHECK_FALSE(phone.engine->SetCamera(id, true));
    CHECK_FALSE(phone.engine->SetCamera(id, false));
    phone.engine->SetCameraPaused(true);
    phone.engine->SetCameraPaused(false);
    CHECK(phone.engine->Video(id) == starsonic::CallVideo());
    CHECK(phone.engine->Video(999) == starsonic::CallVideo());

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.Videos().empty());
    CHECK(phone.listener.CameraProblems().empty());
    CHECK(sink.Frames().empty());
    phone.engine->SetFrameSink(nullptr);
    const Lines log = phone.registrar.Log();
    CHECK(std::none_of(log.begin(), log.end(), [](const std::string& line) { return line.rfind("inv-in", 0) == 0; }));
}

// O motor sem sala (o do baresip, e o do PJSIP sem o PJMEDIA_HAS_VIDEO, como o do Android): o RoomAdd não liga (-1),
// sem ligação e numa ligação só de voz, o Room dá o RoomInfo{} e nenhum OnRoom chega.
inline void CheckNoRoom(Phone& phone) {
    CHECK(phone.engine->RoomAdd("2003") == -1);
    CHECK(phone.engine->Room() == starsonic::RoomInfo());

    const int id = phone.Dial("2002");
    CHECK(phone.engine->RoomAdd("2003") == -1);
    CHECK(phone.engine->Room() == starsonic::RoomInfo());
    CHECK(phone.engine->CallCount() == 1);
    REQUIRE(phone.engine->Hangup(id));
    REQUIRE(phone.WaitState(id, CallState::Disconnected));

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.Rooms().empty());
    const Lines log = phone.registrar.Log();
    CHECK(std::none_of(log.begin(), log.end(),
                       [](const std::string& line) { return line.rfind("inv-in 2003", 0) == 0; }));
}

}  // namespace phone_test
