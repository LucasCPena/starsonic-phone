#include "Admin.h"

#include <algorithm>

#include "AccountPolicy.h"
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

// As mensagens (UTF-8). Os escapes \x sao partidos em literais vizinhos onde a letra seguinte seria lida como digito
// hexadecimal.
const char kErrChannel[] = "Escolha o canal Teste ou Est\xc3\xa1vel.";
const char kErrCode[] = "O c\xc3\xb3" "digo s\xc3\xb3 pode ter d\xc3\xadgitos, *, #, + e {ramal}.";
const char kErrDuplicate[] = "Esse servidor j\xc3\xa1 est\xc3\xa1 na lista.";
const char kErrPort[] = "A porta deve ficar entre 1 e 65535.";
const char kErrDoorphoneCount[] = "No m\xc3\xa1ximo 20 porteiros.";
const char kErrDoorphoneChars[] = "Cada porteiro s\xc3\xb3 pode ter d\xc3\xadgitos.";
const char kErrDoorphoneLength[] = "Cada porteiro precisa ter de 1 a 15 d\xc3\xadgitos.";
const char kErrDoorphoneDuplicate[] = "Esse porteiro j\xc3\xa1 est\xc3\xa1 na lista.";

bool ValidChannel(const std::string& channel) {
    return channel.empty() || channel == "teste" || channel == "estavel";
}

// O codigo de puxar: so digitos, * # + e o texto {ramal}.
bool ValidPickupCode(const std::string& code) {
    static const std::string kToken = "{ramal}";
    for (size_t i = 0; i < code.size();) {
        const char ch = code[i];
        if ((ch >= '0' && ch <= '9') || ch == '*' || ch == '#' || ch == '+') {
            ++i;
        } else if (code.compare(i, kToken.size(), kToken) == 0) {
            i += kToken.size();
        } else {
            return false;
        }
    }
    return true;
}

bool ValidPort(int64_t port) { return port >= 1 && port <= 65535; }

// Um servidor da lista: o endereco normalizado (sem espacos nas pontas, em minusculas) e a porta. Devolve a mensagem de
// erro (UTF-8), ou "" se serve.
std::string CheckServer(const ServerPort& server, ServerPort* normalized) {
    std::wstring address;
    const ServerCheck check = ValidateServerAddress(server.address, &address);
    if (check != ServerCheck::Ok) return WideToUtf8(ServerCheckMessage(check));
    if (!ValidPort(server.port)) return kErrPort;
    normalized->address = std::move(address);
    normalized->port = server.port;
    return std::string();
}

enum class DoorphoneCheck { Ok, Chars, Length };

// Um Porteiro: so digitos, de 1 a 15.
DoorphoneCheck CheckDoorphone(const std::string& doorphone) {
    for (char ch : doorphone) {
        if (ch < '0' || ch > '9') return DoorphoneCheck::Chars;
    }
    if (doorphone.empty() || doorphone.size() > AdminConfig::kMaxDoorphoneDigits) return DoorphoneCheck::Length;
    return DoorphoneCheck::Ok;
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
    const std::string code = TrimAscii(GetString(root, "codigo_puxar"));
    config_.codigoPuxar = ValidPickupCode(code) ? code : std::string();
    const std::string channel = GetString(root, "canal");
    config_.canal = ValidChannel(channel) ? channel : std::string();
    config_.videoH264 = GetBool(root, "videoH264", defaults.videoH264);
    config_.videoVp8 = GetBool(root, "videoVp8", defaults.videoVp8);
    config_.videoVp9 = GetBool(root, "videoVp9", defaults.videoVp9);
    config_.videoFirst = ParseCodecKey(GetString(root, "videoPrimeiro")).value_or(defaults.videoFirst);
    config_.videoQuality = ParseQualityKey(GetString(root, "videoQualidade")).value_or(defaults.videoQuality);
    const auto doorphones = root.find("porteiros");
    if (doorphones != root.end() && doorphones->is_array()) {
        // Como os servidores: o item que nao serve ou repete fica de fora, e a lista para nos 20.
        for (const Json& item : *doorphones) {
            if (config_.doorphones.size() >= AdminConfig::kMaxDoorphones) break;
            if (!item.is_string()) continue;
            const std::string doorphone = TrimAscii(item.get<std::string>());
            if (CheckDoorphone(doorphone) != DoorphoneCheck::Ok) continue;
            if (std::find(config_.doorphones.begin(), config_.doorphones.end(), doorphone) !=
                config_.doorphones.end()) {
                continue;
            }
            config_.doorphones.push_back(doorphone);
        }
    }
    const auto servers = root.find("servidores");
    if (servers != root.end() && servers->is_array()) {
        std::vector<ServerPort> list;
        for (const Json& item : *servers) {
            if (!item.is_object()) continue;
            const auto port = item.find("porta");
            if (port == item.end() || !port->is_number_integer()) continue;
            const int64_t value = port->get<int64_t>();
            if (!ValidPort(value)) continue;
            ServerPort server;
            server.address = Utf8ToWide(GetString(item, "endereco"));
            server.port = static_cast<int>(value);
            ServerPort normalized;
            if (!CheckServer(server, &normalized).empty()) continue;
            const bool duplicate = std::any_of(list.begin(), list.end(), [&](const ServerPort& other) {
                return other.address == normalized.address;
            });
            if (!duplicate) list.push_back(std::move(normalized));
        }
        config_.servidores = std::move(list);
    }
    return true;
}

bool AdminStore::Save(const AdminConfig& requested, std::string* error) {
    const auto fail = [&](const std::string& message) {
        if (error) *error = message;
        return false;
    };
    AdminConfig config = requested;
    if (!ValidChannel(config.canal)) return fail(kErrChannel);
    config.codigoPuxar = TrimAscii(config.codigoPuxar);
    if (!ValidPickupCode(config.codigoPuxar)) return fail(kErrCode);
    config.servidores.clear();
    for (const ServerPort& server : requested.servidores) {
        ServerPort normalized;
        const std::string problem = CheckServer(server, &normalized);
        if (!problem.empty()) return fail(problem);
        const bool duplicate = std::any_of(config.servidores.begin(), config.servidores.end(),
                                           [&](const ServerPort& other) { return other.address == normalized.address; });
        if (duplicate) return fail(kErrDuplicate);
        config.servidores.push_back(std::move(normalized));
    }
    if (requested.doorphones.size() > AdminConfig::kMaxDoorphones) return fail(kErrDoorphoneCount);
    config.doorphones.clear();
    for (const std::string& typed : requested.doorphones) {
        const std::string doorphone = TrimAscii(typed);
        const DoorphoneCheck check = CheckDoorphone(doorphone);
        if (check == DoorphoneCheck::Chars) return fail(kErrDoorphoneChars);
        if (check == DoorphoneCheck::Length) return fail(kErrDoorphoneLength);
        if (std::find(config.doorphones.begin(), config.doorphones.end(), doorphone) != config.doorphones.end()) {
            return fail(kErrDoorphoneDuplicate);
        }
        config.doorphones.push_back(doorphone);
    }

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
    root["videoH264"] = config.videoH264;
    root["videoVp8"] = config.videoVp8;
    root["videoVp9"] = config.videoVp9;
    root["videoPrimeiro"] = CodecKey(config.videoFirst);
    root["videoQualidade"] = QualityKey(config.videoQuality);
    Json doorphones = Json::array();
    for (const std::string& doorphone : config.doorphones) doorphones.push_back(doorphone);
    root["porteiros"] = std::move(doorphones);

    const std::optional<std::string> sealed =
        cipher_.Protect(root.dump(2, ' ', false, Json::error_handler_t::replace));
    if (!sealed || sealed->empty()) return fail("N\xc3\xa3o foi poss\xc3\xadvel proteger as configura\xc3\xa7\xc3\xb5" "es.");
    if (!files_.WriteAtomic(path_, *sealed + "\n")) return fail("N\xc3\xa3o foi poss\xc3\xadvel gravar as configura\xc3\xa7\xc3\xb5" "es.");
    config_ = std::move(config);
    if (error) error->clear();
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

bool CheckPasswordAgainst(const std::string& typed, const AdminHashParams& params) {
    if (params.iterations == 0 || params.key.empty()) return false;
    // O HMAC completa a chave com zeros ate o bloco: "senha" e "senha" + NUL dariam a mesma chave derivada. Uma senha
    // digitada nao tem NUL, entao quem tem NUL nao e a senha.
    if (typed.find('\0') != std::string::npos) return false;
    const std::vector<uint8_t> password(typed.begin(), typed.end());
    const std::vector<uint8_t> derived = Pbkdf2HmacSha256(password, params.salt, params.iterations, params.key.size());
    if (derived.size() != params.key.size()) return false;
    // Tempo constante: junta as diferencas de todos os bytes, sem sair no primeiro.
    uint8_t difference = 0;
    for (size_t i = 0; i < derived.size(); ++i) {
        difference = static_cast<uint8_t>(difference | (derived[i] ^ params.key[i]));
    }
    return difference == 0;
}

bool CheckAdminPassword(const std::string& typed) { return CheckPasswordAgainst(typed, EmbeddedAdminHash()); }

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
