#include "MeetingLinks.h"

#include "ChatFiles.h"
#include "Reunioes.h"

namespace starsonic {

std::string MeetingBrowserUrl(const std::string& code, const std::string& pass) {
    if (!ValidMeetingCode(code)) return std::string();
    if (!pass.empty() && !ValidMeetingPass(pass)) return std::string();
    std::string url = std::string(kChatOrigin) + "/r/" + code;
    if (!pass.empty()) url += "#p=" + pass;
    return url;
}

}  // namespace starsonic
