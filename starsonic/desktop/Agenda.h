#pragma once
// A agenda do iPhone (spec do iPhone, 6.1 e 6.4; docs/ponte-windows.md, "O modo iPhone"): os contatos que o hospedeiro
// le da agenda do iPhone e entrega ao nucleo (DesktopApp::SetAgenda), que os guarda so na memoria: nada vai ao disco,
// e o diagnostico so leva a contagem e a permissao. Os nomes das ligacoes no iPhone (a recebida, os Recentes e a
// perdida) vem daqui (NameFor), e a lista vai inteira a interface (a mensagem agenda, Protocol.h).
#include <cstddef>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace starsonic {

// O acesso aos contatos do iPhone (agenda.permissao no estado): Pending ("pendente": o iPhone ainda nao perguntou),
// Denied ("negada": so os Ajustes do iPhone mudam isso) ou Granted ("concedida"). Fora da Granted, a lista e vazia.
enum class AgendaPermission { Pending, Denied, Granted };

// O nome da permissao no estado e no diagnostico: "pendente", "negada" ou "concedida".
const char* AgendaPermissionName(AgendaPermission permission);

// Um contato da agenda, em UTF-8: o nome ("" num contato sem nome) e os numeros, como estao na agenda e na ordem dela.
struct AgendaContact {
    std::string name;
    std::vector<std::string> numbers;
};

// O numero da agenda e o que a central manda sao o mesmo (so os digitos dos dois contam): os digitos iguais, e nao
// vazios; ou, quando os dois tem 8 digitos ou mais, os 8 ultimos iguais. Assim "+55 (11) 98888-7777" bate com
// "011988887777", "11988887777" e "988887777", e o ramal "2001" so com "2001" (nao com "+55 11 3333-2001"). Os 8 cobrem
// o numero local do Brasil, com e sem o 9 (o Android usa o PhoneLookup do sistema, com o minimo de 7). Limite
// conhecido: dois numeros com os mesmos 8 ultimos digitos em DDDs diferentes batem (vale o primeiro na ordem da agenda).
bool SameAgendaNumber(const std::string& a, const std::string& b);

// A agenda de agora, so na memoria. Tem a trava propria: o NameFor roda na thread do motor (a recebida), e o Replace e
// o resto, na thread de comandos. As leituras devolvem copias.
class AgendaStore {
public:
    // Troca a lista inteira, com a permissao de agora. Sem a Granted, a lista fica vazia (o que vier). Com ela, ficam de
    // fora o numero sem nenhum digito, o numero repetido num contato (os mesmos digitos: fica o primeiro, na ordem) e o
    // contato que fica sem nenhum numero; os nomes e os numeros que ficam continuam como vieram, na ordem da agenda. Os
    // indices pelos digitos sao montados aqui, uma vez: o NameFor nao percorre a lista.
    void Replace(AgendaPermission permission, std::vector<AgendaContact> contacts);
    // O nome (sem os espacos das pontas) do primeiro contato da agenda, na ordem dela, que tem um numero que bate com
    // este (SameAgendaNumber) e tem nome; nada se nenhum (o contato sem nome nao da nome).
    std::optional<std::string> NameFor(const std::string& number) const;
    AgendaPermission Permission() const;   // Pending antes da primeira lista
    int Count() const;                     // os contatos da lista (todos com algum numero)
    std::vector<AgendaContact> All() const;   // na ordem da agenda

private:
    mutable std::mutex mutex_;
    AgendaPermission permission_ = AgendaPermission::Pending;
    std::vector<AgendaContact> contacts_;
    // Os numeros dos contatos com nome -> o lugar do primeiro contato com ele. Os curtos (menos de 8 digitos) so batem
    // com os mesmos digitos: pelos digitos inteiros. Os outros batem com qualquer um de 8 ou mais com os mesmos 8
    // ultimos: por eles.
    std::unordered_map<std::string, size_t> byDigits_;
    std::unordered_map<std::string, size_t> byLastDigits_;
};

}  // namespace starsonic
