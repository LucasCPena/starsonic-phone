#include <pjmedia/config.h>

#if PJMEDIA_HAS_VIDEO

#include "RoomMosaic.h"

#include <libyuv/scale.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace starsonic {

namespace {

// O maior par que não passa de v (v >= 0).
int64_t Even(int64_t v) { return v & ~static_cast<int64_t>(1); }

// Pinta um plano width x height com um valor.
void FillPlane(uint8_t* plane, int stride, int width, int height, uint8_t value) {
    for (int row = 0; row < height; ++row) std::memset(plane + static_cast<size_t>(row) * stride, value, width);
}

}  // namespace

bool operator==(const PixelRect& a, const PixelRect& b) {
    return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
}

std::vector<PixelRect> MosaicCells(int count, int width, int height) {
    std::vector<PixelRect> cells;
    if (count < 1 || count > 5) return cells;
    const int64_t perRow = count == 1 ? 1 : (count <= 4 ? 2 : 3);
    const int64_t rows = (count + perRow - 1) / perRow;
    const int64_t cw = Even(width / perRow);
    const int64_t ch = Even(height / rows);
    const int64_t y0 = Even((height - rows * ch) / 2);
    for (int64_t r = 0; r < rows; ++r) {
        const int64_t n = std::min<int64_t>(perRow, count - r * perRow);
        const int64_t x0 = Even((width - n * cw) / 2);
        for (int64_t i = 0; i < n; ++i) {
            cells.push_back({static_cast<int>(x0 + i * cw), static_cast<int>(y0 + r * ch), static_cast<int>(cw),
                             static_cast<int>(ch)});
        }
    }
    return cells;
}

PixelRect FitInside(int sourceWidth, int sourceHeight, const PixelRect& cell) {
    if (sourceWidth <= 0 || sourceHeight <= 0) return {};
    const int64_t sw = sourceWidth, sh = sourceHeight;
    int64_t w, h;
    if (sw * cell.height >= sh * cell.width) {
        w = cell.width;
        h = std::max<int64_t>(2, Even(sh * cell.width / sw));
    } else {
        h = cell.height;
        w = std::max<int64_t>(2, Even(sw * cell.height / sh));
    }
    return {static_cast<int>(cell.x + Even((cell.width - w) / 2)), static_cast<int>(cell.y + Even((cell.height - h) / 2)),
            static_cast<int>(w), static_cast<int>(h)};
}

RoomTile UnitTile(const PixelRect& cell, int width, int height) {
    return {static_cast<double>(cell.x) / width, static_cast<double>(cell.y) / height,
            static_cast<double>(cell.width) / width, static_cast<double>(cell.height) / height};
}

QualityValues RoomQuality(VideoQuality chosen, int guests) {
    QualityValues v = ValuesOf(chosen);
    if (guests <= 1) return v;
    const int fps = guests <= 3 ? 25 : 15;
    const int kbps = guests <= 3 ? 800 : 600;
    return {std::min(v.width, 640), std::min(v.height, 480), std::min(v.fps, fps), std::min(v.kbps, kbps)};
}

std::vector<int> GuestTiles(const std::vector<int>& inRoom, int guest) {
    std::vector<int> tiles{kHostTile};
    for (int id : inRoom) {
        if (id != guest) tiles.push_back(id);
    }
    return tiles;
}

void ComposeMosaic(const std::vector<const I420Frame*>& tiles, const I420Target& out) {
    if (out.width <= 0 || out.height <= 0 || !out.y || !out.u || !out.v) return;
    const int chromaWidth = (out.width + 1) / 2, chromaHeight = (out.height + 1) / 2;
    FillPlane(out.y, out.yStride, out.width, out.height, kMosaicBackgroundY);
    FillPlane(out.u, out.uStride, chromaWidth, chromaHeight, kMosaicBackgroundU);
    FillPlane(out.v, out.vStride, chromaWidth, chromaHeight, kMosaicBackgroundV);

    const std::vector<PixelRect> cells = MosaicCells(static_cast<int>(tiles.size()), out.width, out.height);
    for (size_t i = 0; i < cells.size(); ++i) {
        const I420Frame* frame = tiles[i];
        if (!frame || !frame->y || !frame->u || !frame->v) continue;
        const PixelRect fit = FitInside(frame->width, frame->height, cells[i]);
        if (fit.width <= 0 || fit.height <= 0) continue;
        libyuv::I420Scale(frame->y, frame->yStride, frame->u, frame->uStride, frame->v, frame->vStride, frame->width,
                          frame->height, out.y + static_cast<size_t>(fit.y) * out.yStride + fit.x, out.yStride,
                          out.u + static_cast<size_t>(fit.y / 2) * out.uStride + fit.x / 2, out.uStride,
                          out.v + static_cast<size_t>(fit.y / 2) * out.vStride + fit.x / 2, out.vStride, fit.width,
                          fit.height, libyuv::kFilterBilinear);
    }
}

}  // namespace starsonic

#endif  // PJMEDIA_HAS_VIDEO
