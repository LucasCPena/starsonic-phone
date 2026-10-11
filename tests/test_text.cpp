#include "test_support.h"
#include "Text.h"

using namespace starsonic;

TEST_CASE("StripUtf8Bom removes only a leading BOM") {
    CHECK(StripUtf8Bom("\xEF\xBB\xBF" "a") == "a");
    CHECK(StripUtf8Bom("a\xEF\xBB\xBF") == "a\xEF\xBB\xBF");
}

TEST_CASE("Utf8ToWide decodes accents and replaces invalid bytes") {
    CHECK(Utf8ToWide("Conex\xC3\xA3o") == std::wstring(L"Conex\u00e3o"));
    CHECK(Utf8ToWide("a\xFF" "b") == std::wstring(L"a\uFFFDb"));
}

TEST_CASE("Trim removes spaces and tabs at both ends") {
    CHECK(Trim(L" \t2001 ") == std::wstring(L"2001"));
}

TEST_CASE("Trim keeps inner blanks and empties a blank-only text") {
    CHECK(Trim(L" a b\t") == std::wstring(L"a b"));
    CHECK(Trim(L" \t ") == std::wstring());
}

TEST_CASE("Utf8ToWide decodes 3- and 4-byte sequences") {
    CHECK(Utf8ToWide("\xE2\x82\xAC") == std::wstring(L"\u20ac"));
    CHECK(Utf8ToWide("\xF0\x9F\x98\x80") == std::wstring(L"\U0001F600"));
}

TEST_CASE("Utf8ToWide replaces truncated, overlong, surrogate and out-of-range sequences") {
    CHECK(Utf8ToWide("\xE2\x82" "a") == std::wstring(L"\ufffda"));
    CHECK(Utf8ToWide("\xC0\xAF") == std::wstring(L"\ufffd\ufffd"));
    CHECK(Utf8ToWide("\xED\xA0\x80") == std::wstring(L"\ufffd\ufffd\ufffd"));
    CHECK(Utf8ToWide("\xF4\x90\x80\x80") == std::wstring(L"\ufffd\ufffd\ufffd\ufffd"));
}
