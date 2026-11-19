// O mosaico da sala (starsonic/phone/RoomMosaic.cpp): as células, o encaixe sem deformar, os quadros de 0 a 1, a
// qualidade da sala, os quadros de cada convidado e a montagem da imagem (o libyuv). Sem motor.
#include <pjmedia/config.h>

#if PJMEDIA_HAS_VIDEO

#include "test_support.h"

#include <cstdint>
#include <vector>

#include "RoomMosaic.h"

using namespace starsonic;

namespace {

using Cells = std::vector<PixelRect>;

// Uma imagem I420 de cor única, com os planos próprios.
struct SolidImage {
    int width;
    int height;
    std::vector<uint8_t> y, u, v;
    SolidImage(int w, int h, uint8_t yv, uint8_t uv, uint8_t vv)
        : width(w), height(h), y(static_cast<size_t>(w) * h, yv),
          u(static_cast<size_t>((w + 1) / 2) * ((h + 1) / 2), uv),
          v(static_cast<size_t>((w + 1) / 2) * ((h + 1) / 2), vv) {}
    I420Frame Frame() const {
        I420Frame frame;
        frame.width = width;
        frame.height = height;
        frame.y = y.data();
        frame.yStride = width;
        frame.u = u.data();
        frame.uStride = (width + 1) / 2;
        frame.v = v.data();
        frame.vStride = (width + 1) / 2;
        return frame;
    }
};

// O destino do mosaico, com os planos e os passos justos.
struct Canvas {
    std::vector<uint8_t> y, u, v;
    I420Target target;
    Canvas(int w, int h)
        : y(static_cast<size_t>(w) * h, 0), u(static_cast<size_t>((w + 1) / 2) * ((h + 1) / 2), 0),
          v(static_cast<size_t>((w + 1) / 2) * ((h + 1) / 2), 0) {
        target.width = w;
        target.height = h;
        target.y = y.data();
        target.yStride = w;
        target.u = u.data();
        target.uStride = (w + 1) / 2;
        target.v = v.data();
        target.vStride = (w + 1) / 2;
    }
    bool Is(int px, int py, uint8_t yv, uint8_t uv, uint8_t vv) const {
        const size_t c = static_cast<size_t>(py / 2) * target.uStride + px / 2;
        return y[static_cast<size_t>(py) * target.yStride + px] == yv && u[c] == uv && v[c] == vv;
    }
    bool IsBackground(int px, int py) const {
        return Is(px, py, kMosaicBackgroundY, kMosaicBackgroundU, kMosaicBackgroundV);
    }
};

bool SameValues(const QualityValues& values, int width, int height, int fps, int kbps) {
    return values.width == width && values.height == height && values.fps == fps && values.kbps == kbps;
}

}  // namespace

TEST_CASE("the cells follow the room's layout for 1 to 5 images at each output size") {
    SUBCASE("1280x720") {
        CHECK(MosaicCells(1, 1280, 720) == Cells{{0, 0, 1280, 720}});
        CHECK(MosaicCells(2, 1280, 720) == Cells{{0, 0, 640, 720}, {640, 0, 640, 720}});
        CHECK(MosaicCells(3, 1280, 720) == Cells{{0, 0, 640, 360}, {640, 0, 640, 360}, {320, 360, 640, 360}});
        CHECK(MosaicCells(4, 1280, 720) ==
              Cells{{0, 0, 640, 360}, {640, 0, 640, 360}, {0, 360, 640, 360}, {640, 360, 640, 360}});
        CHECK(MosaicCells(5, 1280, 720) == Cells{{0, 0, 426, 360}, {426, 0, 426, 360}, {852, 0, 426, 360},
                                                 {214, 360, 426, 360}, {640, 360, 426, 360}});
    }
    SUBCASE("640x480") {
        CHECK(MosaicCells(1, 640, 480) == Cells{{0, 0, 640, 480}});
        CHECK(MosaicCells(2, 640, 480) == Cells{{0, 0, 320, 480}, {320, 0, 320, 480}});
        CHECK(MosaicCells(3, 640, 480) == Cells{{0, 0, 320, 240}, {320, 0, 320, 240}, {160, 240, 320, 240}});
        CHECK(MosaicCells(4, 640, 480) ==
              Cells{{0, 0, 320, 240}, {320, 0, 320, 240}, {0, 240, 320, 240}, {320, 240, 320, 240}});
        CHECK(MosaicCells(5, 640, 480) == Cells{{2, 0, 212, 240}, {214, 0, 212, 240}, {426, 0, 212, 240},
                                                {108, 240, 212, 240}, {320, 240, 212, 240}});
    }
    SUBCASE("320x240") {
        CHECK(MosaicCells(1, 320, 240) == Cells{{0, 0, 320, 240}});
        CHECK(MosaicCells(2, 320, 240) == Cells{{0, 0, 160, 240}, {160, 0, 160, 240}});
        CHECK(MosaicCells(3, 320, 240) == Cells{{0, 0, 160, 120}, {160, 0, 160, 120}, {80, 120, 160, 120}});
        CHECK(MosaicCells(4, 320, 240) ==
              Cells{{0, 0, 160, 120}, {160, 0, 160, 120}, {0, 120, 160, 120}, {160, 120, 160, 120}});
        CHECK(MosaicCells(5, 320, 240) == Cells{{0, 0, 106, 120}, {106, 0, 106, 120}, {212, 0, 106, 120},
                                                {54, 120, 106, 120}, {160, 120, 106, 120}});
    }
    SUBCASE("outside 1 to 5 there are no cells") {
        CHECK(MosaicCells(0, 1280, 720).empty());
        CHECK(MosaicCells(6, 1280, 720).empty());
        CHECK(MosaicCells(0, 320, 240).empty());
        CHECK(MosaicCells(6, 320, 240).empty());
    }
}

TEST_CASE("an image fits its cell without distortion, centered on even pixels") {
    CHECK(FitInside(640, 480, {0, 0, 640, 360}) == PixelRect{80, 0, 480, 360});
    CHECK(FitInside(1280, 720, {0, 0, 640, 720}) == PixelRect{0, 180, 640, 360});
    CHECK(FitInside(175, 143, {0, 0, 320, 240}) == PixelRect{14, 0, 292, 240});
    CHECK(FitInside(0, 0, {0, 0, 320, 240}) == PixelRect{});
    CHECK(FitInside(1, 1, {0, 0, 2, 2}) == PixelRect{0, 0, 2, 2});
}

TEST_CASE("the unit tiles of the host's mosaic go from 0 to 1") {
    const RoomTile half = UnitTile({640, 0, 640, 720}, 1280, 720);
    CHECK(half.x == 0.5);
    CHECK(half.y == 0.0);
    CHECK(half.width == 0.5);
    CHECK(half.height == 1.0);
    const RoomTile fifth = UnitTile({426, 0, 426, 360}, 1280, 720);
    CHECK(fifth.x == 426.0 / 1280);
    CHECK(fifth.y == 0.0);
    CHECK(fifth.width == 426.0 / 1280);
    CHECK(fifth.height == 0.5);
}

TEST_CASE("the room's quality follows spec 7 and never raises the chosen one") {
    CHECK(SameValues(RoomQuality(VideoQuality::High, 1), 1280, 720, 30, 1500));
    CHECK(SameValues(RoomQuality(VideoQuality::High, 2), 640, 480, 25, 800));
    CHECK(SameValues(RoomQuality(VideoQuality::Medium, 3), 640, 480, 25, 800));
    CHECK(SameValues(RoomQuality(VideoQuality::High, 4), 640, 480, 15, 600));
    CHECK(SameValues(RoomQuality(VideoQuality::Medium, 5), 640, 480, 15, 600));
    CHECK(SameValues(RoomQuality(VideoQuality::Low, 3), 320, 240, 15, 300));
    CHECK(SameValues(RoomQuality(VideoQuality::Low, 5), 320, 240, 15, 300));
}

TEST_CASE("a guest's mosaic has us first and the others in order, never the guest") {
    CHECK(GuestTiles({11, 13, 14}, 13) == std::vector<int>{kHostTile, 11, 14});
    CHECK(GuestTiles({11, 13}, 11) == std::vector<int>{kHostTile, 13});
    CHECK(GuestTiles({11}, 11) == std::vector<int>{kHostTile});
}

TEST_CASE("the mosaic puts each color in its cell with the background in the bars and in the empty cells") {
    const SolidImage orange(64, 48, 150, 44, 200);
    const SolidImage purple(175, 143, 60, 200, 180);
    const I420Frame orangeFrame = orange.Frame();
    const I420Frame purpleFrame = purple.Frame();
    Canvas canvas(320, 240);
    ComposeMosaic({&orangeFrame, &purpleFrame, nullptr}, canvas.target);

    CHECK(canvas.Is(80, 60, 150, 44, 200));    // o centro da célula (0,0,160,120)
    CHECK(canvas.Is(240, 60, 60, 200, 180));   // o centro da célula (160,0,160,120)
    CHECK(canvas.IsBackground(160, 180));      // o centro da célula vazia (80,120,160,120)
    CHECK(canvas.IsBackground(0, 239));        // os cantos da linha de baixo
    CHECK(canvas.IsBackground(319, 239));
    CHECK(canvas.IsBackground(0, 120));
    CHECK(canvas.IsBackground(319, 120));
    // O roxo (175x143 numa célula de 160x120) fica em {166,0,146,120}: as faixas são o fundo.
    for (int x = 160; x <= 165; ++x) CHECK(canvas.IsBackground(x, 60));
    CHECK(canvas.Is(166, 60, 60, 200, 180));
    CHECK(canvas.Is(311, 60, 60, 200, 180));
    CHECK(canvas.IsBackground(312, 60));
}

TEST_CASE("odd image sizes keep the chroma under the luma") {
    // Um quadro 175x143: a metade da esquerda (colunas 0 a 86) de uma cor e a da direita de outra, cada uma com o Y, o
    // U e o V dela. O plano de cor tem (175+1)/2 colunas.
    const int w = 175, h = 143;
    SolidImage image(w, h, 50, 60, 70);
    const int cw = (w + 1) / 2, ch = (h + 1) / 2;
    for (int x = 87; x < w; ++x) {
        for (int y = 0; y < h; ++y) image.y[static_cast<size_t>(y) * w + x] = 200;
    }
    for (int cx = 44; cx < cw; ++cx) {
        for (int cy = 0; cy < ch; ++cy) {
            image.u[static_cast<size_t>(cy) * cw + cx] = 180;
            image.v[static_cast<size_t>(cy) * cw + cx] = 190;
        }
    }
    const I420Frame frame = image.Frame();
    Canvas canvas(320, 240);
    ComposeMosaic({&frame}, canvas.target);

    const PixelRect fit = FitInside(w, h, MosaicCells(1, 320, 240)[0]);
    CHECK(fit == PixelRect{14, 0, 292, 240});
    const int middle = fit.x + fit.width / 2;
    int checked = 0;
    for (int y = fit.y; y < fit.y + fit.height; y += 2) {
        for (int x = fit.x; x < fit.x + fit.width; x += 2) {
            if (x > middle - 6 && x < middle + 6) continue;   // a emenda, onde o filtro mistura
            const bool left = x < middle;
            CHECK(canvas.Is(x, y, left ? 50 : 200, left ? 60 : 180, left ? 70 : 190));
            ++checked;
        }
    }
    CHECK(checked > 1000);
    CHECK(canvas.IsBackground(10, 100));   // as faixas
    CHECK(canvas.IsBackground(310, 100));
}

TEST_CASE("an odd output size leaves the last row and column as background") {
    const SolidImage orange(64, 48, 150, 44, 200);
    const I420Frame frame = orange.Frame();
    Canvas canvas(321, 241);
    ComposeMosaic({&frame}, canvas.target);
    CHECK(canvas.Is(160, 120, 150, 44, 200));
    for (int y = 0; y < 241; ++y) CHECK(canvas.IsBackground(320, y));
    for (int x = 0; x < 321; ++x) CHECK(canvas.IsBackground(x, 240));
}

#endif  // PJMEDIA_HAS_VIDEO
