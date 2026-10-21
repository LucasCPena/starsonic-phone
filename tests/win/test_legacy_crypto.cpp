/*
 * Copyright (C) 2011-2026 MicroSIP (http://www.microsip.org)
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 */

// Starsonic Phone: o teste do LegacyDecrypt (starsonic/win/LegacyCrypto.h) contra o original do MicroSIP 3.22. O
// MFC::CCrypto e o de microsip/lib/Crypto.cpp, compilado como esta; IniEncrypt e IniDecrypt (microsip/settings.cpp) e
// MSIP::Bin2String/String2Bin (microsip/lib/MSIP.cpp) vem copiados abaixo, porque os arquivos inteiros puxam o
// MicroSIP todo. Com MFC; so o lado original o usa.
#include "stdafx.h"

#include "Crypto.h"

#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#include "LegacyCrypto.h"
#include "test_support.h"

// De microsip/const.h (que inclui os arquivos gerados pelo build do app; um caso abaixo confere que e o mesmo).
#define _GLOBAL_KEY "*********"

namespace {

// ---- Copiados do MicroSIP 3.22 ----

CString Bin2String(CByteArray* ca)
{
    CString res;
    int k = ca->GetSize();
    for (int i = 0; i < k; i++) {
        res.AppendFormat(_T("%02x"), ca->GetAt(i));
    }
    return res;
}

void String2Bin(const CString& str, CByteArray* res)
{
    res->RemoveAll();
    CStringA rab;
    for (int i = 0; i < str.GetLength(); i += 2) {
        rab = CStringA(str.Mid(i, 2));
        char* p = NULL;
        unsigned long bin = strtoul(rab.GetString(), &p, 16);
        res->Add(static_cast<BYTE>(bin));
    }
}

bool IniDecrypt(CString& str)
{
    if (!str.IsEmpty()) {
        bool res = false;
        CByteArray arPassword;
        String2Bin(str, &arPassword);
        MFC::CCrypto crypto;
        CString key = (LPCTSTR)_GLOBAL_KEY;
        if (crypto.DeriveKey(key)) {
            try {
                if (crypto.Decrypt(arPassword, str)) {
                    res = true;
                }
            }
            catch (CArchiveException* e) {
                e->Delete();
            }
        }
        return res;
    }
    else {
        return true;
    }
}

CString IniEncrypt(CString str)
{
    CString res;
    MFC::CCrypto crypto;
    CByteArray arPassword;
    CString key = (LPCTSTR)_GLOBAL_KEY;
    if (!str.IsEmpty() && crypto.DeriveKey(key)
        && crypto.Encrypt(str, arPassword)
        ) {
        res = Bin2String(&arPassword);
    }
    else {
        res = str;
    }
    return res;
}

// ---- Apoio ----

std::wstring Wide(const CString& text) { return std::wstring(text.GetString(), text.GetLength()); }

std::string ReadRepoFile(const char* relative) {
    std::ifstream in(std::string(STARSONIC_REPO_DIR) + "/" + relative, std::ios::binary);
    std::ostringstream bytes;
    bytes << in.rdbuf();
    return bytes.str();
}

}  // namespace

bool StartMfc() { return AfxWinInit(::GetModuleHandle(NULL), NULL, ::GetCommandLine(), 0) != FALSE; }

TEST_CASE("LegacyDecrypt reads what MicroSIP encrypted") {
    const std::wstring password = L"senha-123 \u00e7\u00e3";
    const CString encrypted = IniEncrypt(CString(password.c_str()));
    REQUIRE(Wide(encrypted) != password);   // cifrou: o .ini guarda o hexadecimal
    CHECK(encrypted.SpanIncluding(_T("0123456789abcdef")) == encrypted);

    const std::optional<std::wstring> decrypted = starsonic::LegacyDecrypt(Wide(encrypted));
    REQUIRE(decrypted);
    CHECK(*decrypted == password);
}

TEST_CASE("the key MicroSIP hashes is its narrow literal read as wide text") {
    // CString key = (LPCTSTR)_GLOBAL_KEY: 9 asteriscos e o zero do fim viram 5 caracteres de 16 bits; o
    // LegacyCrypto.cpp hasheia esses 10 bytes.
    const CString key = (LPCTSTR)_GLOBAL_KEY;
    REQUIRE(key.GetLength() == 5);
    CHECK(memcmp(key.GetString(), "*********", 10) == 0);
    CHECK(ReadRepoFile("microsip/const.h").find("#define _GLOBAL_KEY \"*********\"") != std::string::npos);
}

TEST_CASE("LegacyDecrypt reads short, long and empty passwords") {
    // 300 caracteres: o tamanho no CArchive passa para 2 bytes.
    const std::vector<std::wstring> passwords = {L"a", L"1234", std::wstring(254, L'x'), std::wstring(300, L'y'),
                                                 L"\u00c1\u00e9\u00ee\u00f5\u00fc \u20ac", L"com espa\u00e7o e ; = \""};
    for (const std::wstring& password : passwords) {
        CAPTURE(password);
        const std::optional<std::wstring> decrypted =
            starsonic::LegacyDecrypt(Wide(IniEncrypt(CString(password.c_str()))));
        REQUIRE(decrypted);
        CHECK(*decrypted == password);
    }
    const std::optional<std::wstring> empty = starsonic::LegacyDecrypt(L"");
    REQUIRE(empty);
    CHECK(empty->empty());
}

TEST_CASE("LegacyDecrypt agrees with the original IniDecrypt") {
    const CString valid = IniEncrypt(CString(L"segredo"));
    CString upper = valid;
    upper.MakeUpper();
    const std::vector<CString> inputs = {
        valid,
        upper,                                      // o strtoul aceita maiusculas
        valid.Left(valid.GetLength() - 2),          // cortado: nao decifra
        valid.Left(valid.GetLength() - 1),          // tamanho impar
        valid + _T("00"),                           // um byte a mais
        CString(_T("zz")),
        CString(_T("senha em claro")),
        CString(_T("0011223344556677")),
        CString(_T(" 1-2+3")),
    };
    for (const CString& input : inputs) {
        CAPTURE(Wide(input));
        CString original = input;
        const bool originalOk = IniDecrypt(original);
        const std::optional<std::wstring> mine = starsonic::LegacyDecrypt(Wide(input));
        CHECK(mine.has_value() == originalOk);
        if (originalOk && mine) CHECK(*mine == Wide(original));
    }
}
