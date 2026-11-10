// O VideoSink (windows/app/src/VideoSink.h): as memorias de cada vista (criadas, entregues e largadas na thread da
// janela), os quadros escritos pelo FrameWriter so nas memorias que ja existem e o credito de 30 quadros por segundo
// de cada vista. A parte do WebView2 e falsa (SharedMemoryPages). C++ portatil: roda tambem no Linux.
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "FrameBuffer.h"
#include "FrameRouter.h"
#include "VideoSink.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// A parte do WebView2 falsa: conta os Create, os Post e os ReleaseAll de cada vista e guarda cada memoria, tambem
// depois do ReleaseAll (para ver que nenhum quadro chega a uma memoria largada).
struct FakePages : SharedMemoryPages {
    struct Memory {
        ViewName view;
        std::vector<uint32_t> words;   // alinhada em 4 bytes
        Memory(ViewName v, size_t bytes) : view(v), words((bytes + 3) / 4, 0u) {}
        uint8_t* Data() { return reinterpret_cast<uint8_t*>(words.data()); }
    };

    std::vector<std::unique_ptr<Memory>> memories;
    std::map<ViewName, int> creates;
    std::map<ViewName, int> posts;
    int releases = 0;
    size_t lastBytes = 0;
    bool failCreate = false;            // o Create nao da (o WebView2 sem o ambiente)
    std::function<void()> onRelease;    // roda dentro do ReleaseAll: um quadro chegando nessa hora

    uint8_t* Create(ViewName view, size_t bytes) override {
        ++creates[view];
        lastBytes = bytes;
        if (failCreate) return nullptr;
        memories.push_back(std::make_unique<Memory>(view, bytes));
        return memories.back()->Data();
    }
    void Post(ViewName view) override { ++posts[view]; }
    void ReleaseAll() override {
        ++releases;
        if (onRelease) onRelease();
    }

    // A memoria mais nova da vista (nullptr: nenhuma).
    uint8_t* Latest(ViewName view) {
        for (auto it = memories.rbegin(); it != memories.rend(); ++it) {
            if ((*it)->view == view) return (*it)->Data();
        }
        return nullptr;
    }
};

// Um quadro I420 de teste com os planos preenchidos a partir de `fill`.
struct TestFrame {
    int width, height;
    std::vector<uint8_t> y, u, v;
    TestFrame(int w, int h, uint8_t fill) : width(w), height(h) {
        const size_t cw = static_cast<size_t>((w + 1) / 2), ch = static_cast<size_t>((h + 1) / 2);
        y.resize(static_cast<size_t>(w) * static_cast<size_t>(h));
        u.resize(cw * ch);
        v.resize(cw * ch);
        for (size_t i = 0; i < y.size(); ++i) y[i] = static_cast<uint8_t>(fill + i);
        for (size_t i = 0; i < u.size(); ++i) {
            u[i] = static_cast<uint8_t>(fill + 100 + i);
            v[i] = static_cast<uint8_t>(fill + 200 + i);
        }
    }
    I420Frame Frame() const {
        I420Frame f;
        f.width = width;
        f.height = height;
        f.y = y.data();
        f.yStride = width;
        f.u = u.data();
        f.uStride = (width + 1) / 2;
        f.v = v.data();
        f.vStride = (width + 1) / 2;
        return f;
    }
};

std::string Bytes(const std::vector<uint8_t>& v) { return std::string(v.begin(), v.end()); }

// O seq do ultimo quadro completo da memoria (0: nenhum quadro).
uint32_t SeqOf(const uint8_t* memory) {
    const ReadFrame got = ReadLatest(memory, FrameBufferBytes());
    return got.ok ? got.seq : 0u;
}

// O sink com a parte do WebView2 falsa e um relogio na mao.
struct Harness {
    FakePages pages;
    int64_t now = 0;
    VideoSink sink{pages, [this] { return now; }};
};

RouteState Visible(std::set<ViewName> views, int topCallId = 0, int noticeCallId = 0) {
    RouteState state;
    state.visible = std::move(views);
    state.topCallId = topCallId;
    state.noticeCallId = noticeCallId;
    return state;
}

}  // namespace

TEST_CASE("a visible view gets its memory once") {
    Harness h;
    const RouteState state = Visible({ViewName::Remoto}, 7);
    h.sink.SetRouteState(state);
    CHECK(h.pages.creates[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Remoto] == 1);
    CHECK(h.pages.lastBytes == FrameBufferBytes());
    h.sink.SetRouteState(state);
    CHECK(h.pages.creates[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Remoto] == 1);
    // Escondida, a vista fica com a memoria; de novo a vista, nenhuma outra.
    h.sink.SetRouteState(Visible({}, 7));
    h.sink.SetRouteState(state);
    CHECK(h.pages.creates[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Remoto] == 1);
    CHECK(h.pages.memories.size() == 1u);
    CHECK(h.pages.releases == 0);
    // As outras vistas so ganham a delas quando ficam a vista.
    CHECK(h.pages.creates[ViewName::Local] == 0);
    CHECK(h.pages.creates[ViewName::Porteiro] == 0);
}

TEST_CASE("a frame never creates a memory") {
    Harness h;
    const TestFrame frame(4, 2, 10);
    h.sink.OnRemoteFrame(7, frame.Frame());
    h.sink.OnLocalFrame(frame.Frame());
    CHECK(h.pages.memories.empty());
    CHECK(h.pages.creates.empty());
    // A vista a vista cujo Create nao deu fica sem memoria: o quadro dela e descartado, sem pedir outra.
    h.pages.failCreate = true;
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Local}, 7));
    CHECK(h.pages.creates[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Remoto] == 0);
    h.sink.OnRemoteFrame(7, frame.Frame());
    h.sink.OnLocalFrame(frame.Frame());
    CHECK(h.pages.creates[ViewName::Remoto] == 1);
    CHECK(h.pages.creates[ViewName::Local] == 1);
    CHECK(h.pages.memories.empty());
}

TEST_CASE("a remote frame lands in the remote buffer and reads back") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Local}, 7));
    const TestFrame frame(4, 2, 10);
    h.sink.OnRemoteFrame(7, frame.Frame());
    const ReadFrame got = ReadLatest(h.pages.Latest(ViewName::Remoto), FrameBufferBytes());
    CHECK(got.ok);
    CHECK(got.seq == 2u);
    CHECK(got.width == 4);
    CHECK(got.height == 2);
    CHECK(got.y == Bytes(frame.y));
    CHECK(got.u == Bytes(frame.u));
    CHECK(got.v == Bytes(frame.v));
    CHECK(SeqOf(h.pages.Latest(ViewName::Local)) == 0u);
    // A nossa camera vai a vista local; o remoto fica como estava.
    const TestFrame camera(6, 4, 50);
    h.sink.OnLocalFrame(camera.Frame());
    const ReadFrame local = ReadLatest(h.pages.Latest(ViewName::Local), FrameBufferBytes());
    CHECK(local.ok);
    CHECK(local.width == 6);
    CHECK(local.y == Bytes(camera.y));
    CHECK(SeqOf(h.pages.Latest(ViewName::Remoto)) == 2u);
    // O quadro de outra ligacao nao muda nada.
    h.now += 100;
    h.sink.OnRemoteFrame(42, camera.Frame());
    CHECK(SeqOf(h.pages.Latest(ViewName::Remoto)) == 2u);
}

TEST_CASE("a new top call starts with an empty view") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Porteiro}, 7, 8));
    uint8_t* remote = h.pages.Latest(ViewName::Remoto);
    uint8_t* door = h.pages.Latest(ViewName::Porteiro);
    REQUIRE(remote != nullptr);
    REQUIRE(door != nullptr);
    const TestFrame a(4, 2, 10), b(6, 4, 50), ringing(4, 2, 90);
    h.sink.OnRemoteFrame(7, a.Frame());
    h.sink.OnRemoteFrame(8, ringing.Frame());
    const uint32_t seqA = SeqOf(remote);
    REQUIRE(seqA == 2u);
    REQUIRE(SeqOf(door) == 2u);
    // A ligacao de cima vira a 9: a vista fica vazia ate o primeiro quadro dela, e o ultimo quadro da 7 nunca aparece
    // nela. O porteiro, com a mesma recebida tocando, fica como estava.
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Porteiro}, 9, 8));
    CHECK_FALSE(ReadLatest(remote, FrameBufferBytes()).ok);
    CHECK(SeqOf(door) == 2u);
    h.now += 40;
    h.sink.OnRemoteFrame(7, a.Frame());   // um quadro atrasado da 7: a nenhuma vista
    CHECK_FALSE(ReadLatest(remote, FrameBufferBytes()).ok);
    h.now += 40;
    h.sink.OnRemoteFrame(9, b.Frame());
    const ReadFrame got = ReadLatest(remote, FrameBufferBytes());
    CHECK(got.ok);
    CHECK(got.width == 6);
    CHECK(got.height == 4);
    CHECK(got.y == Bytes(b.y));
    CHECK(got.u == Bytes(b.u));
    CHECK(got.v == Bytes(b.v));
    // O seq continua de onde estava: um seq ja usado nunca volta (a pagina compara o seq com o do quadro que desenhou).
    CHECK(got.seq > seqA);
    // A mesma memoria, sem outra criada nem entregue.
    CHECK(h.pages.creates[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Remoto] == 1);
    // Escondida, com a mesma ligacao, a vista fica com o quadro dela; o fim da ligacao (o id 0) a esvazia.
    h.sink.SetRouteState(Visible({ViewName::Porteiro}, 9, 8));
    CHECK(ReadLatest(remote, FrameBufferBytes()).ok);
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Porteiro}, 0, 8));
    CHECK_FALSE(ReadLatest(remote, FrameBufferBytes()).ok);
}

TEST_CASE("a new ringing call starts with an empty doorphone view") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Porteiro}, 0, 7));
    uint8_t* door = h.pages.Latest(ViewName::Porteiro);
    REQUIRE(door != nullptr);
    const TestFrame visitor(4, 2, 10), next(6, 4, 50);
    h.sink.OnRemoteFrame(7, visitor.Frame());
    REQUIRE(SeqOf(door) == 2u);
    // A recebida tocando vira a 9: o visitante da 7 nunca aparece no aviso da 9.
    h.sink.SetRouteState(Visible({ViewName::Porteiro}, 0, 9));
    CHECK_FALSE(ReadLatest(door, FrameBufferBytes()).ok);
    h.now += 40;
    h.sink.OnRemoteFrame(9, next.Frame());
    const ReadFrame got = ReadLatest(door, FrameBufferBytes());
    CHECK(got.ok);
    CHECK(got.width == 6);
    CHECK(got.y == Bytes(next.y));
    CHECK(got.seq > 2u);
    // Atendida (nenhuma recebida tocando): vazia de novo, e um quadro dela nao vai mais ao porteiro.
    h.sink.SetRouteState(Visible({ViewName::Porteiro}, 9, 0));
    CHECK_FALSE(ReadLatest(door, FrameBufferBytes()).ok);
    h.now += 40;
    h.sink.OnRemoteFrame(9, next.Frame());
    CHECK_FALSE(ReadLatest(door, FrameBufferBytes()).ok);
    CHECK(h.pages.creates[ViewName::Porteiro] == 1);
    CHECK(h.pages.posts[ViewName::Porteiro] == 1);
}

TEST_CASE("the local view starts empty after it stops getting frames") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Local}));
    uint8_t* local = h.pages.Latest(ViewName::Local);
    REQUIRE(local != nullptr);
    const TestFrame camera(4, 2, 10);
    h.sink.OnLocalFrame(camera.Frame());
    REQUIRE(SeqOf(local) == 2u);
    // Uma ligacao que comeca ou muda nao mexe na nossa camera: a vista segue com o quadro dela.
    h.sink.SetRouteState(Visible({ViewName::Local}, 5));
    CHECK(SeqOf(local) == 2u);
    // Escondida: vazia. A proxima vez que ela aparece comeca sem a imagem de antes, ate o proximo quadro.
    h.sink.SetRouteState(Visible({}, 5));
    CHECK_FALSE(ReadLatest(local, FrameBufferBytes()).ok);
    h.sink.SetRouteState(Visible({ViewName::Local}, 5));
    CHECK_FALSE(ReadLatest(local, FrameBufferBytes()).ok);
    h.now += 40;
    h.sink.OnLocalFrame(camera.Frame());
    const ReadFrame got = ReadLatest(local, FrameBufferBytes());
    CHECK(got.ok);
    CHECK(got.y == Bytes(camera.y));
    CHECK(got.seq > 2u);
    // A janela minimizada (ou na bandeja): vazia tambem.
    RouteState minimized = Visible({ViewName::Local}, 5);
    minimized.minimized = true;
    h.sink.SetRouteState(minimized);
    CHECK_FALSE(ReadLatest(local, FrameBufferBytes()).ok);
    // A mesma memoria o tempo todo.
    CHECK(h.pages.creates[ViewName::Local] == 1);
    CHECK(h.pages.posts[ViewName::Local] == 1);
}

TEST_CASE("a page reload posts the memories again") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Local, ViewName::Porteiro}, 7, 8));
    CHECK(h.pages.posts[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Local] == 1);
    CHECK(h.pages.posts[ViewName::Porteiro] == 1);
    // A janela principal recarregou: so as memorias dela vao de novo.
    h.sink.PageReady(false);
    CHECK(h.pages.posts[ViewName::Remoto] == 2);
    CHECK(h.pages.posts[ViewName::Local] == 2);
    CHECK(h.pages.posts[ViewName::Porteiro] == 1);
    // O aviso recarregou: so a do porteiro.
    h.sink.PageReady(true);
    CHECK(h.pages.posts[ViewName::Remoto] == 2);
    CHECK(h.pages.posts[ViewName::Local] == 2);
    CHECK(h.pages.posts[ViewName::Porteiro] == 2);
    // As mesmas memorias: nenhuma criada nem largada.
    CHECK(h.pages.memories.size() == 3u);
    CHECK(h.pages.releases == 0);
}

TEST_CASE("a browser restart drops the memories and creates new ones") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Remoto}, 7));
    const TestFrame frame(4, 2, 10);
    h.sink.OnRemoteFrame(7, frame.Frame());
    uint8_t* old = h.pages.Latest(ViewName::Remoto);
    CHECK(SeqOf(old) == 2u);
    // Um quadro que chega enquanto as memorias sao largadas nao vai a nenhuma.
    h.pages.onRelease = [&h, &frame] {
        h.now += 40;
        h.sink.OnRemoteFrame(7, frame.Frame());
    };
    h.sink.BrowserRestarted();
    h.pages.onRelease = nullptr;
    CHECK(h.pages.releases == 1);
    CHECK(h.pages.creates[ViewName::Remoto] == 2);
    uint8_t* fresh = h.pages.Latest(ViewName::Remoto);
    REQUIRE(fresh != nullptr);
    CHECK(fresh != old);
    CHECK(SeqOf(old) == 2u);
    CHECK(SeqOf(fresh) == 0u);
    // O quadro seguinte vai para a memoria nova, e o seq da velha nao muda.
    h.now += 40;
    h.sink.OnRemoteFrame(7, frame.Frame());
    CHECK(SeqOf(fresh) == 2u);
    CHECK(SeqOf(old) == 2u);
    // A memoria nova vai a pagina no ready dela.
    h.sink.PageReady(false);
    CHECK(h.pages.posts[ViewName::Remoto] == 2);
}

TEST_CASE("after Close no frame is written") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Local, ViewName::Porteiro}, 7, 8));
    REQUIRE(h.pages.memories.size() == 3u);
    const TestFrame frame(4, 2, 10);
    // Os quadros que chegam enquanto as memorias sao largadas nao vao a nenhuma.
    h.pages.onRelease = [&h, &frame] {
        h.now += 40;
        h.sink.OnRemoteFrame(7, frame.Frame());
        h.sink.OnRemoteFrame(8, frame.Frame());
        h.sink.OnLocalFrame(frame.Frame());
    };
    h.sink.Close();
    h.pages.onRelease = nullptr;
    CHECK(h.pages.releases == 1);
    h.now += 40;
    h.sink.OnRemoteFrame(7, frame.Frame());
    h.sink.OnRemoteFrame(8, frame.Frame());
    h.sink.OnLocalFrame(frame.Frame());
    for (const auto& memory : h.pages.memories) CHECK(SeqOf(memory->Data()) == 0u);
    // Depois do Close, nada: nenhuma memoria nova, nenhuma entrega e nenhum outro ReleaseAll.
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Local, ViewName::Porteiro}, 9, 9));
    h.sink.PageReady(false);
    h.sink.PageReady(true);
    h.sink.BrowserRestarted();
    h.sink.Close();
    CHECK(h.pages.memories.size() == 3u);
    CHECK(h.pages.creates[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Remoto] == 1);
    CHECK(h.pages.posts[ViewName::Porteiro] == 1);
    CHECK(h.pages.releases == 1);
}

TEST_CASE("a 30 fps source with jitter keeps every frame") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Remoto}, 7));
    const TestFrame frame(4, 2, 10);
    for (const int64_t t : {0, 32, 66, 99, 132, 168, 199, 233}) {
        h.now = t;
        h.sink.OnRemoteFrame(7, frame.Frame());
    }
    CHECK(SeqOf(h.pages.Latest(ViewName::Remoto)) == 16u);
}

TEST_CASE("frames faster than 30 per second are thinned") {
    Harness h;
    h.sink.SetRouteState(Visible({ViewName::Remoto, ViewName::Local}, 7));
    const TestFrame frame(4, 2, 10);
    for (int64_t t = 0; t <= 990; t += 10) {
        h.now = t;
        h.sink.OnRemoteFrame(7, frame.Frame());
        // A camera a 25 qps ao mesmo tempo: o credito e de cada vista, e ela fica com os 25 quadros.
        if (t % 40 == 0) h.sink.OnLocalFrame(frame.Frame());
    }
    CHECK(SeqOf(h.pages.Latest(ViewName::Remoto)) == 62u);
    CHECK(SeqOf(h.pages.Latest(ViewName::Local)) == 50u);
}
