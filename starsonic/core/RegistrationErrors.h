#pragma once
// Texto que o usuário vê quando o registro da conta falha (spec seção 11.1).
#include <string>

namespace starsonic {

// L"" para 100–299 sem falha de TLS. Código <= 0 = sem resposta (DNS, rede ou tempo esgotado).
std::wstring RegistrationMessage(int sipCode, bool tlsFailure);

}  // namespace starsonic
