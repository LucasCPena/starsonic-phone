#include "UpdateChannel.h"

namespace starsonic {

void UpdateChannel::Set(const std::string& channel) {
    int choice = kBuild;
    if (channel == "teste") {
        choice = kTest;
    } else if (channel == "estavel") {
        choice = kStable;
    }
    choice_.store(choice);
}

bool UpdateChannel::Test() const {
    switch (choice_.load()) {
        case kTest:
            return true;
        case kStable:
            return false;
        default:
            return buildTest_;
    }
}

}  // namespace starsonic
