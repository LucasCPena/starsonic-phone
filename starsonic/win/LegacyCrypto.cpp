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

// Starsonic Phone: o IniDecrypt de microsip/settings.cpp, com o MSIP::String2Bin de microsip/lib/MSIP.cpp e o
// MFC::CCrypto de microsip/lib/Crypto.cpp, reescritos sobre a CryptoAPI pura (sem MFC). Win32 puro: compilado sem o
// cabecalho pre-compilado do MicroSIP.
//
// O que o MicroSIP faz (build Unicode):
// 1. String2Bin: cada 2 caracteres do texto viram um byte pelo strtoul(..., 16) (o que nao e hexadecimal vale 0;
//    o ultimo caractere sozinho, num texto de tamanho impar, vira um byte).
// 2. CCrypto: CryptAcquireContext(PROV_RSA_FULL), hash MD5 da chave, CryptDeriveKey(CALG_RC2, CRYPT_EXPORTABLE) e
//    CryptDecrypt(final = TRUE).
//    A chave e "CString key = (LPCTSTR)_GLOBAL_KEY": o literal estreito "*********" lido como texto largo. Os 9
//    asteriscos e o zero do fim viram 5 caracteres de 16 bits (0x2A2A x 4 e 0x002A); o compilador completa o literal
//    com zeros ate o alinhamento, e o caractere seguinte e o fim do texto. O hash recebe esses 10 bytes.
// 3. CCrypto::Decrypt(..., CString&): "ar >> str" do CArchive do MFC (AfxReadStringLength): o tamanho em 1 byte
//    (< 0xFF); senao 0xFF e 2 bytes (< 0xFFFF); senao 0xFFFF e 4 bytes (< 0xFFFFFFFF); senao 0xFFFFFFFF e 8 bytes (ate
//    INT_MAX). Antes do tamanho, o texto Unicode leva a marca FF FE FF; o tamanho conta caracteres, e o texto vem
//    em UTF-16LE (sem a marca, em bytes da pagina de codigo do Windows). Faltando bytes, o CArchive lanca a excecao
//    que o IniDecrypt trata como "nao decifrou". O texto vai ate o primeiro caractere zero (a atribuicao a CString).
#include "LegacyCrypto.h"

#include <windows.h>
#include <wincrypt.h>

#include <climits>
#include <cstdint>
#include <vector>

#pragma comment(lib, "advapi32.lib")

namespace starsonic {

namespace {

// _GLOBAL_KEY de microsip/const.h ("*********"), com o zero do fim: o que o (LPCTSTR) entrega ao hash.
const BYTE kLegacyKey[] = {'*', '*', '*', '*', '*', '*', '*', '*', '*', 0};

// O strtoul(..., 16) do MSIP::String2Bin num pedaco de 1 ou 2 caracteres: espacos, sinal e digitos hexadecimais do
// comeco; o resultado cortado para um byte (o CByteArray::Add). Um caractere fora do ASCII (no CStringA, outro byte
// da pagina de codigo) nao e digito.
BYTE HexPairToByte(const std::wstring& pair) {
    size_t i = 0;
    while (i < pair.size() && (pair[i] == L' ' || (pair[i] >= L'\t' && pair[i] <= L'\r'))) ++i;
    bool negative = false;
    if (i < pair.size() && (pair[i] == L'+' || pair[i] == L'-')) negative = pair[i++] == L'-';
    unsigned long value = 0;
    for (; i < pair.size(); ++i) {
        const wchar_t ch = pair[i];
        int digit = -1;
        if (ch >= L'0' && ch <= L'9') digit = ch - L'0';
        else if (ch >= L'a' && ch <= L'f') digit = ch - L'a' + 10;
        else if (ch >= L'A' && ch <= L'F') digit = ch - L'A' + 10;
        if (digit < 0) break;
        value = value * 16 + static_cast<unsigned long>(digit);
    }
    if (negative) value = 0UL - value;
    return static_cast<BYTE>(value & 0xff);
}

std::vector<BYTE> String2Bin(const std::wstring& text) {
    std::vector<BYTE> bytes;
    for (size_t i = 0; i < text.size(); i += 2) bytes.push_back(HexPairToByte(text.substr(i, 2)));
    return bytes;
}

// Os objetos da CryptoAPI, liberados na saida de qualquer caminho.
struct CryptoHandles {
    HCRYPTPROV provider = 0;
    HCRYPTHASH hash = 0;
    HCRYPTKEY key = 0;
    ~CryptoHandles() {
        if (hash) CryptDestroyHash(hash);
        if (key) CryptDestroyKey(key);
        if (provider) CryptReleaseContext(provider, 0);
    }
};

// O provedor padrao do PROV_RSA_FULL, o mesmo do CCrypto. Sem conjunto de chaves (CRYPT_VERIFYCONTEXT): a chave de
// sessao derivada da senha nao depende dele. Se nao der, como o CCrypto: o conjunto padrao, ou um novo.
bool AcquireProvider(HCRYPTPROV* provider) {
    if (CryptAcquireContextW(provider, nullptr, nullptr, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)) return true;
    if (CryptAcquireContextW(provider, nullptr, nullptr, PROV_RSA_FULL, 0)) return true;
    return GetLastError() == static_cast<DWORD>(NTE_BAD_KEYSET) &&
           CryptAcquireContextW(provider, nullptr, nullptr, PROV_RSA_FULL, CRYPT_NEWKEYSET);
}

// O CArchive lido do comeco ao fim; false quando faltam bytes (a excecao endOfFile do MFC).
class ArchiveReader {
public:
    ArchiveReader(const BYTE* data, size_t size) : data_(data), size_(size) {}

    template <typename T>
    bool Read(T* value) {
        if (size_ - pos_ < sizeof(T)) return false;
        T result = 0;
        for (size_t i = 0; i < sizeof(T); ++i) result |= static_cast<T>(static_cast<T>(data_[pos_ + i]) << (8 * i));
        pos_ += sizeof(T);
        *value = result;
        return true;
    }

    const BYTE* Take(size_t count) {
        if (size_ - pos_ < count) return nullptr;
        const BYTE* start = data_ + pos_;
        pos_ += count;
        return start;
    }

private:
    const BYTE* data_;
    size_t size_;
    size_t pos_ = 0;
};

// AfxReadStringLength do MFC (arccore.cpp).
bool ReadStringLength(ArchiveReader& archive, uint64_t* length, bool* unicode) {
    *unicode = false;
    uint8_t byteLength = 0;
    if (!archive.Read(&byteLength)) return false;
    if (byteLength < 0xff) {
        *length = byteLength;
        return true;
    }
    uint16_t wordLength = 0;
    if (!archive.Read(&wordLength)) return false;
    if (wordLength == 0xfffe) {
        // A marca do texto Unicode: o tamanho comeca de novo, em 1 byte.
        *unicode = true;
        if (!archive.Read(&byteLength)) return false;
        if (byteLength < 0xff) {
            *length = byteLength;
            return true;
        }
        if (!archive.Read(&wordLength)) return false;
    }
    if (wordLength < 0xffff) {
        *length = wordLength;
        return true;
    }
    uint32_t dwordLength = 0;
    if (!archive.Read(&dwordLength)) return false;
    if (dwordLength < 0xffffffffu) {
        *length = dwordLength;
        return true;
    }
    uint64_t qwordLength = 0;
    if (!archive.Read(&qwordLength)) return false;
    if (qwordLength > static_cast<uint64_t>(INT_MAX)) return false;   // o MFC lanca genericException
    *length = qwordLength;
    return true;
}

// "ar >> str" (operator>> do CArchive para CStringT, com wchar_t).
std::optional<std::wstring> ReadArchivedString(const BYTE* data, size_t size) {
    ArchiveReader archive(data, size);
    uint64_t length = 0;
    bool unicode = false;
    if (!ReadStringLength(archive, &length, &unicode)) return std::nullopt;
    const uint64_t bytes = unicode ? length * 2 : length;
    if (bytes > size) return std::nullopt;
    const BYTE* text = archive.Take(static_cast<size_t>(bytes));
    if (!text) return std::nullopt;
    if (unicode) {
        std::wstring result;
        result.reserve(static_cast<size_t>(length));
        for (uint64_t i = 0; i < length; ++i) {
            const wchar_t ch = static_cast<wchar_t>(text[2 * i] | (text[2 * i + 1] << 8));
            if (ch == L'\0') break;
            result.push_back(ch);
        }
        return result;
    }
    // Texto de 8 bits: a CString o converte pela pagina de codigo da thread (ATL), ate o primeiro zero.
    size_t narrow = 0;
    while (narrow < length && text[narrow] != 0) ++narrow;
    if (narrow == 0) return std::wstring();
    if (narrow > static_cast<size_t>(INT_MAX)) return std::nullopt;
    const char* source = reinterpret_cast<const char*>(text);
    const int wide = MultiByteToWideChar(CP_THREAD_ACP, 0, source, static_cast<int>(narrow), nullptr, 0);
    if (wide <= 0) return std::wstring();
    std::wstring result(static_cast<size_t>(wide), L'\0');
    MultiByteToWideChar(CP_THREAD_ACP, 0, source, static_cast<int>(narrow), &result[0], wide);
    return result;
}

}  // namespace

std::optional<std::wstring> LegacyDecrypt(const std::wstring& encrypted) {
    if (encrypted.empty()) return std::wstring();   // o IniDecrypt devolve true e deixa vazio
    std::vector<BYTE> data = String2Bin(encrypted);

    CryptoHandles crypto;
    if (!AcquireProvider(&crypto.provider)) return std::nullopt;
    if (!CryptCreateHash(crypto.provider, CALG_MD5, 0, 0, &crypto.hash)) return std::nullopt;
    if (!CryptHashData(crypto.hash, kLegacyKey, sizeof(kLegacyKey), 0)) return std::nullopt;
    if (!CryptDeriveKey(crypto.provider, CALG_RC2, crypto.hash, CRYPT_EXPORTABLE, &crypto.key)) return std::nullopt;

    DWORD length = static_cast<DWORD>(data.size());
    if (!CryptDecrypt(crypto.key, 0, TRUE, 0, data.data(), &length)) return std::nullopt;
    if (length > data.size()) return std::nullopt;
    const std::optional<std::wstring> password = ReadArchivedString(data.data(), length);
    SecureZeroMemory(data.data(), data.size());
    return password;
}

}  // namespace starsonic
