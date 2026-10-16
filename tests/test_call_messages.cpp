#include "test_support.h"
#include "CallMessages.h"

using namespace starsonic;

namespace {
const std::wstring kBusy = L"Ocupado";
const std::wstring kNotFound = L"N\u00famero n\u00e3o encontrado";
const std::wstring kNoAnswer = L"N\u00e3o atendeu";
}  // namespace

TEST_CASE("CallEndMessage maps the codes the user sees") {
    CHECK(CallEndMessage(486) == kBusy);
    CHECK(CallEndMessage(600) == kBusy);
    CHECK(CallEndMessage(404) == kNotFound);
    CHECK(CallEndMessage(484) == kNotFound);
    CHECK(CallEndMessage(604) == kNotFound);
    CHECK(CallEndMessage(408) == kNoAnswer);
    CHECK(CallEndMessage(480) == kNoAnswer);
    CHECK(CallEndMessage(403) == L"N\u00e3o foi poss\u00edvel completar a liga\u00e7\u00e3o (c\u00f3digo 403).");
    CHECK(CallEndMessage(0) == L"");
    CHECK(CallEndMessage(200) == L"");
    CHECK(CallEndMessage(487) == L"");
}

TEST_CASE("CallEndMessage shows the code for the other 4xx to 6xx and nothing outside them") {
    CHECK(CallEndMessage(400) == L"N\u00e3o foi poss\u00edvel completar a liga\u00e7\u00e3o (c\u00f3digo 400).");
    CHECK(CallEndMessage(503) == L"N\u00e3o foi poss\u00edvel completar a liga\u00e7\u00e3o (c\u00f3digo 503).");
    CHECK(CallEndMessage(699) == L"N\u00e3o foi poss\u00edvel completar a liga\u00e7\u00e3o (c\u00f3digo 699).");
    CHECK(CallEndMessage(180) == L"");
    CHECK(CallEndMessage(302) == L"");
    CHECK(CallEndMessage(399) == L"");
    CHECK(CallEndMessage(700) == L"");
    CHECK(CallEndMessage(-1) == L"");
}

TEST_CASE("NormalizeDialString removes separators") {
    CHECK(NormalizeDialString(L" +55 (11) 5060-3000 ") == L"+551150603000");
    CHECK(NormalizeDialString(L"20.01") == L"2001");
    CHECK(NormalizeDialString(L"*21#") == L"*21#");
    CHECK(NormalizeDialString(L"1+2") == L"12");
    CHECK(NormalizeDialString(L"   ") == L"");
}

TEST_CASE("NormalizeDialString keeps one leading plus and the other characters") {
    CHECK(NormalizeDialString(L"\t+ +55") == L"+55");
    CHECK(NormalizeDialString(L"++55") == L"+55");
    CHECK(NormalizeDialString(L"(0xx11) 2001") == L"0xx112001");
    CHECK(NormalizeDialString(L"") == L"");
}

TEST_CASE("ContactDialString strips the DDI and adds the prefix to long numbers") {
    CHECK(ContactDialString(L"+55 (11) 5060-3000", L"55", L"0") == L"01150603000");
    CHECK(ContactDialString(L"(11) 5060-3000", L"55", L"0") == L"01150603000");
    CHECK(ContactDialString(L"2001", L"55", L"0") == L"2001");
    CHECK(ContactDialString(L"+1 650 555 0100", L"55", L"0") == L"+16505550100");
    CHECK(ContactDialString(L"+55 11 5060-3000", L"55", L"") == L"1150603000");
    // O DDI não bate: o número fica como está, sem prefixo.
    CHECK(ContactDialString(L"+551150603000", L"1", L"0") == L"+551150603000");
}
