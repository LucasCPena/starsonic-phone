#include "Admin.h"

#include "Pbkdf2.h"
#include "Text.h"
#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

using Json = nlohmann::json;

constexpr int kFormatVersion = 1;

// O resumo PBKDF2-HMAC-SHA256 da senha do administrador. Gerado por build/admin_hash.py (a senha vem de fora do
// repositorio: variavel de ambiente ou digitada). Para trocar a senha, rode o script e cole a saida aqui.
constexpr uint32_t kIterations = 100000;
const uint8_t kSalt[16] = {
    0x46, 0xfd, 0xc8, 0x08, 0x76, 0xd8, 0xc1, 0xf0,
    0x0a, 0xb1, 0x9f, 0xec, 0x3c, 0x70, 0xe2, 0x61,
};
const uint8_t kKey[32] = {
    0x7a, 0xa0, 0x13, 0x8b, 0x0d, 0x40, 0x20, 0x10,
    0x26, 0xff, 0xd1, 0xe6, 0xf5, 0x2f, 0x6d, 0x27,
    0x7b, 0x29, 0x57, 0x7e, 0xf4, 0x66, 0xc8, 0xa6,
    0xe6, 0x40, 0x44, 0xc5, 0x6d, 0x24, 0x27, 0x67,
};

bool GetBool(const Json& object, const char* key, bool fallback) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_boolean()) return fallback;
    return found->get<bool>();
}

std::string GetString(const Json& object, const char* key) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_string()) return std::string();
    return found->get<std::string>();
}

std::string TrimAscii(const std::string& text) {
    const char* const spaces = " \t\r\n";
    const size_t first = text.find_first_not_of(spaces);
    if (first == std::string::npos) return std::string();
    const size_t last = text.find_last_not_of(spaces);
    return text.substr(first, last - first + 1);
}

// Os servidores que servem: com endereco (sem os espacos das pontas) e porta de 1 a 65535.
std::vector<ServerPort> CleanServers(const std::vector<ServerPort>& servers) {
    std::vector<ServerPort> clean;
    for (const ServerPort& server : servers) {
        ServerPort item;
        item.address = Trim(server.address);
        item.port = server.port;
        if (item.address.empty() || item.port < 1 || item.port > 65535) continue;
        clean.push_back(std::move(item));
    }
    return clean;
}

}  // namespace

// ---------------------------------------------------------------- AdminStore

AdminStore::AdminStore(FileSystem& files, SecretCipher& cipher, std::string path, const Profile& profile)
    : files_(files), cipher_(cipher), path_(std::move(path)), profileServers_(profile.account.serverPorts) {
    config_ = Defaults();
}

AdminConfig AdminStore::Defaults() const {
    AdminConfig config;
    config.servidores = profileServers_;
    return config;
}

bool AdminStore::Load() {
    config_ = Defaults();
    if (!files_.Exists(path_)) return true;
    const std::optional<std::string> bytes = files_.Read(path_);
    if (!bytes) return false;
    // O que o cifrador devolveu pode ter ganho um fim de linha de um editor.
    const std::string sealed = TrimAscii(StripUtf8Bom(*bytes));
    const std::optional<std::string> plain = cipher_.Unprotect(sealed);
    if (!plain) return false;
    const Json root = Json::parse(*plain, nullptr, false);
    if (root.is_discarded() || !root.is_object()) return false;
    const auto version = root.find("versao");
    if (version == root.end() || !version->is_number_integer() || version->get<int64_t>() != kFormatVersion) {
        return false;
    }
    const AdminConfig defaults = Defaults();
    config_.mostrarNaoPerturbe = GetBool(root, "mostrar_nao_perturbe", defaults.mostrarNaoPerturbe);
    config_.mostrarAtenderAuto = GetBool(root, "mostrar_atender_automatico", defaults.mostrarAtenderAuto);
    config_.blf = GetBool(root, "blf", defaults.blf);
    config_.puxar = GetBool(root, "puxar", defaults.puxar);
    config_.codigoPuxar = TrimAscii(GetString(root, "codigo_puxar"));
    config_.canal = GetString(root, "canal");
    const auto servers = root.find("servidores");
    if (servers != root.end() && servers->is_array()) {
        std::vector<ServerPort> list;
        for (const Json& item : *servers) {
            if (!item.is_object()) continue;
            const auto port = item.find("porta");
            if (port == item.end() || !port->is_number_integer()) continue;
            const int64_t value = port->get<int64_t>();
            if (value < 1 || value > 65535) continue;
            ServerPort server;
            server.address = Trim(Utf8ToWide(GetString(item, "endereco")));
            server.port = static_cast<int>(value);
            if (!server.address.empty()) list.push_back(std::move(server));
        }
        config_.servidores = std::move(list);
    }
    return true;
}

bool AdminStore::Save(const AdminConfig& requested) {
    AdminConfig config = requested;
    config.codigoPuxar = TrimAscii(config.codigoPuxar);
    config.servidores = CleanServers(config.servidores);

    Json root = Json::object();
    root["versao"] = kFormatVersion;
    root["mostrar_nao_perturbe"] = config.mostrarNaoPerturbe;
    root["mostrar_atender_automatico"] = config.mostrarAtenderAuto;
    root["blf"] = config.blf;
    root["puxar"] = config.puxar;
    root["codigo_puxar"] = config.codigoPuxar;
    Json servers = Json::array();
    for (const ServerPort& server : config.servidores) {
        Json item = Json::object();
        item["endereco"] = WideToUtf8(server.address);
        item["porta"] = server.port;
        servers.push_back(std::move(item));
    }
    root["servidores"] = std::move(servers);
    root["canal"] = config.canal;

    const std::optional<std::string> sealed =
        cipher_.Protect(root.dump(2, ' ', false, Json::error_handler_t::replace));
    if (!sealed || sealed->empty()) return false;
    if (!files_.WriteAtomic(path_, *sealed + "\n")) return false;
    config_ = std::move(config);
    return true;
}

// ---------------------------------------------------------------- senha

AdminHashParams EmbeddedAdminHash() {
    AdminHashParams params;
    params.iterations = kIterations;
    params.salt.assign(kSalt, kSalt + sizeof(kSalt));
    params.key.assign(kKey, kKey + sizeof(kKey));
    return params;
}

bool CheckAdminPassword(const std::string& typed) {
    const std::vector<uint8_t> password(typed.begin(), typed.end());
    const std::vector<uint8_t> salt(kSalt, kSalt + sizeof(kSalt));
    const std::vector<uint8_t> derived = Pbkdf2HmacSha256(password, salt, kIterations, sizeof(kKey));
    if (derived.size() != sizeof(kKey)) return false;
    // Tempo constante: junta as diferencas de todos os bytes, sem sair no primeiro.
    uint8_t difference = 0;
    for (size_t i = 0; i < sizeof(kKey); ++i) {
        difference = static_cast<uint8_t>(difference | (derived[i] ^ kKey[i]));
    }
    return difference == 0;
}

// ---------------------------------------------------------------- puxar

std::string PickupNumber(const std::string& code, const std::string& ramal) {
    static const std::string kToken = "{ramal}";
    std::string out;
    size_t position = 0;
    while (true) {
        const size_t found = code.find(kToken, position);
        if (found == std::string::npos) {
            out.append(code, position, std::string::npos);
            break;
        }
        out.append(code, position, found - position);
        out += ramal;
        position = found + kToken.size();
    }
    return out;
}

}  // namespace starsonic
