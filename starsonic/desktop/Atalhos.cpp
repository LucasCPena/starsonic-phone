#include "Atalhos.h"

#include <algorithm>

#include "Stores.h"   // NewStoreId
#include "Text.h"
#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

using Json = nlohmann::json;

constexpr int kFormatVersion = 1;

// As mensagens (UTF-8). Os escapes \x sao partidos em literais vizinhos onde a letra seguinte seria lida como digito
// hexadecimal.
const char kErrNameEmpty[] = "Digite o nome do atalho.";
const char kErrNameControl[] = "O nome n\xc3\xa3o pode ter caracteres de controle.";
const char kErrNameLong[] = "O nome pode ter at\xc3\xa9 24 caracteres.";
const char kErrNumberEmpty[] = "Digite o n\xc3\xbamero do atalho.";
const char kErrNumberInvalid[] = "O n\xc3\xbamero s\xc3\xb3 pode ter d\xc3\xadgitos, *, # e +.";
const char kErrNumberLong[] = "O n\xc3\xbamero pode ter at\xc3\xa9 32 caracteres.";
const char kErrLimit[] = "Voc\xc3\xaa j\xc3\xa1 tem 8 atalhos. Remova um para adicionar outro.";
const char kErrAction[] = "Escolha o que o atalho faz.";
const char kErrMissing[] = "Esse atalho n\xc3\xa3o existe mais.";
const char kErrDisk[] = "N\xc3\xa3o foi poss\xc3\xadvel gravar os atalhos.";

std::string TrimAscii(const std::string& text) {
    const char* const spaces = " \t\r\n";
    const size_t first = text.find_first_not_of(spaces);
    if (first == std::string::npos) return std::string();
    const size_t last = text.find_last_not_of(spaces);
    return text.substr(first, last - first + 1);
}

// Quantos caracteres (pontos de codigo) tem o texto UTF-8.
size_t CountCharacters(const std::string& utf8) {
    size_t count = 0;
    for (char ch : utf8) {
        if ((static_cast<unsigned char>(ch) & 0xC0) != 0x80) ++count;
    }
    return count;
}

bool IsDialChar(char ch) { return (ch >= '0' && ch <= '9') || ch == '*' || ch == '#' || ch == '+'; }

const char* ActionName(Atalho::Acao acao) {
    switch (acao) {
        case Atalho::Transferir: return "transferir";
        case Atalho::Consulta: return "consulta";
        case Atalho::Teclas: return "teclas";
        case Atalho::Ligar: break;
    }
    return "ligar";
}

bool ActionFromName(const std::string& name, Atalho::Acao* out) {
    if (name == "ligar") *out = Atalho::Ligar;
    else if (name == "transferir") *out = Atalho::Transferir;
    else if (name == "consulta") *out = Atalho::Consulta;
    else if (name == "teclas") *out = Atalho::Teclas;
    else return false;
    return true;
}

bool ValidActionValue(Atalho::Acao acao) {
    return acao == Atalho::Ligar || acao == Atalho::Transferir || acao == Atalho::Consulta || acao == Atalho::Teclas;
}

// Confere o nome e o numero (ja sem os espacos das pontas). "" = valido.
const char* ValidateFields(const Atalho& atalho) {
    if (atalho.nome.empty()) return kErrNameEmpty;
    // Nada abaixo de U+0020 (em UTF-8 esses sao os bytes abaixo de 0x20: os demais pontos de codigo nao os usam).
    if (std::any_of(atalho.nome.begin(), atalho.nome.end(), [](char ch) { return static_cast<unsigned char>(ch) < 0x20; })) {
        return kErrNameControl;
    }
    if (CountCharacters(atalho.nome) > AtalhosStore::kMaxNameChars) return kErrNameLong;
    if (atalho.numero.empty()) return kErrNumberEmpty;
    if (!std::all_of(atalho.numero.begin(), atalho.numero.end(), IsDialChar)) return kErrNumberInvalid;
    if (atalho.numero.size() > AtalhosStore::kMaxNumberChars) return kErrNumberLong;
    if (!ValidActionValue(atalho.acao)) return kErrAction;
    return nullptr;
}

std::string GetString(const Json& object, const char* key) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_string()) return std::string();
    return found->get<std::string>();
}

}  // namespace

AtalhosStore::AtalhosStore(FileSystem& files, std::string path) : files_(files), path_(std::move(path)) {}

bool AtalhosStore::Load() {
    atalhos_.clear();
    if (!files_.Exists(path_)) return true;
    const std::optional<std::string> bytes = files_.Read(path_);
    if (!bytes) return false;
    const Json root = Json::parse(StripUtf8Bom(*bytes), nullptr, false);
    if (root.is_discarded() || !root.is_object()) return false;
    const auto version = root.find("versao");
    if (version == root.end() || !version->is_number_integer() || version->get<int64_t>() != kFormatVersion) {
        return false;
    }
    const auto list = root.find("atalhos");
    if (list == root.end() || !list->is_array()) return false;
    for (const Json& item : *list) {
        if (atalhos_.size() >= kMax) break;
        if (!item.is_object()) continue;
        Atalho atalho;
        atalho.id = GetString(item, "id");
        atalho.nome = TrimAscii(GetString(item, "nome"));
        atalho.numero = TrimAscii(GetString(item, "numero"));
        const auto blf = item.find("blf");
        atalho.blf = blf != item.end() && blf->is_boolean() && blf->get<bool>();
        if (atalho.id.empty() || !ActionFromName(GetString(item, "acao"), &atalho.acao)) continue;
        if (ValidateFields(atalho) != nullptr) continue;
        const bool duplicate = std::any_of(atalhos_.begin(), atalhos_.end(), [&](const Atalho& other) {
            return other.id == atalho.id;
        });
        if (!duplicate) atalhos_.push_back(std::move(atalho));
    }
    return true;
}

bool AtalhosStore::Write(const std::vector<Atalho>& atalhos) const {
    Json root = Json::object();
    root["versao"] = kFormatVersion;
    Json list = Json::array();
    for (const Atalho& atalho : atalhos) {
        Json item = Json::object();
        item["id"] = atalho.id;
        item["nome"] = atalho.nome;
        item["numero"] = atalho.numero;
        item["acao"] = ActionName(atalho.acao);
        item["blf"] = atalho.blf;
        list.push_back(std::move(item));
    }
    root["atalhos"] = std::move(list);
    // replace: um nome com bytes que nao sao UTF-8 nao pode impedir a gravacao.
    return files_.WriteAtomic(path_, root.dump(2, ' ', false, Json::error_handler_t::replace) + "\n");
}

std::string AtalhosStore::Save(Atalho atalho, std::string* error) {
    const auto fail = [&](const char* message) {
        if (error) *error = message;
        return std::string();
    };
    atalho.nome = TrimAscii(atalho.nome);
    atalho.numero = TrimAscii(atalho.numero);
    if (const char* invalid = ValidateFields(atalho)) return fail(invalid);

    std::vector<Atalho> updated = atalhos_;
    if (atalho.id.empty()) {
        if (updated.size() >= kMax) return fail(kErrLimit);
        atalho.id = NewStoreId();
        updated.push_back(atalho);
    } else {
        const auto existing = std::find_if(updated.begin(), updated.end(), [&](const Atalho& other) {
            return other.id == atalho.id;
        });
        if (existing == updated.end()) return fail(kErrMissing);
        *existing = atalho;
    }
    if (!Write(updated)) return fail(kErrDisk);
    atalhos_ = std::move(updated);
    if (error) error->clear();
    return atalho.id;
}

bool AtalhosStore::Remove(const std::string& id) {
    std::vector<Atalho> updated = atalhos_;
    const auto existing = std::find_if(updated.begin(), updated.end(), [&](const Atalho& other) {
        return other.id == id;
    });
    if (existing == updated.end()) return false;
    updated.erase(existing);
    if (!Write(updated)) return false;
    atalhos_ = std::move(updated);
    return true;
}

}  // namespace starsonic
