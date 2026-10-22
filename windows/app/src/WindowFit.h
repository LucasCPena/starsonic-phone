// O tamanho e a posicao da janela principal (spec da W1, 7.4; rc.2: a janela muda de tamanho pela borda ou pelo
// canto). O tamanho e o da area da interface (a area cliente, sem as bordas invisiveis de redimensionar), em pixels
// logicos (os de 100% de escala): 400x720 por padrao, ou o que a pessoa escolheu (gravado no config.json), nunca menor
// que 300x440 e cortado na area de trabalho do monitor (a de um notebook de 1920x1080 a 150% tem uns 688 logicos,
// menos que os 720); a janela sempre inteira dentro da area de trabalho. Quando a area de trabalho e menor que o
// minimo, o minimo vale. Conta portatil, sem o windows.h: o executavel passa o rcWork do monitor e o DPI dele
// (testada tambem no Linux, tests/desktop).
#pragma once

#include <optional>

namespace starsonic {

constexpr int kWindowWidth = 400;    // pixels logicos: o padrao
constexpr int kWindowHeight = 720;
constexpr int kMinWindowWidth = 300;   // o menor tamanho (o layout Minimo da interface)
constexpr int kMinWindowHeight = 440;

struct FitArea {   // a area de trabalho do monitor (rcWork), em pixels fisicos
    int left = 0;
    int top = 0;
    int right = 0;
    int bottom = 0;
};

struct FitBox {   // a area da interface na tela, em pixels fisicos
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

struct WindowPosition {   // o canto de cima a esquerda pedido (a posicao gravada ou a que o Windows sugeriu)
    int x = 0;
    int y = 0;
};

struct WindowSize {   // o tamanho pedido, em pixels logicos
    int width = kWindowWidth;
    int height = kWindowHeight;
};

// value pixels logicos em pixels fisicos no DPI dado (arredondado como o MulDiv do Windows).
int ScaleToDpi(int value, unsigned dpi);
// O contrario: pixels fisicos no DPI dado em pixels logicos (arredondado; ScaleFromDpi(ScaleToDpi(v)) == v).
int ScaleFromDpi(int value, unsigned dpi);

// A janela no monitor dessa area de trabalho e desse DPI: o tamanho pedido (sem ele, 400x720 logicos), nunca menor que
// 300x440 logicos, cortado na area de trabalho (mas nao abaixo do minimo); sem posicao, no centro; com posicao, nela,
// empurrada para dentro da area de trabalho quando sairia (numa area menor que a janela, encostada no canto de cima a
// esquerda).
FitBox FitWindow(const FitArea& work, unsigned dpi, const std::optional<WindowPosition>& position,
                 const std::optional<WindowSize>& size = std::nullopt);

}  // namespace starsonic
