#pragma once
// A memoria de uma vista de video (docs/ponte-windows.md, "A memoria do video"): um cabecalho de 64 bytes e dois
// lugares I420 de ate 1920x1080, com o seq que diz qual quadro esta completo. C++ portatil, sem o windows.h: a
// memoria vem de fora (no Windows, um buffer compartilhado do WebView2) e so se pressupoe o alinhamento de 4 bytes.
// O FrameWriter grava; o ReadLatest e o algoritmo que a pagina repete em JavaScript.
#include <cstddef>
#include <cstdint>
#include <string>

#include "Video.h"

namespace starsonic {

constexpr int kMaxFrameWidth = 1920;
constexpr int kMaxFrameHeight = 1080;
constexpr size_t kFrameHeaderBytes = 64;

size_t FrameSlotBytes();     // 1920*1080 + 2*(960*540)
size_t FrameBufferBytes();   // kFrameHeaderBytes + 2 * FrameSlotBytes()

struct FrameSize { int width; int height; };

// O maior tamanho que cabe em 1920x1080, com a mesma proporcao e par. Um tamanho que ja cabe volta como veio.
FrameSize FitWithin(int width, int height);

class FrameWriter {
public:
    // Grava o cabecalho de um buffer vazio (a marca e o seq 0). Memoria nula, pequena (menos que FrameBufferBytes())
    // ou fora do alinhamento de 4 bytes: nada e gravado, e todo Write devolve false.
    FrameWriter(uint8_t* memory, size_t bytes);

    // Copia o quadro (reduzido se passar de 1920x1080) para o lugar livre e vira o seq. false: memoria invalida ou
    // quadro vazio; nada muda. Uma thread so escreve numa memoria (o chamador serializa).
    bool Write(const I420Frame& frame);

    uint32_t Seq() const;

private:
    uint8_t* memory_ = nullptr;
    // O estado do escritor fica aqui, nunca lido de volta da memoria: quem escreve no cabecalho de fora nao muda onde
    // o proximo quadro e gravado.
    uint32_t seq_ = 0;
    uint32_t slot_ = 0;   // o lugar do ultimo quadro completo
};

struct ReadFrame {
    bool ok = false;
    uint32_t seq = 0;
    int width = 0;
    int height = 0;
    std::string y, u, v;
};

// O ultimo quadro completo: le o seq (zero ou impar: ok=false), copia o cabecalho e o lugar, le o seq de novo (ok so se
// nao mudou). ok=false tambem para memoria pequena, sem a marca ou com um cabecalho que nao faz sentido.
ReadFrame ReadLatest(const uint8_t* memory, size_t bytes);

}  // namespace starsonic
