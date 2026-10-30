#pragma once
// A agenda do iPhone (spec do iPhone, 6.1 e 6.4; docs/ponte-windows.md, "O modo iPhone"): os contatos que o hospedeiro
// le da agenda do iPhone e entrega ao nucleo, que os guarda so na memoria. Por enquanto, so a permissao.

namespace starsonic {

// O acesso aos contatos do iPhone (agenda.permissao no estado): Pending ("pendente": o iPhone ainda nao perguntou),
// Denied ("negada": so os Ajustes do iPhone mudam isso) ou Granted ("concedida"). Fora da Granted, a lista e vazia.
enum class AgendaPermission { Pending, Denied, Granted };

}  // namespace starsonic
