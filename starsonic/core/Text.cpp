#include "Text.h"

namespace starsonic {

std::string StripUtf8Bom(const std::string& bytes) {
    if (bytes.size() >= 3 &&
        static_cast<unsigned char>(bytes[0]) == 0xEF &&
        static_cast<unsigned char>(bytes[1]) == 0xBB &&
        static_cast<unsigned char>(bytes[2]) == 0xBF) {
        return bytes.substr(3);
    }
    return bytes;
}

namespace {

const unsigned long kReplacementChar = 0xFFFD;

void AppendCodePoint(std::wstring* out, unsigned long code) {
    if (sizeof(wchar_t) == 2 && code > 0xFFFF) {
        code -= 0x10000;
        out->push_back(static_cast<wchar_t>(0xD800 + (code >> 10)));
        out->push_back(static_cast<wchar_t>(0xDC00 + (code & 0x3FF)));
    } else {
        out->push_back(static_cast<wchar_t>(code));
    }
}

}  // namespace

std::wstring Utf8ToWide(const std::string& utf8) {
    std::wstring out;
    out.reserve(utf8.size());
    const size_t size = utf8.size();
    size_t i = 0;
    while (i < size) {
        const unsigned char lead = static_cast<unsigned char>(utf8[i]);
        if (lead < 0x80) {
            out.push_back(static_cast<wchar_t>(lead));
            ++i;
            continue;
        }
        int extra = 0;                  // bytes de continuação esperados
        unsigned long code = 0;
        unsigned low = 0x80;            // faixa válida do segundo byte
        unsigned high = 0xBF;
        if (lead >= 0xC2 && lead <= 0xDF) {
            extra = 1;
            code = lead & 0x1F;
        } else if (lead >= 0xE0 && lead <= 0xEF) {
            extra = 2;
            code = lead & 0x0F;
            if (lead == 0xE0) low = 0xA0;         // forma longa
            else if (lead == 0xED) high = 0x9F;   // substitutos U+D800..U+DFFF
        } else if (lead >= 0xF0 && lead <= 0xF4) {
            extra = 3;
            code = lead & 0x07;
            if (lead == 0xF0) low = 0x90;         // forma longa
            else if (lead == 0xF4) high = 0x8F;   // acima de U+10FFFF
        } else {
            AppendCodePoint(&out, kReplacementChar);
            ++i;
            continue;
        }
        size_t j = i + 1;
        bool valid = true;
        for (int k = 0; k < extra; ++k, ++j) {
            if (j >= size) {
                valid = false;
                break;
            }
            const unsigned next = static_cast<unsigned char>(utf8[j]);
            const unsigned lowest = (k == 0) ? low : 0x80u;
            const unsigned highest = (k == 0) ? high : 0xBFu;
            if (next < lowest || next > highest) {
                valid = false;
                break;
            }
            code = (code << 6) | (next & 0x3F);
        }
        // Inválida: um U+FFFD e a leitura recomeça no byte que quebrou a sequência.
        AppendCodePoint(&out, valid ? code : kReplacementChar);
        i = j;
    }
    return out;
}

std::wstring Trim(const std::wstring& text) {
    const wchar_t* blanks = L" \t";
    const size_t first = text.find_first_not_of(blanks);
    if (first == std::wstring::npos) {
        return std::wstring();
    }
    const size_t last = text.find_last_not_of(blanks);
    return text.substr(first, last - first + 1);
}

}  // namespace starsonic
