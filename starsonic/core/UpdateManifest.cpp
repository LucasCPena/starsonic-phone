#include "UpdateManifest.h"

#include "Text.h"
#include "nlohmann/json.hpp"

namespace starsonic {
namespace {

const size_t kMaxNotesUnits = 500;

bool IsDigit(char ch) {
    return ch >= '0' && ch <= '9';
}

bool ParseNumber(const std::string& text, size_t* pos, int* out) {
    const size_t start = *pos;
    long value = 0;
    while (*pos < text.size() && IsDigit(text[*pos])) {
        if (*pos - start >= 9) return false;
        value = value * 10 + (text[*pos] - '0');
        ++*pos;
    }
    if (*pos == start) return false;
    *out = static_cast<int>(value);
    return true;
}

bool IsHex(char ch) {
    return IsDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

bool IsSha256(const std::string& text) {
    if (text.size() != 64) return false;
    for (char ch : text) {
        if (!IsHex(ch)) return false;
    }
    return true;
}

std::string AsciiLower(std::string text) {
    for (char& ch : text) {
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
    }
    return text;
}

bool IsAllowedUrl(const std::string& url, const std::string& prefix) {
    if (prefix.empty() || url.size() <= prefix.size() || url.compare(0, prefix.size(), prefix) != 0) {
        return false;
    }
    const std::string rest = url.substr(prefix.size());
    if (rest.find("..") != std::string::npos) return false;
    for (char ch : rest) {
        const bool allowed = IsDigit(ch) || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                             ch == '.' || ch == '_' || ch == '-' || ch == '/';
        if (!allowed) return false;
    }
    return true;
}

std::wstring TruncateNotes(const std::wstring& notes) {
    if (notes.size() <= kMaxNotesUnits) return notes;
    size_t cut = kMaxNotesUnits;
    const unsigned long last = static_cast<unsigned long>(notes[cut - 1]);
    if (last >= 0xD800 && last <= 0xDBFF) --cut;   // não separa um par substituto
    return notes.substr(0, cut) + L"\u2026";
}

}  // namespace

bool ParseVersion(const std::string& text, Version* out) {
    Version version;
    size_t pos = 0;
    if (!ParseNumber(text, &pos, &version.major) || pos >= text.size() || text[pos] != '.') return false;
    ++pos;
    if (!ParseNumber(text, &pos, &version.minor) || pos >= text.size() || text[pos] != '.') return false;
    ++pos;
    if (!ParseNumber(text, &pos, &version.patch)) return false;
    if (pos < text.size()) {
        const std::string suffix = "-rc.";
        if (text.compare(pos, suffix.size(), suffix) != 0) return false;
        pos += suffix.size();
        if (!ParseNumber(text, &pos, &version.rc) || version.rc == 0 || pos != text.size()) return false;
    }
    *out = version;
    return true;
}

int CompareVersions(const Version& a, const Version& b) {
    if (a.major != b.major) return a.major < b.major ? -1 : 1;
    if (a.minor != b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch != b.patch) return a.patch < b.patch ? -1 : 1;
    if (a.rc == b.rc) return 0;
    if (a.rc == 0) return 1;
    if (b.rc == 0) return -1;
    return a.rc < b.rc ? -1 : 1;
}

bool ParseManifest(const std::string& utf8Json, const std::string& allowedUrlPrefix,
                   Manifest* out, std::string* error) {
    auto fail = [error](const std::string& message) {
        if (error) *error = "versao.json: " + message;
        return false;
    };
    const nlohmann::json json = nlohmann::json::parse(utf8Json, nullptr, false);
    if (json.is_discarded() || !json.is_object()) return fail("JSON invalido");

    Manifest manifest;
    const auto versao = json.find("versao");
    if (versao == json.end() || !versao->is_string()) return fail("campo \"versao\" ausente ou nao e texto");
    manifest.versionText = versao->get<std::string>();
    if (!ParseVersion(manifest.versionText, &manifest.version)) {
        return fail("versao invalida: " + manifest.versionText);
    }

    const auto instalador = json.find("instalador");
    if (instalador == json.end() || !instalador->is_string()) {
        return fail("campo \"instalador\" ausente ou nao e texto");
    }
    manifest.installerUrl = instalador->get<std::string>();
    if (!IsAllowedUrl(manifest.installerUrl, allowedUrlPrefix)) {
        return fail("instalador fora do endereco permitido: " + manifest.installerUrl);
    }

    const auto sha = json.find("sha256");
    if (sha == json.end() || !sha->is_string() || !IsSha256(sha->get<std::string>())) {
        return fail("campo \"sha256\" ausente ou invalido");
    }
    manifest.sha256 = AsciiLower(sha->get<std::string>());

    const auto notas = json.find("notas");
    if (notas != json.end()) {
        if (!notas->is_string()) return fail("campo \"notas\" nao e texto");
        manifest.notes = TruncateNotes(Utf8ToWide(notas->get<std::string>()));
    }

    *out = manifest;
    if (error) error->clear();
    return true;
}

}  // namespace starsonic
