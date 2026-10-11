#include "test_support.h"
#include "LayoutCollapse.h"

#include <vector>

using namespace starsonic;

namespace {

const int kSplit = 290;

// Linha de 14 px; coluna 0 começa em 0, coluna 1 em 300.
LayoutBox Box(int id, int left, int top, bool hidden = false, bool isStaticText = false, int width = 200) {
    return LayoutBox{id, left, top, left + width, top + 14, hidden, isStaticText};
}

const LayoutBox* Find(const CollapseResult& result, int id) {
    for (const LayoutBox& box : result.boxes) {
        if (box.id == id) return &box;
    }
    return nullptr;
}

int TopOf(const CollapseResult& result, int id) {
    const LayoutBox* box = Find(result, id);
    REQUIRE(box != nullptr);
    return box->top;
}

bool HiddenOf(const CollapseResult& result, int id) {
    const LayoutBox* box = Find(result, id);
    REQUIRE(box != nullptr);
    return box->hidden;
}

}  // namespace

TEST_CASE("moves rows below hidden row up") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 18, true), Box(3, 0, 36)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    REQUIRE(result.boxes.size() == 3);
    CHECK(TopOf(result, 1) == 0);
    CHECK(TopOf(result, 3) == 18);
    CHECK(Find(result, 3)->bottom == 32);
    CHECK(TopOf(result, 2) == 18);   // escondida fica onde estava
}

TEST_CASE("other column does not move") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 18, true), Box(3, 0, 36),
                                          Box(4, 300, 18), Box(5, 300, 36)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(TopOf(result, 3) == 18);
    CHECK(TopOf(result, 4) == 18);
    CHECK(TopOf(result, 5) == 36);
}

TEST_CASE("hides orphan label on hidden row") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 110, 18, true, false, 170),
                                          Box(3, 0, 20, false, true, 100), Box(4, 0, 36)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(HiddenOf(result, 3));
    CHECK(TopOf(result, 4) == 18);
}

TEST_CASE("keeps label on row with visible control") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 18, false, true, 100), Box(2, 110, 18, true, false, 80),
                                          Box(3, 200, 18, false, false, 80), Box(4, 0, 36)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK_FALSE(HiddenOf(result, 1));
    CHECK(TopOf(result, 4) == 36);
}

TEST_CASE("label next to hidden control in the other column stays") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 20, false, true, 100), Box(2, 300, 18, true)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK_FALSE(HiddenOf(result, 1));
}

TEST_CASE("hidden box overlapping visible row does not collapse") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 18), Box(3, 0, 30, true), Box(4, 0, 36)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(TopOf(result, 2) == 18);
    CHECK(TopOf(result, 4) == 36);
    CHECK(result.heightReduction == 0);
}

TEST_CASE("two hidden rows collapse cumulatively") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 18, true), Box(3, 0, 36, true), Box(4, 0, 54)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(TopOf(result, 4) == 18);
    CHECK(result.heightReduction == 36);
}

TEST_CASE("separate hidden bands each pull the rows below") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 18, true), Box(3, 0, 36),
                                          Box(4, 0, 54, true), Box(5, 0, 72)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(TopOf(result, 3) == 18);
    CHECK(TopOf(result, 5) == 36);
    CHECK(result.heightReduction == 36);
}

TEST_CASE("height reduction compares all input boxes with visible output") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 18), Box(3, 0, 36, true)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(TopOf(result, 2) == 18);
    CHECK(result.heightReduction == 18);
}

TEST_CASE("taller column keeps dialog height") {
    const std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 18, true), Box(3, 0, 36),
                                          Box(4, 300, 0), Box(5, 300, 18), Box(6, 300, 36), Box(7, 300, 54)};
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(TopOf(result, 3) == 18);
    CHECK(result.heightReduction == 0);
}

TEST_CASE("zero-height hidden box moves nothing") {
    std::vector<LayoutBox> boxes = {Box(1, 0, 0), Box(2, 0, 33, true), Box(3, 0, 36)};
    boxes[1].bottom = boxes[1].top;
    const CollapseResult result = CollapseHidden(boxes, kSplit);
    CHECK(TopOf(result, 3) == 36);
}

TEST_CASE("nothing hidden or nothing visible keeps everything") {
    const std::vector<LayoutBox> visible = {Box(1, 0, 0), Box(2, 0, 18)};
    CollapseResult result = CollapseHidden(visible, kSplit);
    CHECK(TopOf(result, 2) == 18);
    CHECK(result.heightReduction == 0);
    const std::vector<LayoutBox> hidden = {Box(1, 0, 0, true), Box(2, 0, 18, true)};
    result = CollapseHidden(hidden, kSplit);
    CHECK(result.heightReduction == 0);
    CHECK(CollapseHidden(std::vector<LayoutBox>(), kSplit).heightReduction == 0);
}
