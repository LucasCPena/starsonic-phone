#pragma once
// Textos e números das ligações (Android etapa 1): o aviso de uma ligação que não completou e o
// número que o Teclado e os Recentes mandam discar.
#include <string>

namespace starsonic {

// Aviso de uma ligação que terminou sem completar, pelo código SIP do fim: 486 e 600 -> Ocupado;
// 404, 484 e 604 -> Número não encontrado; 408 e 480 -> Não atendeu; outro 4xx a 6xx -> o texto
// com o código. L"" quando não há o que avisar (0, 200, 487 e tudo fora de 400 a 699).
std::wstring CallEndMessage(int sipCode);

// O número a discar: sem espaço, tab, '-', '.', '(' e ')'; um '+' só fica se for o primeiro
// caractere que sobra. Os outros caracteres ficam como vieram.
std::wstring NormalizeDialString(const std::wstring& raw);

// O número de um contato do aparelho, pronto para discar: NormalizeDialString primeiro; um '+'
// seguido do ddi (ex.: "+55") sai; qualquer outro número com '+' (DDI diferente, ou ddi vazio) fica
// como está, sem prefixo; o prefixo (ex.: "0", para sair da central) entra na frente só quando o
// que sobra tem mais de 6 dígitos, para não afetar ramais e números curtos.
std::wstring ContactDialString(const std::wstring& raw, const std::wstring& ddi, const std::wstring& prefix);

}  // namespace starsonic
