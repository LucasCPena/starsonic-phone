// O tamanho e a posicao da janela principal (spec da W1, 7.4): 400x720 pixels logicos (os de 100% de escala), com a
// altura cortada na da area de trabalho do monitor (a de um notebook de 1920x1080 a 150% tem uns 688 logicos, menos
// que os 720), e a janela sempre inteira dentro da area de trabalho. A largura nao muda. Conta portatil, sem o
// windows.h: o executavel passa o rcWork do monitor e o DPI dele (testada tambem no Linux, tests/desktop).
#pragma once

#include <optional>

namespace starsonic {

constexpr int kWindowWidth = 400;    // pixels logicos
constexpr int kWindowHeight = 720;

struct FitArea {   // a area de trabalho do monitor (rcWork), em pixels fisicos
    int left = 0;
    int top = 0;
    int right = 0;
    int bottom = 0;
};

struct FitBox {   // a janela, em pixels fisicos
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

struct WindowPosition {   // o canto de cima a esquerda pedido (a posicao gravada ou a que o Windows sugeriu)
    int x = 0;
    int y = 0;
};

// value pixels logicos em pixels fisicos no DPI dado (arredondado como o MulDiv do Windows).
int ScaleToDpi(int value, unsigned dpi);

// A janela no monitor dessa area de trabalho e desse DPI: a largura de 400 logicos, a altura de 720 logicos ou a da
// area de trabalho, a que for menor; sem posicao, no centro; com posicao, nela, empurrada para dentro da area de
// trabalho quando sairia (numa area mais estreita que a janela, encostada na borda esquerda).
FitBox FitWindow(const FitArea& work, unsigned dpi, const std::optional<WindowPosition>& position);

}  // namespace starsonic
