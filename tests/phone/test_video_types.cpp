// Os tipos portáteis do vídeo (starsonic/phone/Video.cpp): a qualidade, a ordem dos codecs e os Porteiros. Sem motor.
#include "test_support.h"

#include <vector>

#include "Video.h"

using namespace starsonic;

namespace {

bool SameValues(const QualityValues& values, int width, int height, int fps, int kbps) {
    return values.width == width && values.height == height && values.fps == fps && values.kbps == kbps;
}

}  // namespace

TEST_CASE("ValuesOf gives the spec's three qualities") {
    CHECK(SameValues(ValuesOf(VideoQuality::Low), 320, 240, 15, 300));
    CHECK(SameValues(ValuesOf(VideoQuality::Medium), 640, 480, 25, 800));
    CHECK(SameValues(ValuesOf(VideoQuality::High), 1280, 720, 30, 1500));
}

TEST_CASE("CodecOrder puts the first codec ahead and drops the off and unavailable ones") {
    VideoSettings settings;
    settings.h264Available = true;

    SUBCASE("the factory settings with H264 available") {
        CHECK(CodecOrder(settings) == std::vector<VideoCodec>{VideoCodec::H264, VideoCodec::Vp8});
        CHECK(VideoEnabled(settings));
    }
    SUBCASE("VP8 first and VP9 on") {
        settings.first = VideoCodec::Vp8;
        settings.vp9 = true;
        CHECK(CodecOrder(settings) == std::vector<VideoCodec>{VideoCodec::Vp8, VideoCodec::H264, VideoCodec::Vp9});
    }
    SUBCASE("H264 not available") {
        settings.h264Available = false;
        CHECK(CodecOrder(settings) == std::vector<VideoCodec>{VideoCodec::Vp8});
        CHECK(VideoEnabled(settings));
    }
    SUBCASE("everything off") {
        settings.h264 = false;
        settings.vp8 = false;
        settings.vp9 = false;
        CHECK(CodecOrder(settings).empty());
        CHECK_FALSE(VideoEnabled(settings));
    }
}

TEST_CASE("IsDoorphone compares only the digits") {
    VideoSettings settings;
    settings.doorphones = {"9001"};
    CHECK(IsDoorphone(settings, "9001"));
    CHECK_FALSE(IsDoorphone(settings, "9002"));
    CHECK(IsDoorphone(settings, "+9001"));      // só os dígitos de quem liga contam
    CHECK_FALSE(IsDoorphone(settings, ""));
    CHECK_FALSE(IsDoorphone(VideoSettings(), "9001"));
}

TEST_CASE("CodecName gives the SDP names") {
    CHECK(CodecName(VideoCodec::H264) == "H264");
    CHECK(CodecName(VideoCodec::Vp8) == "VP8");
    CHECK(CodecName(VideoCodec::Vp9) == "VP9");
}

TEST_CASE("CallVideo compares every field") {
    CallVideo a;
    CallVideo b;
    CHECK(a == b);
    b.refused = true;
    CHECK_FALSE(a == b);
    b = a;
    b.early = true;
    CHECK_FALSE(a == b);
}
