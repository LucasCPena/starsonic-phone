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

HttpResponse Get(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent) {
    if (url.compare(0, 8, L"https://") != 0) {
        return Failure(ERROR_INVALID_PARAMETER);
    }
    URL_COMPONENTS parts = {};
    parts.dwStructSize = sizeof(parts);
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &parts) || parts.nScheme != INTERNET_SCHEME_HTTPS ||
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
    WinHttpSetTimeouts(session.get(), kConnectTimeoutMs, kConnectTimeoutMs, kReadTimeoutMs, kReadTimeoutMs);

    Handle connection(WinHttpConnect(session.get(), host.c_str(), parts.nPort, 0));
    if (!connection) return Failure(GetLastError());
    Handle request(WinHttpOpenRequest(connection.get(), L"GET", path.c_str(), NULL, WINHTTP_NO_REFERER,
                                      WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!request) return Failure(GetLastError());
    // WINHTTP_OPTION_SECURITY_FLAGS fica como esta: certificado invalido = falha. Redirecionamentos
    // seguem a politica padrao do WinHTTP, que nunca desce de HTTPS para HTTP.
    if (!WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
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
        return Get(url, maxBytes, userAgent);
    } catch (const std::bad_alloc&) {
        // Processo de 32 bits: um corpo grande pode nao caber na memoria.
        return Failure(ERROR_NOT_ENOUGH_MEMORY);
    }
}
