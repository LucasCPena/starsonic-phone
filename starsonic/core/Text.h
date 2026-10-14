#pragma once
// Utilitários de texto do núcleo (sem dependências do Windows, MFC ou PJSIP).
#include <string>

namespace starsonic {

// Remove o BOM UTF-8 (EF BB BF) somente quando ele está no início.
std::string StripUtf8Bom(const std::string& bytes);

// Decodifica UTF-8. Cada sequência inválida vira U+FFFD; com wchar_t de 16 bits
// (Windows) os caracteres fora do plano básico viram pares substitutos.
std::wstring Utf8ToWide(const std::string& utf8);

// Codifica em UTF-8. Aceita wchar_t de 16 bits (Windows: o par substituto vira um caractere) e de
// 32 bits (Linux, Android). Cada unidade inválida (substituto solto, acima de U+10FFFF) vira U+FFFD.
std::string WideToUtf8(const std::wstring& text);

// Remove espaços e tabs das duas pontas.
std::wstring Trim(const std::wstring& text);

}  // namespace starsonic
