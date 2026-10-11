#include "LayoutCollapse.h"

#include <algorithm>

namespace starsonic {
namespace {

bool Overlaps(const LayoutBox& a, const LayoutBox& b) {
    return a.top < b.bottom && b.top < a.bottom;
}

class Collapser {
public:
    Collapser(std::vector<LayoutBox>* boxes, int columnSplitX) : boxes_(*boxes), split_(columnSplitX) {}

    int Column(const LayoutBox& box) const { return box.left < split_ ? 0 : 1; }

    // Texto estático visível ao lado só de controles escondidos também some.
    void HideOrphanLabels() {
        std::vector<size_t> orphans;
        for (size_t i = 0; i < boxes_.size(); ++i) {
            const LayoutBox& label = boxes_[i];
            if (label.hidden || !label.isStaticText) continue;
            bool hiddenControl = false;
            bool visibleControl = false;
            for (size_t j = 0; j < boxes_.size(); ++j) {
                const LayoutBox& other = boxes_[j];
                if (j == i || other.isStaticText || Column(other) != Column(label) || !Overlaps(label, other)) continue;
                if (other.hidden) hiddenControl = true;
                else visibleControl = true;
            }
            if (hiddenControl && !visibleControl) orphans.push_back(i);
        }
        for (size_t i : orphans) boxes_[i].hidden = true;
    }

    // Fecha a banda escondida mais alta da coluna; false quando não há o que mover.
    bool CollapseTopBand(int column) {
        std::vector<const LayoutBox*> band;
        for (const LayoutBox& box : boxes_) {
            if (box.hidden && Column(box) == column && box.bottom > box.top && !OverlapsVisible(box, column)) {
                band.push_back(&box);
            }
        }
        if (band.empty()) return false;
        std::sort(band.begin(), band.end(),
                  [](const LayoutBox* a, const LayoutBox* b) { return a->top < b->top; });
        const int bandTop = band[0]->top;
        int bandEnd = band[0]->bottom;
        for (size_t i = 1; i < band.size() && band[i]->top < bandEnd; ++i) {
            bandEnd = std::max(bandEnd, band[i]->bottom);
        }
        bool found = false;
        int next = 0;
        for (const LayoutBox& box : boxes_) {
            if (!box.hidden && Column(box) == column && box.top >= bandEnd && (!found || box.top < next)) {
                next = box.top;
                found = true;
            }
        }
        if (!found) return false;
        const int shift = next - bandTop;
        // As escondidas abaixo também sobem, para as bandas seguintes continuarem no lugar certo.
        for (LayoutBox& box : boxes_) {
            if (Column(box) == column && box.top >= next) {
                box.top -= shift;
                box.bottom -= shift;
            }
        }
        return true;
    }

private:
    bool OverlapsVisible(const LayoutBox& hidden, int column) const {
        for (const LayoutBox& box : boxes_) {
            if (!box.hidden && Column(box) == column && Overlaps(box, hidden)) return true;
        }
        return false;
    }

    std::vector<LayoutBox>& boxes_;
    int split_;
};

}  // namespace

CollapseResult CollapseHidden(const std::vector<LayoutBox>& boxes, int columnSplitX) {
    CollapseResult result;
    result.boxes = boxes;
    result.heightReduction = 0;
    Collapser collapser(&result.boxes, columnSplitX);
    collapser.HideOrphanLabels();
    for (int column = 0; column < 2; ++column) {
        // Cada passo cobre ao menos mais uma caixa escondida, então o limite nunca é atingido.
        for (size_t step = 0; step <= result.boxes.size(); ++step) {
            if (!collapser.CollapseTopBand(column)) break;
        }
    }
    bool anyVisible = false;
    int visibleBottom = 0;
    for (const LayoutBox& box : result.boxes) {
        if (!box.hidden && (!anyVisible || box.bottom > visibleBottom)) {
            visibleBottom = box.bottom;
            anyVisible = true;
        }
    }
    if (anyVisible) {
        int inputBottom = visibleBottom;
        for (const LayoutBox& box : boxes) inputBottom = std::max(inputBottom, box.bottom);
        result.heightReduction = inputBottom - visibleBottom;
    }
    return result;
}

}  // namespace starsonic
