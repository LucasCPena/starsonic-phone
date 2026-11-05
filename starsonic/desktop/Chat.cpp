#include "Chat.h"

#include <algorithm>
#include <cstdint>
#include <utility>

#include "Text.h"
#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

using Json = nlohmann::json;

constexpr int kFormatVersion = 1;
constexpr size_t kKeyLength = 43;
constexpr size_t kFileIdLength = 32;
constexpr size_t kMaxCompanyChars = 80;

std::string TrimAscii(const std::string& text) {
    const char* const spaces = " \t\r\n";
    const size_t first = text.find_first_not_of(spaces);
    if (first == std::string::npos) return std::string();
    const size_t last = text.find_last_not_of(spaces);
    return text.substr(first, last - first + 1);
}

// Quantos caracteres (pontos de codigo) tem o texto UTF-8 (ja valido).
size_t CountCharacters(const std::string& utf8) {
    size_t count = 0;
    for (char ch : utf8) {
        if ((static_cast<unsigned char>(ch) & 0xC0) != 0x80) ++count;
    }
    return count;
}

bool IsKeyChar(char ch) {
    return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-';
}

// "servidor|ramal" (Chat.h); "" com o servidor ou o ramal vazio.
std::string RamalKey(const std::string& servidor, const std::string& ramal) {
    std::string server = TrimAscii(servidor);
    const std::string number = TrimAscii(ramal);
    if (server.empty() || number.empty()) return std::string();
    for (char& ch : server) {
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
    }
    return server + "|" + number;
}

std::string GetString(const Json& object, const char* key) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_string()) return std::string();
    return found->get<std::string>();
}

}  // namespace

bool ValidChatKey(const std::string& chave) {
    return chave.size() == kKeyLength && std::all_of(chave.begin(), chave.end(), IsKeyChar);
}

bool ValidChatCompany(const std::string& empresa) {
    if (empresa.empty()) return false;
    // UTF-8 valido: a volta pelo Utf8ToWide (que troca o que nao e UTF-8 por U+FFFD) da o mesmo texto.
    const std::wstring wide = Utf8ToWide(empresa);
    if (WideToUtf8(wide) != empresa) return false;
    const bool control = std::any_of(wide.begin(), wide.end(), [](wchar_t ch) {
        const unsigned long code = static_cast<unsigned long>(ch);
        return code < 0x20 || (code >= 0x7F && code <= 0x9F);
    });
    return !control && CountCharacters(empresa) <= kMaxCompanyChars;
}

bool ValidFileId(const std::string& id) {
    return id.size() == kFileIdLength && std::all_of(id.begin(), id.end(), [](char ch) {
               return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
           });
}

// ---------------------------------------------------------------- ChatStore

ChatStore::ChatStore(FileSystem& files, SecretCipher& cipher, std::string path)
    : files_(files), cipher_(cipher), path_(std::move(path)) {}

bool ChatStore::Load() {
    link_.reset();
    ramais_.clear();
    if (path_.empty() || !files_.Exists(path_)) return true;
    const std::optional<std::string> bytes = files_.Read(path_);
    if (!bytes) return false;
    // O que o cifrador devolveu pode ter ganho um fim de linha de um editor.
    const std::optional<std::string> plain = cipher_.Unprotect(TrimAscii(StripUtf8Bom(*bytes)));
    if (!plain) return false;
    const Json root = Json::parse(*plain, nullptr, false);
    if (root.is_discarded() || !root.is_object()) return false;
    const auto version = root.find("v");
    if (version == root.end() || !version->is_number_integer() || version->get<int64_t>() != kFormatVersion) {
        return false;
    }
    ChatLink link{GetString(root, "chave"), GetString(root, "empresa")};
    if (ValidChatKey(link.chave) && ValidChatCompany(link.empresa)) link_ = std::move(link);
    const auto ramais = root.find("ramais");
    if (ramais != root.end() && ramais->is_array()) {
        for (const Json& item : *ramais) {
            if (!item.is_string() || item.get<std::string>().empty()) continue;
            const std::string key = item.get<std::string>();
            if (std::find(ramais_.begin(), ramais_.end(), key) == ramais_.end()) ramais_.push_back(key);
        }
    }
    return true;
}

bool ChatStore::HasRamal(const std::string& servidor, const std::string& ramal) const {
    const std::string key = RamalKey(servidor, ramal);
    return !key.empty() && std::find(ramais_.begin(), ramais_.end(), key) != ramais_.end();
}

bool ChatStore::SetLink(const ChatLink& link) {
    if (!ValidChatKey(link.chave) || !ValidChatCompany(link.empresa)) return false;
    if (!Save(link, ramais_)) return false;
    link_ = link;
    return true;
}

bool ChatStore::ClearLink() {
    if (!Save(std::nullopt, ramais_)) return false;
    link_.reset();
    return true;
}

bool ChatStore::AddRamal(const std::string& servidor, const std::string& ramal) {
    const std::string key = RamalKey(servidor, ramal);
    if (key.empty()) return false;
    if (std::find(ramais_.begin(), ramais_.end(), key) != ramais_.end()) return true;
    ramais_.push_back(key);
    return Save(link_, ramais_);
}

bool ChatStore::Save(const std::optional<ChatLink>& link, const std::vector<std::string>& ramais) {
    if (path_.empty()) return false;
    Json root = Json::object();
    root["v"] = kFormatVersion;
    if (link) {
        root["chave"] = link->chave;
        root["empresa"] = link->empresa;
    }
    root["ramais"] = ramais;
    const std::optional<std::string> sealed = cipher_.Protect(root.dump(2, ' ', false, Json::error_handler_t::replace));
    if (!sealed || sealed->empty()) return false;
    return files_.WriteAtomic(path_, *sealed + "\n");
}

}  // namespace starsonic
