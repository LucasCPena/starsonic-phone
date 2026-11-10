// Win32 puro (sem MFC): compilado sem o cabecalho pre-compilado do app antigo (starsonic.targets),
// porque o stdafx.h dele traz o wininet.h, que nao convive com o winhttp.h. Tambem no app novo.
#include "Http.h"

#include <winhttp.h>

#include <new>
#include <vector>

#pragma comment(lib, "winhttp.lib")

namespace {

const int kConnectTimeoutMs = 10000;
const int kReadTimeoutMs = 30000;

class Handle {
public:
    explicit Handle(HINTERNET handle) : handle_(handle) {}
    ~Handle() {
        if (handle_) WinHttpCloseHandle(handle_);
    }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HINTERNET get() const { return handle_; }
    explicit operator bool() const { return handle_ != NULL; }

private:
    HINTERNET handle_;
};

HttpResponse Failure(DWORD error, DWORD status = 0) {
    HttpResponse response;
    response.status = status;
    response.error = error ? error : ERROR_GEN_FAILURE;
    return response;
}

// Proxy automatico (Windows 8.1 em diante); nos sistemas mais antigos, o proxy padrao.
HINTERNET OpenSession(const std::wstring& agent) {
    HINTERNET session = WinHttpOpen(agent.c_str(), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
                                    WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        session = WinHttpOpen(agent.c_str(), WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME,
                              WINHTTP_NO_PROXY_BYPASS, 0);
    }
    return session;
}

// O unico endereco que o HttpGetPinned aceita (o servidor de binarios da Cisco, que nao tem HTTPS).
const wchar_t kPinnedPrefix[] = L"http://ciscobinary.openh264.org/";

// bearer: a chave do HttpsGetBearer (o cabecalho Authorization e nenhum redirecionamento); nullptr no HttpsGet.
// pinnedTimeoutMs > 0: o HttpGetPinned (HTTP so para o kPinnedPrefix, nenhum redirecionamento, esses tempos).
HttpResponse Get(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent, const std::string* bearer,
                 int pinnedTimeoutMs = 0) {
    const bool pinned = pinnedTimeoutMs > 0;
    if (pinned) {
        if (url.compare(0, sizeof(kPinnedPrefix) / sizeof(wchar_t) - 1, kPinnedPrefix) != 0) {
            return Failure(ERROR_INVALID_PARAMETER);
        }
    } else if (url.compare(0, 8, L"https://") != 0) {
        return Failure(ERROR_INVALID_PARAMETER);
    }
    std::wstring headers;
    if (bearer) {
        // So ASCII visivel: um fim de linha na chave viraria outro cabecalho.
        if (bearer->empty()) return Failure(ERROR_INVALID_PARAMETER);
        for (const char ch : *bearer) {
            if (ch < 0x21 || ch > 0x7E) return Failure(ERROR_INVALID_PARAMETER);
        }
        headers = L"Authorization: Bearer " + std::wstring(bearer->begin(), bearer->end());
    }
    URL_COMPONENTS parts = {};
    parts.dwStructSize = sizeof(parts);
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &parts) || parts.nScheme != (pinned ? INTERNET_SCHEME_HTTP : INTERNET_SCHEME_HTTPS) ||
        !parts.lpszHostName || parts.dwHostNameLength == 0) {
        return Failure(ERROR_INVALID_PARAMETER);
    }
    const std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
    std::wstring path;
    if (parts.lpszUrlPath) path.assign(parts.lpszUrlPath, parts.dwUrlPathLength);
    if (parts.lpszExtraInfo) path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    if (path.empty()) path = L"/";

    Handle session(OpenSession(userAgent));
    if (!session) return Failure(GetLastError());
    if (pinned) {
        WinHttpSetTimeouts(session.get(), pinnedTimeoutMs, pinnedTimeoutMs, pinnedTimeoutMs, pinnedTimeoutMs);
    } else {
        WinHttpSetTimeouts(session.get(), kConnectTimeoutMs, kConnectTimeoutMs, kReadTimeoutMs, kReadTimeoutMs);
    }

    Handle connection(WinHttpConnect(session.get(), host.c_str(), parts.nPort, 0));
    if (!connection) return Failure(GetLastError());
    Handle request(WinHttpOpenRequest(connection.get(), L"GET", path.c_str(), NULL, WINHTTP_NO_REFERER,
                                      WINHTTP_DEFAULT_ACCEPT_TYPES, pinned ? 0 : WINHTTP_FLAG_SECURE));
    if (!request) return Failure(GetLastError());
    // WINHTTP_OPTION_SECURITY_FLAGS fica como esta: certificado invalido = falha. Redirecionamentos
    // seguem a politica padrao do WinHTTP, que nunca desce de HTTPS para HTTP; com a chave, nenhum (o
    // WinHTTP poderia levar o Authorization ao endereco novo); no HTTP fixado, tambem nenhum (o 3xx volta como resposta).
    if (bearer || pinned) {
        DWORD policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        if (!WinHttpSetOption(request.get(), WINHTTP_OPTION_REDIRECT_POLICY, &policy, sizeof(policy))) {
            return Failure(GetLastError());
        }
    }
    const wchar_t* extra = headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headers.c_str();
    if (!WinHttpSendRequest(request.get(), extra, static_cast<DWORD>(headers.size()), WINHTTP_NO_REQUEST_DATA, 0, 0,
                            0) ||
        !WinHttpReceiveResponse(request.get(), NULL)) {
        return Failure(GetLastError());
    }

    DWORD status = 0;
    DWORD size = sizeof(status);
    if (!WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX)) {
        return Failure(GetLastError());
    }
    std::string body;
    std::vector<char> buffer(64 * 1024);
    for (;;) {
        DWORD read = 0;
        if (!WinHttpReadData(request.get(), buffer.data(), static_cast<DWORD>(buffer.size()), &read)) {
            return Failure(GetLastError(), status);
        }
        if (read == 0) break;
        if (body.size() + read > maxBytes) {
            return Failure(ERROR_FILE_TOO_LARGE, status);
        }
        body.append(buffer.data(), read);
    }
    HttpResponse response;
    response.status = status;
    response.body.swap(body);
    return response;
}

}  // namespace

HttpResponse HttpsGet(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent) {
    try {
        return Get(url, maxBytes, userAgent, nullptr);
    } catch (const std::bad_alloc&) {
        // Processo de 32 bits: um corpo grande pode nao caber na memoria.
        return Failure(ERROR_NOT_ENOUGH_MEMORY);
    }
}

HttpResponse HttpsGetBearer(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent,
                            const std::string& bearer) {
    try {
        return Get(url, maxBytes, userAgent, &bearer);
    } catch (const std::bad_alloc&) {
        return Failure(ERROR_NOT_ENOUGH_MEMORY);   // o arquivo do chat (ate 25 MB) num processo de 32 bits
    }
}

HttpResponse HttpGetPinned(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent, int timeoutMs) {
    try {
        return Get(url, maxBytes, userAgent, nullptr, timeoutMs > 0 ? timeoutMs : 1);
    } catch (const std::bad_alloc&) {
        return Failure(ERROR_NOT_ENOUGH_MEMORY);
    }
}
