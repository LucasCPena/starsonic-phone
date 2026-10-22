// O tamanho e a posicao da janela principal (windows/app/src/WindowFit.h): 400 de largura e 720 de altura em pixels
// logicos, a altura cortada na da area de trabalho do monitor (a de 1920x1080 a 150% tem uns 688 logicos), e a janela
// sempre dentro da area de trabalho.
#include "test_support.h"

#include "WindowFit.h"

using starsonic::FitArea;
using starsonic::FitBox;
using starsonic::FitWindow;
using starsonic::WindowPosition;

namespace {

bool Inside(const FitBox& box, const FitArea& work) {
    return box.x >= work.left && box.y >= work.top && box.x + box.width <= work.right &&
           box.y + box.height <= work.bottom;
}

}  // namespace

TEST_CASE("at 100% the window is 400x720 and centered in the work area, as before") {
    const FitArea work = {0, 0, 1024, 728};   // o runner do CI: 1024x768 com a barra de tarefas
    const FitBox box = FitWindow(work, 96, std::nullopt);
    CHECK(box.width == 400);
    CHECK(box.height == 720);
    CHECK(box.x == 312);
    CHECK(box.y == 4);
    // A posicao gravada que cabe fica como esta.
    const FitBox saved = FitWindow({0, 0, 1920, 1040}, 96, WindowPosition{100, 200});
    CHECK(saved.x == 100);
    CHECK(saved.y == 200);
    CHECK(saved.width == 400);
    CHECK(saved.height == 720);
}

TEST_CASE("at 150% on 1920x1080 the height is cut to the work area and the width stays 400 logical") {
    const FitArea work = {0, 0, 1920, 1032};   // 1080 menos a barra de tarefas de 48 pixels
    const FitBox box = FitWindow(work, 144, std::nullopt);
    CHECK(box.width == 600);      // 400 logicos
    CHECK(box.height == 1032);    // nao os 1080 (720 logicos)
    CHECK(box.height <= work.bottom - work.top);
    CHECK(Inside(box, work));
    // A 125% num 1366x768 (a barra de 40 pixels): 500 de largura, a altura toda da area de trabalho.
    const FitBox small = FitWindow({0, 0, 1366, 728}, 120, std::nullopt);
    CHECK(small.width == 500);
    CHECK(small.height == 728);
    CHECK(small.y == 0);
}

TEST_CASE("a saved position that would leave the window outside the work area is moved inside") {
    const FitArea work = {0, 0, 1920, 1032};
    const FitBox low = FitWindow(work, 96, WindowPosition{1700, 600});
    CHECK(Inside(low, work));
    CHECK(low.x == 1520);   // a direita encostada na borda
    CHECK(low.y == 312);    // o pe encostado na barra de tarefas
    const FitBox high = FitWindow(work, 96, WindowPosition{-50, -20});
    CHECK(high.x == 0);
    CHECK(high.y == 0);
    // Um monitor a esquerda do principal (coordenadas negativas) e a 150%.
    const FitArea left = {-1920, 0, 0, 1032};
    const FitBox other = FitWindow(left, 144, WindowPosition{-700, 100});
    CHECK(Inside(other, left));
    CHECK(other.width == 600);
    CHECK(other.x == -700);
    CHECK(other.y == 0);
}

TEST_CASE("a work area narrower than the window keeps the width and starts at the left edge") {
    const FitArea work = {0, 0, 380, 600};
    const FitBox box = FitWindow(work, 96, WindowPosition{50, 0});
    CHECK(box.width == 400);
    CHECK(box.x == 0);
    CHECK(box.height == 600);
}
