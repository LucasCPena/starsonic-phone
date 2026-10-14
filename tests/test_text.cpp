#include "test_support.h"
#include "Text.h"

#include <cwchar>

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

TEST_CASE("WideToUtf8 encodes ASCII, accents and invalid units") {
    CHECK(WideToUtf8(L"abc") == "abc");
    CHECK(WideToUtf8(L"\u00e7") == "\xc3\xa7");
    CHECK(WideToUtf8(L"\u20ac") == "\xe2\x82\xac");
    // Com wchar_t de 16 bits o literal vira um par substituto; com 32 bits, um codigo so.
    CHECK(WideToUtf8(L"\U0001F600") == "\xf0\x9f\x98\x80");
    // Substituto solto (alto sem baixo, baixo sem alto, alto no fim) vira U+FFFD.
    CHECK(WideToUtf8(std::wstring(1, static_cast<wchar_t>(0xD800))) == "\xef\xbf\xbd");
    CHECK(WideToUtf8(std::wstring(1, static_cast<wchar_t>(0xDC00))) == "\xef\xbf\xbd");
    CHECK(WideToUtf8(std::wstring(L"a") + static_cast<wchar_t>(0xD83D)) == "a\xef\xbf\xbd");
    CHECK(WideToUtf8(std::wstring(1, static_cast<wchar_t>(0xD83D)) + L"b") == "\xef\xbf\xbd" "b");
}

TEST_CASE("WideToUtf8 of an empty text is empty") {
    CHECK(WideToUtf8(std::wstring()) == "");
}

#if WCHAR_MAX > 0xFFFF
TEST_CASE("WideToUtf8 replaces code points above U+10FFFF") {
    CHECK(WideToUtf8(std::wstring(1, static_cast<wchar_t>(0x110000))) == "\xef\xbf\xbd");
    CHECK(WideToUtf8(std::wstring(1, static_cast<wchar_t>(-1))) == "\xef\xbf\xbd");
    CHECK(WideToUtf8(std::wstring(1, static_cast<wchar_t>(0x10FFFF))) == "\xf4\x8f\xbf\xbf");
}
#endif

TEST_CASE("WideToUtf8 and Utf8ToWide round-trip") {
    const std::string utf8 = "Senha#\xc3\xa7 \xe2\x82\xac \xf0\x9f\x98\x80";
    CHECK(WideToUtf8(Utf8ToWide(utf8)) == utf8);
}
