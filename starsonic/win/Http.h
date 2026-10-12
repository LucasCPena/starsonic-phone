#pragma once
// HTTPS pelo WinHTTP com a validacao de certificado padrao do Windows (nunca o URLGetAsync do
// MicroSIP, que ignora erros de certificado).
#include <windows.h>

#include <string>

struct HttpResponse {
    DWORD status = 0;   // codigo HTTP; 0 se nao houve resposta
    std::string body;
    DWORD error = 0;    // GetLastError() do WinHTTP quando falha
};

// So aceita https://. Segue redirecionamentos na politica padrao (nunca de HTTPS para HTTP).
// Resposta maior que maxBytes falha com ERROR_FILE_TOO_LARGE.
HttpResponse HttpsGet(const std::wstring& url, size_t maxBytes);
