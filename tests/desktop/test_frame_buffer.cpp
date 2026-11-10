// A memoria de uma vista de video (windows/app/src/FrameBuffer.h; docs/ponte-windows.md, "A memoria do video"): o
// cabecalho, os dois lugares, o seq e a leitura que a pagina vai repetir. C++ portatil: roda tambem no Linux.
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <atomic>
#include <chrono>
#include <string>
#include <thread>
#include <vector>

#include "FrameBuffer.h"
#include "Video.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// Um quadro I420 de teste com os planos preenchidos com `fill` (mais o indice, para notar uma troca de lugar).
struct TestFrame {
    int width, height;
    std::vector<uint8_t> y, u, v;
    TestFrame(int w, int h, uint8_t fill) : width(w), height(h) {
        const size_t cw = static_cast<size_t>((w + 1) / 2), ch = static_cast<size_t>((h + 1) / 2);
        y.resize(static_cast<size_t>(w) * static_cast<size_t>(h));
        u.resize(cw * ch);
        v.resize(cw * ch);
        for (size_t i = 0; i < y.size(); ++i) y[i] = static_cast<uint8_t>(fill + i);
        for (size_t i = 0; i < u.size(); ++i) { u[i] = static_cast<uint8_t>(fill + 100 + i); v[i] = static_cast<uint8_t>(fill + 200 + i); }
    }
    I420Frame Frame() const {
        I420Frame f;
        f.width = width; f.height = height;
        f.y = y.data(); f.yStride = width;
        f.u = u.data(); f.uStride = (width + 1) / 2;
        f.v = v.data(); f.vStride = (width + 1) / 2;
        return f;
    }
};

std::string Bytes(const std::vector<uint8_t>& v) { return std::string(v.begin(), v.end()); }

uint32_t HeaderU32(const std::vector<uint8_t>& mem, size_t offset) {
    return static_cast<uint32_t>(mem[offset]) | static_cast<uint32_t>(mem[offset + 1]) << 8 |
           static_cast<uint32_t>(mem[offset + 2]) << 16 | static_cast<uint32_t>(mem[offset + 3]) << 24;
}

void SetHeaderU32(std::vector<uint8_t>& mem, size_t offset, uint32_t value) {
    for (int i = 0; i < 4; ++i) mem[offset + static_cast<size_t>(i)] = static_cast<uint8_t>(value >> (8 * i));
}

// A memoria de uma vista, alinhada em 4 bytes (o vector de uint32_t).
struct Memory {
    std::vector<uint32_t> words;
    Memory() : words((FrameBufferBytes() + 3) / 4, 0xAAAAAAAAu) {}
    uint8_t* Data() { return reinterpret_cast<uint8_t*>(words.data()); }
    size_t Size() const { return FrameBufferBytes(); }
};

}  // namespace

TEST_CASE("a fresh buffer has the mark and no frame") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    CHECK(mem.Data()[0] == 'S');
    CHECK(mem.Data()[1] == 'S');
    CHECK(mem.Data()[2] == 'V');
    CHECK(mem.Data()[3] == '1');
    CHECK(writer.Seq() == 0u);
    for (size_t i = 4; i < kFrameHeaderBytes; ++i) CHECK(mem.Data()[i] == 0);
    CHECK(!ReadLatest(mem.Data(), mem.Size()).ok);
}

TEST_CASE("a written frame reads back with its size and planes") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    const TestFrame frame(4, 2, 10);
    CHECK(writer.Write(frame.Frame()));
    const ReadFrame got = ReadLatest(mem.Data(), mem.Size());
    CHECK(got.ok);
    CHECK(got.seq == 2u);
    CHECK(got.width == 4);
    CHECK(got.height == 2);
    CHECK(got.y == Bytes(frame.y));
    CHECK(got.u == Bytes(frame.u));
    CHECK(got.v == Bytes(frame.v));
}

TEST_CASE("input strides larger than the width are honored") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    // 4x2 com passo 8 no Y e 5 nos planos de cor: o resto das linhas e lixo.
    std::vector<uint8_t> y(16, 0xEE), u(5, 0xEE), v(5, 0xEE);
    for (int r = 0; r < 2; ++r) for (int c = 0; c < 4; ++c) y[static_cast<size_t>(r * 8 + c)] = static_cast<uint8_t>(r * 4 + c);
    u[0] = 1; u[1] = 2; v[0] = 3; v[1] = 4;
    I420Frame f;
    f.width = 4; f.height = 2;
    f.y = y.data(); f.yStride = 8;
    f.u = u.data(); f.uStride = 5;
    f.v = v.data(); f.vStride = 5;
    CHECK(writer.Write(f));
    const ReadFrame got = ReadLatest(mem.Data(), mem.Size());
    CHECK(got.ok);
    CHECK(got.y == std::string("\x00\x01\x02\x03\x04\x05\x06\x07", 8));
    CHECK(got.u == std::string("\x01\x02", 2));
    CHECK(got.v == std::string("\x03\x04", 2));
}

TEST_CASE("frames alternate slots and the header follows the last one") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    const TestFrame a(4, 2, 10), b(4, 2, 50), c(4, 2, 90);
    CHECK(writer.Write(a.Frame()));
    CHECK(HeaderU32(std::vector<uint8_t>(mem.Data(), mem.Data() + kFrameHeaderBytes), 8) == 0u);
    CHECK(writer.Write(b.Frame()));
    CHECK(HeaderU32(std::vector<uint8_t>(mem.Data(), mem.Data() + kFrameHeaderBytes), 8) == 1u);
    CHECK(writer.Write(c.Frame()));
    CHECK(writer.Seq() == 6u);
    const std::vector<uint8_t> header(mem.Data(), mem.Data() + kFrameHeaderBytes);
    CHECK(HeaderU32(header, 8) == 0u);
    CHECK(HeaderU32(header, 28) == static_cast<uint32_t>(FrameSlotBytes()));
    const ReadFrame got = ReadLatest(mem.Data(), mem.Size());
    CHECK(got.ok);
    CHECK(got.seq == 6u);
    CHECK(got.y == Bytes(c.y));
    CHECK(got.u == Bytes(c.u));
    CHECK(got.v == Bytes(c.v));
    // O lugar 0 comeca em 64 e tem o Y do C; o lugar 1 (em 64 + FrameSlotBytes) ainda tem o do B.
    CHECK(std::memcmp(mem.Data() + kFrameHeaderBytes, c.y.data(), c.y.size()) == 0);
    CHECK(std::memcmp(mem.Data() + kFrameHeaderBytes + FrameSlotBytes(), b.y.data(), b.y.size()) == 0);
}

TEST_CASE("a size change keeps working") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    const int sizes[3][2] = {{640, 480}, {1280, 720}, {320, 240}};
    for (const auto& s : sizes) {
        const TestFrame frame(s[0], s[1], 7);
        CHECK(writer.Write(frame.Frame()));
        const ReadFrame got = ReadLatest(mem.Data(), mem.Size());
        CHECK(got.ok);
        CHECK(got.width == s[0]);
        CHECK(got.height == s[1]);
        CHECK(got.y == Bytes(frame.y));
        CHECK(got.u == Bytes(frame.u));
        CHECK(got.v == Bytes(frame.v));
    }
}

TEST_CASE("a cleared buffer reads empty and the next frame continues the seq") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    const TestFrame a(4, 2, 10), b(6, 4, 50);
    CHECK(writer.Write(a.Frame()));
    CHECK(writer.Write(a.Frame()));
    REQUIRE(ReadLatest(mem.Data(), mem.Size()).seq == 4u);
    // A vista vazia de novo: o seq 0 no cabecalho, com a marca, e nenhum quadro para quem le.
    writer.Clear();
    std::vector<uint8_t> header(mem.Data(), mem.Data() + kFrameHeaderBytes);
    CHECK(HeaderU32(header, 0) == 0x31565353u);
    CHECK(HeaderU32(header, 4) == 0u);
    CHECK_FALSE(ReadLatest(mem.Data(), mem.Size()).ok);
    // O quadro seguinte continua a contagem (o 6, no outro lugar): um seq ja usado nunca volta, e um leitor que copiava
    // o quadro de antes ve o seq mudar.
    CHECK(writer.Write(b.Frame()));
    const ReadFrame got = ReadLatest(mem.Data(), mem.Size());
    CHECK(got.ok);
    CHECK(got.seq == 6u);
    CHECK(got.width == 6);
    CHECK(got.height == 4);
    CHECK(got.y == Bytes(b.y));
    CHECK(got.u == Bytes(b.u));
    CHECK(got.v == Bytes(b.v));
    header.assign(mem.Data(), mem.Data() + kFrameHeaderBytes);
    CHECK(HeaderU32(header, 8) == 0u);
    // Limpar duas vezes, ou uma memoria que nao serve, so deixa a vista vazia.
    writer.Clear();
    writer.Clear();
    CHECK_FALSE(ReadLatest(mem.Data(), mem.Size()).ok);
    std::vector<uint32_t> small(25, 0);
    FrameWriter invalid(reinterpret_cast<uint8_t*>(small.data()), 100);
    invalid.Clear();
    CHECK(std::all_of(small.begin(), small.end(), [](uint32_t word) { return word == 0; }));
}

TEST_CASE("a frame bigger than 1920x1080 is reduced keeping the proportion") {
    CHECK(FitWithin(3840, 2160).width == 1920);
    CHECK(FitWithin(3840, 2160).height == 1080);
    CHECK(FitWithin(4000, 1000).width == 1920);
    CHECK(FitWithin(4000, 1000).height == 480);
    CHECK(FitWithin(1280, 720).width == 1280);
    CHECK(FitWithin(1280, 720).height == 720);

    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    const TestFrame big(3840, 2160, 3);
    CHECK(writer.Write(big.Frame()));
    ReadFrame got = ReadLatest(mem.Data(), mem.Size());
    CHECK(got.ok);
    CHECK(got.width == 1920);
    CHECK(got.height == 1080);
    CHECK(got.y.size() == static_cast<size_t>(1920 * 1080));
    CHECK(got.u.size() == static_cast<size_t>(960 * 540));
    // O vizinho mais proximo de um fator 2: o pixel (x, y) vem do (2x, 2y).
    CHECK(static_cast<uint8_t>(got.y[5]) == big.y[10]);

    const TestFrame wide(4000, 1000, 9);
    CHECK(writer.Write(wide.Frame()));
    got = ReadLatest(mem.Data(), mem.Size());
    CHECK(got.ok);
    CHECK(got.width == 1920);
    CHECK(got.height == 480);
    CHECK(got.y.size() == static_cast<size_t>(1920 * 480));
}

TEST_CASE("odd sizes keep the chroma planes right") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    const TestFrame frame(5, 3, 20);
    CHECK(writer.Write(frame.Frame()));
    const std::vector<uint8_t> header(mem.Data(), mem.Data() + kFrameHeaderBytes);
    CHECK(HeaderU32(header, 12) == 5u);
    CHECK(HeaderU32(header, 16) == 3u);
    CHECK(HeaderU32(header, 20) == 5u);
    CHECK(HeaderU32(header, 24) == 3u);
    const ReadFrame got = ReadLatest(mem.Data(), mem.Size());
    CHECK(got.ok);
    CHECK(got.width == 5);
    CHECK(got.height == 3);
    CHECK(got.y == Bytes(frame.y));
    CHECK(got.u.size() == 6u);   // 3 colunas x 2 linhas
    CHECK(got.u == Bytes(frame.u));
    CHECK(got.v == Bytes(frame.v));
}

TEST_CASE("too small memory refuses the frame") {
    std::vector<uint32_t> small(25, 0);
    FrameWriter writer(reinterpret_cast<uint8_t*>(small.data()), 100);
    const TestFrame frame(4, 2, 1);
    CHECK(!writer.Write(frame.Frame()));
    CHECK(writer.Seq() == 0u);
    CHECK(!ReadLatest(reinterpret_cast<uint8_t*>(small.data()), 100).ok);
}

TEST_CASE("an empty frame is refused and changes nothing") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    CHECK(!writer.Write(I420Frame{}));
    const TestFrame frame(4, 2, 1);
    I420Frame nullPlane = frame.Frame();
    nullPlane.u = nullptr;
    CHECK(!writer.Write(nullPlane));
    CHECK(writer.Seq() == 0u);
}

TEST_CASE("a reader never takes a frame while the header is changing") {
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    const TestFrame frame(4, 2, 1);
    CHECK(writer.Write(frame.Frame()));
    CHECK(ReadLatest(mem.Data(), mem.Size()).ok);
    std::vector<uint8_t> copy(mem.Data(), mem.Data() + mem.Size());
    SetHeaderU32(copy, 4, 3);   // impar a mao
    std::vector<uint32_t> aligned((copy.size() + 3) / 4);
    std::memcpy(aligned.data(), copy.data(), copy.size());
    CHECK(!ReadLatest(reinterpret_cast<const uint8_t*>(aligned.data()), copy.size()).ok);
}

TEST_CASE("the writer ignores a header changed from outside") {
    // A memoria e de outro dono (a pagina): o que ela grava no cabecalho nunca muda onde o escritor grava.
    constexpr size_t kGuard = 4096;
    std::vector<uint32_t> words((FrameBufferBytes() + kGuard + 3) / 4, 0u);
    uint8_t* data = reinterpret_cast<uint8_t*>(words.data());
    std::memset(data + FrameBufferBytes(), 0x5A, kGuard);
    FrameWriter writer(data, FrameBufferBytes());
    const TestFrame a(4, 2, 10), b(4, 2, 50), c(4, 2, 90);
    CHECK(writer.Write(a.Frame()));
    // O lugar 7 e o seq 0 de fora: o proximo quadro vai ao lugar 1, e o seq segue de 2 para 4.
    std::vector<uint8_t> header(data, data + kFrameHeaderBytes);
    SetHeaderU32(header, 8, 7);
    SetHeaderU32(header, 4, 0);
    std::memcpy(data, header.data(), kFrameHeaderBytes);
    CHECK(writer.Write(b.Frame()));
    CHECK(writer.Seq() == 4u);
    ReadFrame got = ReadLatest(data, FrameBufferBytes());
    CHECK(got.ok);
    CHECK(got.seq == 4u);
    CHECK(got.y == Bytes(b.y));
    CHECK(HeaderU32(std::vector<uint8_t>(data, data + kFrameHeaderBytes), 8) == 1u);
    // Um seq impar e enorme de fora tambem nao importa: o seguinte e o 6, no lugar 0.
    header.assign(data, data + kFrameHeaderBytes);
    SetHeaderU32(header, 8, 0xFFFFFFFFu);
    SetHeaderU32(header, 4, 0xFFFFFFF1u);
    std::memcpy(data, header.data(), kFrameHeaderBytes);
    CHECK(writer.Write(c.Frame()));
    got = ReadLatest(data, FrameBufferBytes());
    CHECK(got.ok);
    CHECK(got.seq == 6u);
    CHECK(got.y == Bytes(c.y));
    CHECK(HeaderU32(std::vector<uint8_t>(data, data + kFrameHeaderBytes), 8) == 0u);
    for (size_t i = 0; i < kGuard; ++i) CHECK(data[FrameBufferBytes() + i] == 0x5A);
}

TEST_CASE("a concurrent reader only ever sees whole frames") {
    // Os planos de cada quadro k tem todos os bytes iguais a k % 251. Os dados que o leitor copia sao leituras sem
    // trava (corridas formais, protegidas pelo seq): o que vale e que um quadro aceito e sempre inteiro.
    Memory mem;
    FrameWriter writer(mem.Data(), mem.Size());
    std::atomic<bool> done{false};
    std::atomic<int> written{0};
    std::atomic<bool> readerStarted{false};
    std::atomic<int> acceptedLive{0};
    std::thread producer([&] {
        // O escritor so comeca com o leitor rodando e continua ate o leitor aceitar 50 quadros: a sobreposicao e certa,
        // mesmo com o leitor atrasado. O limite de 2 s so existe para o teste terminar (e falhar) se nada for aceito.
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while (!readerStarted.load() && std::chrono::steady_clock::now() < deadline) std::this_thread::yield();
        for (int k = 1; acceptedLive.load() < 50 && std::chrono::steady_clock::now() < deadline; ++k) {
            const uint8_t value = static_cast<uint8_t>(k % 251);
            const int w = 64 + (k % 3), h = 48 + (k % 2);   // tamanhos que mudam, alguns impares
            const size_t cw = static_cast<size_t>((w + 1) / 2), ch = static_cast<size_t>((h + 1) / 2);
            std::vector<uint8_t> y(static_cast<size_t>(w * h), value), u(cw * ch, value), v(cw * ch, value);
            I420Frame f;
            f.width = w; f.height = h;
            f.y = y.data(); f.yStride = w;
            f.u = u.data(); f.uStride = static_cast<int>(cw);
            f.v = v.data(); f.vStride = static_cast<int>(cw);
            writer.Write(f);
            written.store(k);
        }
        done.store(true);
    });
    int accepted = 0;
    uint32_t last = 0;
    bool whole = true, sizes = true, even = true, monotonic = true;
    readerStarted.store(true);
    while (!done.load()) {
        const ReadFrame got = ReadLatest(mem.Data(), mem.Size());
        if (!got.ok) { std::this_thread::yield(); continue; }
        ++accepted;
        acceptedLive.store(accepted);
        even = even && (got.seq % 2 == 0);
        monotonic = monotonic && got.seq >= last;
        last = got.seq;
        const size_t cw = static_cast<size_t>((got.width + 1) / 2), ch = static_cast<size_t>((got.height + 1) / 2);
        sizes = sizes && got.width >= 64 && got.width <= 66 && got.height >= 48 && got.height <= 49 &&
                got.y.size() == static_cast<size_t>(got.width * got.height) && got.u.size() == cw * ch &&
                got.v.size() == cw * ch;
        const char first = got.y.empty() ? 0 : got.y[0];
        auto same = [&](const std::string& plane) {
            for (char c : plane) if (c != first) return false;
            return true;
        };
        whole = whole && same(got.y) && same(got.u) && same(got.v);
    }
    producer.join();
    CHECK(accepted >= 50);
    CHECK(whole);
    CHECK(sizes);
    CHECK(even);
    CHECK(monotonic);
    CHECK(writer.Seq() == static_cast<uint32_t>(2 * written.load()));
}
