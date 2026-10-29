#include "ListaEmpresa.h"

#include <algorithm>
#include <cstddef>
#include <utility>
#include <vector>

#include "Text.h"

namespace starsonic {

namespace {

// ---------------------------------------------------------------- Texto (so ASCII: o resto passa como veio)

const char kBlanks[] = " \t\r\n";

char LowerAscii(char ch) { return ch >= 'A' && ch <= 'Z' ? static_cast<char>(ch - 'A' + 'a') : ch; }

std::string Lowered(std::string text) {
    for (char& ch : text) ch = LowerAscii(ch);
    return text;
}

// O texto tem o prefixo (escrito em minusculas) a partir de pos, sem diferenciar a caixa.
bool StartsWithNoCase(const std::string& text, const char* lowerPrefix, size_t pos = 0) {
    for (size_t i = 0; lowerPrefix[i] != '\0'; ++i) {
        if (pos + i >= text.size() || LowerAscii(text[pos + i]) != lowerPrefix[i]) return false;
    }
    return true;
}

bool IsControl(char ch) {
    const unsigned char byte = static_cast<unsigned char>(ch);
    return byte < 0x20 || byte == 0x7F;
}

bool HasControl(const std::string& text) { return std::any_of(text.begin(), text.end(), IsControl); }

// Num link, o espaco tambem nao pode estar no meio.
bool HasSpaceOrControl(const std::string& text) {
    return std::any_of(text.begin(), text.end(), [](char ch) { return ch == ' ' || IsControl(ch); });
}

bool IsDigits(const std::string& text) {
    return !text.empty() && std::all_of(text.begin(), text.end(), [](char ch) { return ch >= '0' && ch <= '9'; });
}

// O id de uma planilha do Google: letras, digitos, '_' e '-'.
bool IsGoogleId(const std::string& text) {
    return !text.empty() && std::all_of(text.begin(), text.end(), [](char ch) {
               return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_' ||
                      ch == '-';
           });
}

std::vector<std::string> Split(const std::string& text, char separator) {
    std::vector<std::string> parts;
    size_t start = 0;
    while (true) {
        const size_t end = text.find(separator, start);
        if (end == std::string::npos) {
            parts.push_back(text.substr(start));
            return parts;
        }
        parts.push_back(text.substr(start, end - start));
        start = end + 1;
    }
}

// ---------------------------------------------------------------- O link colado

// Os brancos que saem das pontas do link colado, em UTF-8: os do ASCII e os invisiveis que o texto copiado traz junto
// (o Outlook classico e o Word poem o U+00A0 no texto copiado).
const char* const kLinkBlanks[] = {
    " ", "\t", "\r", "\n",
    "\xc2\xa0",   // U+00A0, o espaco que nao quebra
    // U+2000 a U+200A, os espacos de largura fixa, e U+200B, o de largura zero
    "\xe2\x80\x80", "\xe2\x80\x81", "\xe2\x80\x82", "\xe2\x80\x83", "\xe2\x80\x84", "\xe2\x80\x85", "\xe2\x80\x86",
    "\xe2\x80\x87", "\xe2\x80\x88", "\xe2\x80\x89", "\xe2\x80\x8a", "\xe2\x80\x8b",
    "\xe2\x80\xaf",   // U+202F, o espaco estreito que nao quebra
    "\xe2\x81\x9f",   // U+205F, o espaco medio da matematica
    "\xe3\x80\x80",   // U+3000, o espaco ideografico
    "\xef\xbb\xbf",   // U+FEFF, o BOM
};

// Quantos bytes tem o branco no comeco (front) ou no fim de text[begin, end); 0 se ali nao ha um.
size_t LinkBlankSize(const std::string& text, size_t begin, size_t end, bool front) {
    for (const char* blank : kLinkBlanks) {
        const size_t size = std::char_traits<char>::length(blank);
        if (end - begin >= size && text.compare(front ? begin : end - size, size, blank) == 0) return size;
    }
    return 0;
}

// O link como a pessoa colou: sem os brancos das pontas e sem as aspas em volta (o "Copiar como caminho" do Explorer),
// nem os brancos de dentro delas.
std::string Pasted(const std::string& link) {
    std::string text = TrimLinkBlanks(link);
    if (text.size() >= 2 && text.front() == '"' && text.back() == '"') {
        text = TrimLinkBlanks(text.substr(1, text.size() - 2));
    }
    return text;
}

// ---------------------------------------------------------------- A consulta ("a=1&b=2")

// Os parametros, com os vazios (a consulta vazia e um parametro vazio).
std::vector<std::string> Params(const std::string& query) { return Split(query, '&'); }

std::string NameOf(const std::string& param) { return param.substr(0, param.find('=')); }

// O valor do primeiro parametro com esse nome; vazio se nao tem (ou se nao tem valor).
std::string ParamValue(const std::string& query, const std::string& name) {
    for (const std::string& param : Params(query)) {
        if (NameOf(param) != name) continue;
        const size_t equals = param.find('=');
        return equals == std::string::npos ? std::string() : param.substr(equals + 1);
    }
    return std::string();
}

// A consulta com nome=valor: o parametro que ja tem esse nome passa a valer o valor, no mesmo lugar; sem ele, nome=valor
// entra no fim. O resto fica como estava (a consulta vazia, ou terminada em '&', nao ganha um '&' a mais).
std::string WithParam(const std::string& query, const std::string& name, const std::string& value) {
    const std::string wanted = name + "=" + value;
    std::vector<std::string> params = Params(query);
    bool found = false;
    for (std::string& param : params) {
        if (NameOf(param) != name) continue;
        param = wanted;
        found = true;
    }
    if (!found) {
        if (params.back().empty()) {
            params.back() = wanted;
        } else {
            params.push_back(wanted);
        }
    }
    std::string joined;
    for (size_t i = 0; i < params.size(); ++i) {
        if (i != 0) joined += '&';
        joined += params[i];
    }
    return joined;
}

// ---------------------------------------------------------------- O link https

struct Url {
    std::string authority;   // o usuario@, o host em minusculas e a :porta, como foram colados
    std::string host;        // so o host, em minusculas
    std::string path;        // da primeira '/' ate o '?' ou o '#'; vazio se nao tem
    std::string query;       // o que vem depois do '?'
    bool hasQuery = false;
    std::string fragment;    // o que vem depois do '#'
};

// O link https:// aberto em partes. Nada se nao e https://, se tem espaco ou caractere de controle, ou se nao tem host.
std::optional<Url> ParseHttps(const std::string& link) {
    if (!StartsWithNoCase(link, "https://") || HasSpaceOrControl(link)) return std::nullopt;
    std::string rest = link.substr(8);
    Url url;
    const size_t hash = rest.find('#');
    if (hash != std::string::npos) {
        url.fragment = rest.substr(hash + 1);
        rest.resize(hash);
    }
    const size_t question = rest.find('?');
    if (question != std::string::npos) {
        url.hasQuery = true;
        url.query = rest.substr(question + 1);
        rest.resize(question);
    }
    const size_t slash = rest.find('/');
    if (slash != std::string::npos) {
        url.path = rest.substr(slash);
        rest.resize(slash);
    }
    // O que sobra e o usuario, o host e a porta. O host e o que vem depois do ultimo '@' e antes do primeiro ':'.
    const size_t at = rest.rfind('@');
    const std::string userinfo = at == std::string::npos ? std::string() : rest.substr(0, at + 1);
    const std::string hostAndPort = rest.substr(userinfo.size());
    const size_t colon = hostAndPort.find(':');
    url.host = Lowered(hostAndPort.substr(0, colon));
    if (url.host.empty()) return std::nullopt;
    url.authority = userinfo + url.host + (colon == std::string::npos ? std::string() : hostAndPort.substr(colon));
    return url;
}

// O endereco de volta: https://, o usuario, o host em minusculas e a porta, o caminho e a consulta dada. Sem o fragmento.
std::string Compose(const Url& url, const std::string& query, bool hasQuery) {
    std::string address = "https://" + url.authority + url.path;
    if (hasQuery) address += "?" + query;
    return address;
}

// O host e o dominio, ou esta num subdominio dele: so na fronteira de um nome (a.sharepoint.com e do sharepoint.com;
// sharepoint.com.example.org e notsharepoint.com nao).
bool InDomain(const std::string& host, const std::string& domain) {
    if (host == domain) return true;
    return host.size() > domain.size() && host.compare(host.size() - domain.size(), domain.size(), domain) == 0 &&
           host[host.size() - domain.size() - 1] == '.';
}

// O mesmo link com o parametro valendo 1 (download=1, dl=1).
CompanySource WithDownload(CompanySourceKind kind, const Url& url, const char* name) {
    return CompanySource{kind, Compose(url, WithParam(url.query, name, "1"), true)};
}

// O gid da aba do link: o do fragmento (que o Google atualiza ao trocar de aba) ou, sem ele, o da consulta. So digitos.
std::string GidOf(const Url& url) {
    for (const std::string* text : {&url.fragment, &url.query}) {
        const std::string gid = ParamValue(*text, "gid");
        if (IsDigits(gid)) return gid;
    }
    return std::string();
}

// docs.google.com/spreadsheets/d/<id>/..., com o /u/<n>/ de quem tem mais de uma conta antes do /d/ (planilha) ou
// /d/e/<id>/pubhtml e /pub (publicada na web). Nada se o caminho e de outra coisa (um documento, uma pasta...).
std::optional<CompanySource> GoogleSource(const Url& url) {
    const std::vector<std::string> parts = Split(url.path, '/');   // a primeira e vazia: o caminho comeca com '/'
    size_t i = 1;
    if (i >= parts.size() || parts[i] != "spreadsheets") return std::nullopt;
    ++i;
    if (i + 1 < parts.size() && parts[i] == "u" && IsDigits(parts[i + 1])) i += 2;
    if (i >= parts.size() || parts[i] != "d") return std::nullopt;
    ++i;
    if (i >= parts.size()) return std::nullopt;
    const std::string gid = GidOf(url);
    if (parts[i] == "e") {
        if (i + 2 >= parts.size() || !IsGoogleId(parts[i + 1]) || (parts[i + 2] != "pub" && parts[i + 2] != "pubhtml")) {
            return std::nullopt;
        }
        std::string location = "https://docs.google.com/spreadsheets/d/e/" + parts[i + 1] + "/pub?output=csv";
        if (!gid.empty()) location += "&gid=" + gid;
        if (ParamValue(url.query, "single") == "true") location += "&single=true";
        return CompanySource{CompanySourceKind::GooglePublished, location};
    }
    if (!IsGoogleId(parts[i])) return std::nullopt;
    std::string location = "https://docs.google.com/spreadsheets/d/" + parts[i] + "/export?format=csv";
    if (!gid.empty()) location += "&gid=" + gid;
    return CompanySource{CompanySourceKind::Google, location};
}

std::optional<CompanySource> HttpsSource(const std::string& text) {
    const std::optional<Url> parsed = ParseHttps(text);
    if (!parsed) return std::nullopt;
    const Url& url = *parsed;
    if (url.host == "docs.google.com") {
        std::optional<CompanySource> google = GoogleSource(url);
        if (google) return google;
    } else if (InDomain(url.host, "1drv.ms") || InDomain(url.host, "onedrive.live.com")) {
        return WithDownload(CompanySourceKind::OneDrive, url, "download");
    } else if (InDomain(url.host, "sharepoint.com")) {
        return WithDownload(CompanySourceKind::SharePoint, url, "download");
    } else if (InDomain(url.host, "dropbox.com")) {
        return WithDownload(CompanySourceKind::Dropbox, url, "dl");
    }
    return CompanySource{CompanySourceKind::Link, Compose(url, url.query, url.hasQuery)};
}

// ---------------------------------------------------------------- O caminho

bool IsDrivePath(const std::string& text) {
    return text.size() >= 3 && ((text[0] >= 'A' && text[0] <= 'Z') || (text[0] >= 'a' && text[0] <= 'z')) &&
           text[1] == ':' && (text[2] == '\\' || text[2] == '/');
}

// \\servidor...: duas barras invertidas e depois algo que nao e barra.
bool IsUncPath(const std::string& text) {
    return text.size() >= 3 && text[0] == '\\' && text[1] == '\\' && text[2] != '\\' && text[2] != '/';
}

int HexValue(char ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
}

// Os %XX viram os bytes; o % que nao tem dois digitos hexadecimais depois fica como esta. Nada se o resultado nao e UTF-8
// valido (a volta pelo Utf8ToWide, que troca o que nao e UTF-8 por U+FFFD, mudaria o texto).
std::optional<std::string> DecodePercent(const std::string& text) {
    std::string decoded;
    decoded.reserve(text.size());
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '%' && i + 2 < text.size()) {
            const int high = HexValue(text[i + 1]);
            const int low = HexValue(text[i + 2]);
            if (high >= 0 && low >= 0) {
                decoded.push_back(static_cast<char>(high * 16 + low));
                i += 2;
                continue;
            }
        }
        decoded.push_back(text[i]);
    }
    if (WideToUtf8(Utf8ToWide(decoded)) != decoded) return std::nullopt;
    return decoded;
}

// file:///C:/pasta/x.csv vira C:\pasta\x.csv; file://servidor/pasta/x.csv vira \\servidor\pasta\x.csv; e a pasta de rede
// como o Edge e o Chrome a escrevem, file://///servidor/pasta/x.csv (tambem com quatro barras), vira \\servidor\pasta\x.csv.
// Nada se nao e um caminho do Windows (file:///usr/lib/x.csv) ou se tem caractere de controle (um %00 ou %0A).
std::optional<std::string> PathFromFileUrl(const std::string& text) {
    const std::string rest = text.substr(7);   // depois do file://
    const size_t slash = rest.find('/');
    const std::string authority = rest.substr(0, slash);
    const std::optional<std::string> decoded = DecodePercent(slash == std::string::npos ? "" : rest.substr(slash));
    if (!decoded) return std::nullopt;
    std::string path = *decoded;
    std::replace(path.begin(), path.end(), '/', '\\');
    std::string result;
    if (!authority.empty()) {
        result = "\\\\" + authority + path;
    } else if (IsDrivePath(path.substr(std::min<size_t>(1, path.size())))) {
        result = path.substr(1);   // \C:\pasta\x.csv, sem a barra da frente
    } else if (path.size() >= 2 && path[0] == '\\' && path[1] == '\\') {
        const size_t name = path.find_first_not_of('\\');   // as barras a mais da pasta de rede ficam de fora
        if (name == std::string::npos) return std::nullopt;
        result = "\\\\" + path.substr(name);
    } else {
        return std::nullopt;
    }
    if (HasControl(result) || !(IsDrivePath(result) || IsUncPath(result))) return std::nullopt;
    return result;
}

}  // namespace

std::string TrimLinkBlanks(const std::string& text) {
    size_t begin = 0;
    size_t end = text.size();
    while (const size_t size = LinkBlankSize(text, begin, end, true)) begin += size;
    while (const size_t size = LinkBlankSize(text, begin, end, false)) end -= size;
    return text.substr(begin, end - begin);
}

std::optional<CompanySource> CompanySourceFor(const std::string& link) {
    const std::string text = Pasted(link);
    if (StartsWithNoCase(text, "file://")) {
        const std::optional<std::string> path = PathFromFileUrl(text);
        if (!path) return std::nullopt;
        return CompanySource{CompanySourceKind::Path, *path};
    }
    if (IsDrivePath(text) || IsUncPath(text)) {
        if (HasControl(text)) return std::nullopt;
        return CompanySource{CompanySourceKind::Path, text};
    }
    return HttpsSource(text);
}

const char* CompanySourceName(CompanySourceKind kind) {
    switch (kind) {
        case CompanySourceKind::Google: return "Google";
        case CompanySourceKind::GooglePublished: return "Google (publicado)";
        case CompanySourceKind::OneDrive: return "OneDrive";
        case CompanySourceKind::SharePoint: return "SharePoint";
        case CompanySourceKind::Dropbox: return "Dropbox";
        case CompanySourceKind::Link: return "link";
        case CompanySourceKind::Path: return "caminho";
    }
    return "link";
}

// ---------------------------------------------------------------- A resposta HTTP

namespace {

// Uma pagina HTML no lugar da planilha (o Google ou a Microsoft pedindo login): o corpo comeca, depois do BOM, dos
// espacos e dos comentarios <!-- -->, com <!doctype html ou <html. A pagina de entrar da Microsoft comeca com um comentario.
bool LooksLikeHtml(const std::string& body) {
    size_t pos = StartsWithNoCase(body, "\xEF\xBB\xBF") ? 3 : 0;
    while (true) {
        pos = body.find_first_not_of(kBlanks, pos);
        if (pos == std::string::npos) return false;
        if (!StartsWithNoCase(body, "<!--", pos)) break;
        const size_t end = body.find("-->", pos + 4);
        if (end == std::string::npos) return false;
        pos = end + 3;
    }
    return StartsWithNoCase(body, "<!doctype html", pos) || StartsWithNoCase(body, "<html", pos);
}

}  // namespace

CompanyFetch FromHttp(int status, bool networkError, bool tooLarge, std::string body) {
    CompanyFetch fetch;
    if (networkError) {
        fetch.error = CompanyFetchError::Offline;
    } else if (status == 401 || status == 403 || status == 404) {
        fetch.error = CompanyFetchError::Closed;
    } else if (status >= 500 && status < 600) {
        fetch.error = CompanyFetchError::Offline;
    } else if (tooLarge) {
        // Depois do status: a pagina de erro grande de um link fechado ou de um servidor fora do ar diz o que o status diz.
        fetch.error = CompanyFetchError::TooLarge;
    } else if (status != 200) {
        fetch.error = CompanyFetchError::Offline;
    } else if (LooksLikeHtml(body)) {
        fetch.error = CompanyFetchError::Closed;
    } else {
        fetch.bytes = std::move(body);
    }
    return fetch;
}

}  // namespace starsonic
