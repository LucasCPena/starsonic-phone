#include "Agenda.h"

#include <algorithm>
#include <utility>

namespace starsonic {

namespace {

// Quantos digitos do fim decidem quando os dois numeros tem pelo menos isso: o numero local do Brasil (8 digitos; o
// celular, com o 9 na frente).
constexpr size_t kLastDigits = 8;

const char kBlanks[] = " \t\r\n\v\f";

// So os digitos do numero (0 a 9): sem o +, os separadores, o * e o #.
std::string DigitsOf(const std::string& number) {
    std::string digits;
    digits.reserve(number.size());
    for (const char ch : number) {
        if (ch >= '0' && ch <= '9') digits.push_back(ch);
    }
    return digits;
}

// Os digitos viram a chave dos indices: os 8 ultimos, num numero de 8 digitos ou mais (true); senao, ficam inteiros.
bool ToLastDigits(std::string& digits) {
    if (digits.size() < kLastDigits) return false;
    digits.erase(0, digits.size() - kLastDigits);
    return true;
}

// O nome sem os brancos das pontas ("" num nome so de brancos).
std::string Trimmed(const std::string& name) {
    const size_t first = name.find_first_not_of(kBlanks);
    if (first == std::string::npos) return std::string();
    return name.substr(first, name.find_last_not_of(kBlanks) - first + 1);
}

}  // namespace

const char* AgendaPermissionName(AgendaPermission permission) {
    switch (permission) {
        case AgendaPermission::Denied:
            return "negada";
        case AgendaPermission::Granted:
            return "concedida";
        case AgendaPermission::Pending:
            break;
    }
    return "pendente";
}

bool SameAgendaNumber(const std::string& a, const std::string& b) {
    std::string first = DigitsOf(a);
    std::string second = DigitsOf(b);
    if (first.empty() || second.empty()) return false;
    if (first == second) return true;
    // Os dois com 8 digitos ou mais: os 8 ultimos (a mesma chave dos indices do AgendaStore).
    return ToLastDigits(first) && ToLastDigits(second) && first == second;
}

// A lista e os indices ficam prontos fora da trava (o NameFor, na thread do motor, nao espera por eles), e os de antes
// saem depois dela (o swap os deixa nas variaveis locais); so a troca e com a trava. Um numero de 8 digitos ou mais bate
// (SameAgendaNumber) com qualquer outro de 8 ou mais com os mesmos 8 ultimos, e um mais curto so com os mesmos digitos:
// cada um entra num indice so, e o NameFor procura no do numero dele.
void AgendaStore::Replace(AgendaPermission permission, std::vector<AgendaContact> contacts) {
    std::vector<AgendaContact> kept;
    std::unordered_map<std::string, size_t> byDigits;
    std::unordered_map<std::string, size_t> byLastDigits;
    if (permission == AgendaPermission::Granted) {
        kept.reserve(contacts.size());
        for (AgendaContact& contact : contacts) {
            AgendaContact clean;
            std::vector<std::string> keys;   // os digitos de cada numero que fica, na ordem
            for (std::string& number : contact.numbers) {
                std::string digits = DigitsOf(number);
                if (digits.empty() || std::find(keys.begin(), keys.end(), digits) != keys.end()) continue;
                keys.push_back(std::move(digits));
                clean.numbers.push_back(std::move(number));
            }
            if (clean.numbers.empty()) continue;
            clean.name = std::move(contact.name);
            // O contato sem nome fica na lista (a interface mostra o numero), mas nao da nome. O emplace nao troca:
            // cada chave fica com o primeiro contato com nome, na ordem da agenda.
            if (!Trimmed(clean.name).empty()) {
                for (std::string& key : keys) {
                    std::unordered_map<std::string, size_t>& index = ToLastDigits(key) ? byLastDigits : byDigits;
                    index.emplace(std::move(key), kept.size());
                }
            }
            kept.push_back(std::move(clean));
        }
    }
    std::lock_guard<std::mutex> lock(mutex_);
    permission_ = permission;
    contacts_.swap(kept);
    byDigits_.swap(byDigits);
    byLastDigits_.swap(byLastDigits);
}

std::optional<std::string> AgendaStore::NameFor(const std::string& number) const {
    std::string key = DigitsOf(number);
    if (key.empty()) return std::nullopt;
    const bool last = ToLastDigits(key);
    std::lock_guard<std::mutex> lock(mutex_);
    const std::unordered_map<std::string, size_t>& index = last ? byLastDigits_ : byDigits_;
    const auto found = index.find(key);
    if (found == index.end()) return std::nullopt;
    return Trimmed(contacts_[found->second].name);
}

AgendaPermission AgendaStore::Permission() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return permission_;
}

int AgendaStore::Count() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return static_cast<int>(contacts_.size());
}

std::vector<AgendaContact> AgendaStore::All() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return contacts_;
}

}  // namespace starsonic
