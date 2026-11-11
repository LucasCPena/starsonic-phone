#pragma once
// O mosaico da sala de vídeo (spec do vídeo em grupo): as contas puras (as células, o encaixe, os quadros de 0 a 1, a
// qualidade pelo número de convidados e os quadros de cada convidado) e a montagem da imagem I420. Nada de PJSIP aqui.
#include <cstdint>
#include <vector>

#include "Video.h"

namespace starsonic {

// Um retângulo em pixels (o x e o y são do canto de cima à esquerda).
struct PixelRect {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

bool operator==(const PixelRect& a, const PixelRect& b);

// As células de um mosaico de 1 a 5 imagens numa saída width x height: 1 ocupa tudo, 2 ficam lado a lado, 3 e 4 numa
// grade de 2x2 e 5 em duas linhas, de 3 e 2. As células são iguais, em pixels pares, e a linha incompleta fica no
// centro. Vazio fora de 1 a 5.
std::vector<PixelRect> MosaicCells(int count, int width, int height);

// O retângulo em que uma imagem sourceWidth x sourceHeight cabe na célula sem deformar, centrado em pixels pares, com
// faixas onde sobra. {} sem imagem (largura ou altura menor ou igual a 0).
PixelRect FitInside(int sourceWidth, int sourceHeight, const PixelRect& cell);

// A célula de uma saída width x height como quadro de 0 a 1.
RoomTile UnitTile(const PixelRect& cell, int width, int height);

// A qualidade de cada ligação da sala (spec 7), pelo número de convidados, contando os chamados: o mínimo, campo a
// campo, entre a escolhida e o teto da linha (1: a escolhida; 2 ou 3: até 640x480, 25 qps e 800 kbit/s; 4 ou 5: até
// 640x480, 15 qps e 600 kbit/s). Nunca sobe a escolhida.
QualityValues RoomQuality(VideoQuality chosen, int guests);

// A nossa câmera num mosaico de convidado (o mesmo valor do kLocalFrames).
constexpr int kHostTile = -1;

// Os quadros do mosaico de um convidado: a nossa câmera primeiro e os outros da sala, na mesma ordem, sem ele.
std::vector<int> GuestTiles(const std::vector<int>& inRoom, int guest);

// O mosaico de quem montou a sala: 1280x720, a 25 qps.
constexpr int kHostMosaicWidth = 1280;
constexpr int kHostMosaicHeight = 720;
constexpr int kHostMosaicFps = 25;

// O fundo (as faixas e o quadro sem imagem): o #04060e da página, em I420 BT.601 de faixa limitada.
constexpr uint8_t kMosaicBackgroundY = 21, kMosaicBackgroundU = 132, kMosaicBackgroundV = 127;

// A imagem que o mosaico escreve (os planos e os passos).
struct I420Target {
    int width = 0;
    int height = 0;
    uint8_t* y = nullptr; int yStride = 0;
    uint8_t* u = nullptr; int uStride = 0;
    uint8_t* v = nullptr; int vStride = 0;
};

// O fundo em toda a imagem, e cada quadro (nullptr: sem imagem) encaixado na sua célula de
// MosaicCells(tiles.size(), out.width, out.height), pelo libyuv::I420Scale com o kFilterBilinear. Fora de 1 a 5
// quadros, só o fundo. Só com o vídeo da PJSIP (sem ele, o Android, o arquivo é vazio).
void ComposeMosaic(const std::vector<const I420Frame*>& tiles, const I420Target& out);

}  // namespace starsonic
