#include "CallMessages.h"

namespace starsonic {

std::wstring CallEndMessage(int sipCode) {
    switch (sipCode) {
        case 486:
        case 600:
            return L"Ocupado";
        case 404:
        case 484:
        case 604:
            return L"N\u00famero n\u00e3o encontrado";
        case 408:
        case 480:
            return L"N\u00e3o atendeu";
        case 487:   // quem ligou desistiu: nada a avisar
            return L"";
        default:
            break;
    }
    if (sipCode >= 400 && sipCode <= 699) {
        return L"N\u00e3o foi poss\u00edvel completar a liga\u00e7\u00e3o (c\u00f3digo " + std::to_wstring(sipCode) + L").";
    }
    return L"";
}

std::wstring NormalizeDialString(const std::wstring& raw) {
    std::wstring number;
    number.reserve(raw.size());
    for (const wchar_t ch : raw) {
        switch (ch) {
            case L' ':
            case L'\t':
            case L'-':
            case L'.':
            case L'(':
            case L')':
                break;
            case L'+':
                if (number.empty()) number.push_back(ch);
                break;
            default:
                number.push_back(ch);
                break;
        }
    }
    return number;
}

std::wstring ContactDialString(const std::wstring& raw, const std::wstring& ddi, const std::wstring& prefix) {
    std::wstring number = NormalizeDialString(raw);
    if (!number.empty() && number[0] == L'+') {
        const std::wstring plusDdi = L"+" + ddi;
        // Outro DDI (ou ddi vazio): o número é de fora e vai como veio, sem prefixo.
        if (ddi.empty() || number.compare(0, plusDdi.size(), plusDdi) != 0) return number;
        number.erase(0, plusDdi.size());
    }
    size_t digits = 0;
    for (const wchar_t ch : number) {
        if (ch >= L'0' && ch <= L'9') ++digits;
    }
    return digits > 6 ? prefix + number : number;
}

}  // namespace starsonic
