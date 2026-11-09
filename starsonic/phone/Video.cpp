#include "Video.h"

#include <cctype>

namespace starsonic {
namespace {

// Só os dígitos do texto.
std::string Digits(const std::string& text) {
    std::string digits;
    for (const char c : text) {
        if (std::isdigit(static_cast<unsigned char>(c))) digits += c;
    }
    return digits;
}

// O codec está ligado nas escolhas e disponível (o H.264 só com o módulo).
bool Usable(const VideoSettings& settings, VideoCodec codec) {
    switch (codec) {
        case VideoCodec::H264:
            return settings.h264 && settings.h264Available;
        case VideoCodec::Vp8:
            return settings.vp8;
        case VideoCodec::Vp9:
            return settings.vp9;
    }
    return false;
}

}  // namespace

QualityValues ValuesOf(VideoQuality quality) {
    switch (quality) {
        case VideoQuality::Low:
            return QualityValues{320, 240, 15, 300};
        case VideoQuality::High:
            return QualityValues{1280, 720, 30, 1500};
        case VideoQuality::Medium:
            break;
    }
    return QualityValues{640, 480, 25, 800};
}

std::string CodecName(VideoCodec codec) {
    switch (codec) {
        case VideoCodec::H264:
            return "H264";
        case VideoCodec::Vp8:
            return "VP8";
        case VideoCodec::Vp9:
            return "VP9";
    }
    return std::string();
}

std::vector<VideoCodec> CodecOrder(const VideoSettings& settings) {
    std::vector<VideoCodec> order;
    if (Usable(settings, settings.first)) order.push_back(settings.first);
    for (const VideoCodec codec : {VideoCodec::H264, VideoCodec::Vp8, VideoCodec::Vp9}) {
        if (codec != settings.first && Usable(settings, codec)) order.push_back(codec);
    }
    return order;
}

bool VideoEnabled(const VideoSettings& settings) { return !CodecOrder(settings).empty(); }

bool IsDoorphone(const VideoSettings& settings, const std::string& user) {
    const std::string digits = Digits(user);
    if (digits.empty()) return false;
    for (const std::string& doorphone : settings.doorphones) {
        if (Digits(doorphone) == digits) return true;
    }
    return false;
}

bool operator==(const CallVideo& a, const CallVideo& b) {
    return a.offered == b.offered && a.active == b.active && a.remote == b.remote && a.camera == b.camera &&
           a.early == b.early && a.refused == b.refused;
}

}  // namespace starsonic
