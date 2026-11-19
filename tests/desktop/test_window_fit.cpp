// O tamanho e a posicao da janela principal (windows/app/src/WindowFit.h): 400 de largura e 720 de altura em pixels
// logicos, ou o tamanho que a pessoa escolheu (gravado no config.json), nunca menor que 300x440 logicos e cortado na
// area de trabalho do monitor (a de 1920x1080 a 150% tem uns 688 logicos), e a janela sempre dentro da area de
// trabalho.
#include "test_support.h"

#include "WindowFit.h"

using starsonic::FitArea;
using starsonic::FitBox;
using starsonic::FitWindow;
using starsonic::ScaleFromDpi;
using starsonic::ScaleToDpi;
using starsonic::WindowSize;
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

TEST_CASE("a work area narrower than the window cuts the width too, and starts at the left edge") {
    const FitArea work = {0, 0, 380, 600};
    const FitBox box = FitWindow(work, 96, WindowPosition{50, 0});
    CHECK(box.width == 380);
    CHECK(box.x == 0);
    CHECK(box.height == 600);
}

TEST_CASE("the saved size is used in logical pixels, at any scale") {
    const FitArea work = {0, 0, 1920, 1032};
    const FitBox compact = FitWindow(work, 96, WindowPosition{100, 200}, WindowSize{340, 560});
    CHECK(compact.width == 340);
    CHECK(compact.height == 560);
    CHECK(compact.x == 100);
    CHECK(compact.y == 200);
    // A 150%: os mesmos 340x560 logicos.
    const FitBox scaled = FitWindow(work, 144, WindowPosition{100, 100}, WindowSize{340, 560});
    CHECK(scaled.width == 510);
    CHECK(scaled.height == 840);
    // Sem posicao, no centro.
    const FitBox centered = FitWindow({0, 0, 1024, 728}, 96, std::nullopt, WindowSize{300, 440});
    CHECK(centered.width == 300);
    CHECK(centered.height == 440);
    CHECK(centered.x == 362);
    CHECK(centered.y == 144);
    // Maior: tambem vale.
    const FitBox large = FitWindow(work, 96, WindowPosition{0, 0}, WindowSize{600, 900});
    CHECK(large.width == 600);
    CHECK(large.height == 900);
}

TEST_CASE("a saved size bigger than the work area is cut to it, and the window stays inside") {
    const FitArea work = {0, 0, 1024, 728};
    const FitBox box = FitWindow(work, 96, WindowPosition{500, 300}, WindowSize{1400, 1000});
    CHECK(box.width == 1024);
    CHECK(box.height == 728);
    CHECK(box.x == 0);
    CHECK(box.y == 0);
    CHECK(Inside(box, work));
    // Num monitor a 150% a esquerda do principal.
    const FitArea left = {-1920, 0, 0, 1032};
    const FitBox other = FitWindow(left, 144, WindowPosition{-700, 100}, WindowSize{800, 900});
    CHECK(other.width == 1200);
    CHECK(other.height == 1032);
    CHECK(Inside(other, left));
}

TEST_CASE("the window never goes below the minimum of 300x440 logical") {
    // Um tamanho gravado menor que o minimo (um config.json editado a mao): o minimo.
    const FitBox small = FitWindow({0, 0, 1920, 1032}, 96, WindowPosition{10, 10}, WindowSize{120, 200});
    CHECK(small.width == 300);
    CHECK(small.height == 440);
    const FitBox scaled = FitWindow({0, 0, 1920, 1032}, 120, WindowPosition{10, 10}, WindowSize{120, 200});
    CHECK(scaled.width == 375);
    CHECK(scaled.height == 550);
    // A area de trabalho menor que o minimo: o minimo vale, encostado no canto de cima a esquerda.
    const FitBox tiny = FitWindow({0, 0, 280, 400}, 96, WindowPosition{40, 40}, WindowSize{340, 560});
    CHECK(tiny.width == 300);
    CHECK(tiny.height == 440);
    CHECK(tiny.x == 0);
    CHECK(tiny.y == 0);
    CHECK(starsonic::kMinWindowWidth == 300);
    CHECK(starsonic::kMinWindowHeight == 440);
}

TEST_CASE("physical pixels go back to the same logical size") {
    CHECK(ScaleFromDpi(510, 144) == 340);
    CHECK(ScaleFromDpi(840, 144) == 560);
    CHECK(ScaleFromDpi(400, 96) == 400);
    for (const unsigned dpi : {96u, 120u, 144u, 168u, 192u}) {
        for (const int logical : {300, 340, 379, 380, 440, 499, 560, 599, 720}) {
            CHECK(ScaleFromDpi(ScaleToDpi(logical, dpi), dpi) == logical);
        }
    }
}

TEST_CASE("the big box is 1280x800 at 100%") {
    const FitBox box = starsonic::BigVideoBox({0, 0, 1920, 1040}, 96);
    CHECK(box.x == 320);
    CHECK(box.y == 120);
    CHECK(box.width == 1280);
    CHECK(box.height == 800);
}

TEST_CASE("the big box at 150% is capped by the work area") {
    const FitBox box = starsonic::BigVideoBox({0, 0, 1920, 1040}, 144);
    CHECK(box.x == 0);
    CHECK(box.y == 0);
    CHECK(box.width == 1920);
    CHECK(box.height == 1040);
}

TEST_CASE("the big box is centered on a second monitor") {
    const FitBox box = starsonic::BigVideoBox({1920, 0, 3840, 1080}, 96);
    CHECK(box.x == 2240);
    CHECK(box.y == 140);
    CHECK(box.width == 1280);
    CHECK(box.height == 800);
}

TEST_CASE("the big box at 125% is 1600x1000, rounded and centered") {
    const FitBox box = starsonic::BigVideoBox({0, 0, 1920, 1040}, 120);
    CHECK(box.x == 160);
    CHECK(box.y == 20);
    CHECK(box.width == 1600);
    CHECK(box.height == 1000);
}

TEST_CASE("the big box of an empty work area never starts before the area") {
    const FitBox box = starsonic::BigVideoBox({0, 0, 0, 0}, 96);
    CHECK(box.x >= 0);
    CHECK(box.y >= 0);
    const FitBox shifted = starsonic::BigVideoBox({100, 50, 100, 50}, 96);
    CHECK(shifted.x >= 100);
    CHECK(shifted.y >= 50);
}

TEST_CASE("the notice box is 380 wide at the bottom right") {
    FitBox box = starsonic::NoticeBox({0, 0, 1920, 1040}, 96, 168);
    CHECK(box.x == 1528);
    CHECK(box.y == 860);
    CHECK(box.width == 380);
    CHECK(box.height == 168);
    box = starsonic::NoticeBox({0, 0, 1920, 1040}, 96, 430);
    CHECK(box.x == 1528);
    CHECK(box.y == 598);
    CHECK(box.width == 380);
    CHECK(box.height == 430);
}

TEST_CASE("the notice box follows the scale") {
    const FitBox box = starsonic::NoticeBox({0, 0, 1920, 1040}, 144, 430);
    CHECK(box.x == 1332);
    CHECK(box.y == 377);
    CHECK(box.width == 570);
    CHECK(box.height == 645);
}

TEST_CASE("the notice box is on its own monitor") {
    const FitBox box = starsonic::NoticeBox({1920, 0, 3840, 1040}, 96, 222);
    CHECK(box.x == 3448);
    CHECK(box.y == 806);
    CHECK(box.width == 380);
    CHECK(box.height == 222);
}

TEST_CASE("a short work area cuts the notice height") {
    const FitBox box = starsonic::NoticeBox({0, 0, 800, 400}, 96, 430);
    CHECK(box.x == 408);
    CHECK(box.y == 12);
    CHECK(box.width == 380);
    CHECK(box.height == 376);
}
