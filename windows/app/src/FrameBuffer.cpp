#include "FrameBuffer.h"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <utility>

namespace starsonic {

namespace {

// Os deslocamentos do cabecalho (todos os campos sao u32 little-endian).
constexpr size_t kOffMark = 0;
constexpr size_t kOffSeq = 4;
constexpr size_t kOffSlot = 8;
constexpr size_t kOffWidth = 12;
constexpr size_t kOffHeight = 16;
constexpr size_t kOffYStride = 20;
constexpr size_t kOffUvStride = 24;
constexpr size_t kOffSlotBytes = 28;
constexpr uint32_t kMark = 0x31565353;   // "SSV1"

// O seq e lido e gravado como um atomico de 32 bits na propria memoria. Todo alvo do app e little-endian, entao o
// valor no atomico e o u32 little-endian do formato.
static_assert(std::atomic<uint32_t>::is_always_lock_free && sizeof(std::atomic<uint32_t>) == 4,
              "o seq precisa de um atomico de 32 bits sem trava");
static_assert(alignof(std::atomic<uint32_t>) <= 4, "o seq fica em um deslocamento de 4 bytes");
// Little-endian (x86 e ARM do Windows): o seq pelo atomico e os outros campos byte a byte concordam.
#if defined(__BYTE_ORDER__) && defined(__ORDER_LITTLE_ENDIAN__)
static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "o formato do seq pressupoe little-endian");
#endif

bool Aligned(const void* memory) { return reinterpret_cast<uintptr_t>(memory) % 4 == 0; }

std::atomic<uint32_t>* SeqOf(uint8_t* memory) {
    return reinterpret_cast<std::atomic<uint32_t>*>(memory + kOffSeq);
}
const std::atomic<uint32_t>* SeqOf(const uint8_t* memory) {
    return reinterpret_cast<const std::atomic<uint32_t>*>(memory + kOffSeq);
}

void PutU32(uint8_t* memory, size_t offset, uint32_t value) {
    for (size_t i = 0; i < 4; ++i) memory[offset + i] = static_cast<uint8_t>(value >> (8 * i));
}

uint32_t GetU32(const uint8_t* memory, size_t offset) {
    return static_cast<uint32_t>(memory[offset]) | static_cast<uint32_t>(memory[offset + 1]) << 8 |
           static_cast<uint32_t>(memory[offset + 2]) << 16 | static_cast<uint32_t>(memory[offset + 3]) << 24;
}

size_t ChromaSize(int n) { return static_cast<size_t>((n + 1) / 2); }

// Copia um plano de srcW x srcH para dstW x dstH (iguais: linha a linha; diferentes: vizinho mais proximo) sem
// sobra nas linhas do destino.
void CopyPlane(const uint8_t* src, int srcStride, int srcW, int srcH, uint8_t* dst, int dstW, int dstH) {
    if (srcW == dstW && srcH == dstH) {
        for (int row = 0; row < dstH; ++row) {
            std::memcpy(dst + static_cast<size_t>(row) * static_cast<size_t>(dstW),
                        src + static_cast<size_t>(row) * static_cast<size_t>(srcStride), static_cast<size_t>(dstW));
        }
        return;
    }
    for (int row = 0; row < dstH; ++row) {
        const int sy = static_cast<int>(static_cast<int64_t>(row) * srcH / dstH);
        const uint8_t* line = src + static_cast<size_t>(sy) * static_cast<size_t>(srcStride);
        uint8_t* out = dst + static_cast<size_t>(row) * static_cast<size_t>(dstW);
        for (int col = 0; col < dstW; ++col) {
            out[col] = line[static_cast<int>(static_cast<int64_t>(col) * srcW / dstW)];
        }
    }
}

}  // namespace

size_t FrameSlotBytes() {
    return static_cast<size_t>(kMaxFrameWidth) * kMaxFrameHeight +
           2 * (static_cast<size_t>(kMaxFrameWidth / 2) * (kMaxFrameHeight / 2));
}

size_t FrameBufferBytes() { return kFrameHeaderBytes + 2 * FrameSlotBytes(); }

FrameSize FitWithin(int width, int height) {
    if (width <= kMaxFrameWidth && height <= kMaxFrameHeight) return {width, height};
    int w, h;
    if (static_cast<int64_t>(width) * kMaxFrameHeight > static_cast<int64_t>(height) * kMaxFrameWidth) {
        w = kMaxFrameWidth;
        h = static_cast<int>(static_cast<int64_t>(height) * kMaxFrameWidth / width);
    } else {
        h = kMaxFrameHeight;
        w = static_cast<int>(static_cast<int64_t>(width) * kMaxFrameHeight / height);
    }
    w = std::max(2, w & ~1);
    h = std::max(2, h & ~1);
    return {w, h};
}

FrameWriter::FrameWriter(uint8_t* memory, size_t bytes) {
    if (memory == nullptr || bytes < FrameBufferBytes() || !Aligned(memory)) return;
    memory_ = memory;
    std::memset(memory_, 0, kFrameHeaderBytes);
    PutU32(memory_, kOffMark, kMark);
    // O seq 0 pelo atomico, depois da marca: quem ve o seq ve o cabecalho.
    SeqOf(memory_)->store(0, std::memory_order_release);
}

void FrameWriter::Clear() {
    if (memory_ == nullptr) return;
    // So o seq muda (o 0: nenhum quadro). O seq_ e o slot_ ficam: o proximo Write grava no lugar livre e continua a
    // contagem. Um leitor que copiava o quadro de antes ve o seq mudar (o 0, e depois um seq que nunca foi usado) e o
    // descarta. Com a contagem de volta ao 0 (um FrameWriter novo), os quadros novos repetiriam os seq de antes (2, 4,
    // 6...): um leitor atrasado aceitaria uma copia misturada, e a pagina que compara o seq com o do quadro que
    // desenhou tomaria o quadro novo pelo velho.
    SeqOf(memory_)->store(0, std::memory_order_release);
}

uint32_t FrameWriter::Seq() const { return memory_ == nullptr ? 0 : seq_; }

bool FrameWriter::Write(const I420Frame& frame) {
    if (memory_ == nullptr || frame.width <= 0 || frame.height <= 0 || frame.y == nullptr || frame.u == nullptr ||
        frame.v == nullptr || frame.yStride < frame.width || frame.uStride < (frame.width + 1) / 2 ||
        frame.vStride < (frame.width + 1) / 2) {
        return false;
    }
    const FrameSize size = FitWithin(frame.width, frame.height);
    const int cw = static_cast<int>(ChromaSize(size.width));
    const int ch = static_cast<int>(ChromaSize(size.height));

    std::atomic<uint32_t>* seq = SeqOf(memory_);
    const uint32_t current = seq_;
    const uint32_t slot = current == 0 ? 0 : 1 - slot_;

    // A ordem: o ultimo store do seq do quadro anterior (par) nao pode passar para depois destas escritas no lugar
    // livre. Sem a cerca, num CPU fraco o leitor poderia ver o seq par antigo (s1 == s2) com o lugar ja sendo
    // regravado. Com ela, um leitor que comecou antes da virada e ainda copia o lugar que o proximo quadro reescreve
    // acaba vendo s1 != s2 no seu segundo seq.
    std::atomic_thread_fence(std::memory_order_release);

    uint8_t* base = memory_ + kFrameHeaderBytes + static_cast<size_t>(slot) * FrameSlotBytes();
    CopyPlane(frame.y, frame.yStride, frame.width, frame.height, base, size.width, size.height);
    uint8_t* u = base + static_cast<size_t>(size.width) * static_cast<size_t>(size.height);
    CopyPlane(frame.u, frame.uStride, static_cast<int>(ChromaSize(frame.width)),
              static_cast<int>(ChromaSize(frame.height)), u, cw, ch);
    uint8_t* v = u + static_cast<size_t>(cw) * static_cast<size_t>(ch);
    CopyPlane(frame.v, frame.vStride, static_cast<int>(ChromaSize(frame.width)),
              static_cast<int>(ChromaSize(frame.height)), v, cw, ch);

    // O seqlock do escritor: um store release so ordena o que vem ANTES dele, entao os campos do cabecalho (que sao
    // dados protegidos pelo seq, como o lugar) escritos depois de um store release do seq impar poderiam aparecer
    // antes dele (o compilador, ou o CPU no ARM64). Por isso: o seq impar (relaxed), a cerca release, o cabecalho e o
    // seq par (release). Quem ve o novo cabecalho ve tambem o seq impar, ou o par, nunca o par antigo.
    seq->store(current + 1, std::memory_order_relaxed);   // impar: o cabecalho esta mudando
    std::atomic_thread_fence(std::memory_order_release);
    PutU32(memory_, kOffSlot, slot);
    PutU32(memory_, kOffWidth, static_cast<uint32_t>(size.width));
    PutU32(memory_, kOffHeight, static_cast<uint32_t>(size.height));
    PutU32(memory_, kOffYStride, static_cast<uint32_t>(size.width));
    PutU32(memory_, kOffUvStride, static_cast<uint32_t>(cw));
    PutU32(memory_, kOffSlotBytes, static_cast<uint32_t>(FrameSlotBytes()));
    seq->store(current + 2, std::memory_order_release);   // par: o quadro esta completo
    seq_ = current + 2;
    slot_ = slot;
    return true;
}

ReadFrame ReadLatest(const uint8_t* memory, size_t bytes) {
    ReadFrame out;
    if (memory == nullptr || bytes < FrameBufferBytes() || !Aligned(memory)) return out;

    const std::atomic<uint32_t>* seq = SeqOf(memory);
    const uint32_t s1 = seq->load(std::memory_order_acquire);
    if (s1 == 0 || (s1 & 1) != 0) return out;

    const uint32_t mark = GetU32(memory, kOffMark);
    const uint32_t slot = GetU32(memory, kOffSlot);
    const uint32_t width = GetU32(memory, kOffWidth);
    const uint32_t height = GetU32(memory, kOffHeight);
    const uint32_t yStride = GetU32(memory, kOffYStride);
    const uint32_t uvStride = GetU32(memory, kOffUvStride);
    // Um cabecalho que nao faz sentido (memoria de outro dono, ou lida no meio de uma mudanca) nunca vira um quadro.
    const bool sane = mark == kMark && slot <= 1 && width >= 1 && width <= static_cast<uint32_t>(kMaxFrameWidth) &&
                      height >= 1 && height <= static_cast<uint32_t>(kMaxFrameHeight) && yStride == width &&
                      uvStride == (width + 1) / 2;
    std::string y, u, v;
    if (sane) {
        const uint8_t* base = memory + kFrameHeaderBytes + static_cast<size_t>(slot) * FrameSlotBytes();
        const size_t ySize = static_cast<size_t>(width) * height;
        const size_t cSize = static_cast<size_t>(uvStride) * ChromaSize(static_cast<int>(height));
        y.assign(reinterpret_cast<const char*>(base), ySize);
        u.assign(reinterpret_cast<const char*>(base + ySize), cSize);
        v.assign(reinterpret_cast<const char*>(base + ySize + cSize), cSize);
    }

    // As copias acima nao podem passar para depois do segundo seq. Se o escritor virou o lugar que copiavamos,
    // o seq mudou, e o quadro e descartado.
    std::atomic_thread_fence(std::memory_order_acquire);
    const uint32_t s2 = seq->load(std::memory_order_relaxed);
    if (!sane || s1 != s2) return out;

    out.ok = true;
    out.seq = s1;
    out.width = static_cast<int>(width);
    out.height = static_cast<int>(height);
    out.y = std::move(y);
    out.u = std::move(u);
    out.v = std::move(v);
    return out;
}

}  // namespace starsonic
