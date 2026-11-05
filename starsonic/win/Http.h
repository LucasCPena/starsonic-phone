#pragma once
// HTTPS pelo WinHTTP com a validacao de certificado padrao do Windows (nunca o URLGetAsync do
// app antigo, que ignora erros de certificado). Win32 puro: serve aos dois apps.
#include <windows.h>

#include <string>

struct HttpResponse {
    DWORD status = 0;   // codigo HTTP; 0 se nao houve resposta
    std::string body;
    DWORD error = 0;    // GetLastError() do WinHTTP quando falha
};

// So aceita https://. Segue redirecionamentos na politica padrao (nunca de HTTPS para HTTP).
// Resposta maior que maxBytes falha com ERROR_FILE_TOO_LARGE. userAgent: "Starsonic Phone/<versao>" (quem chama da a
// versao: este arquivo nao depende do build de nenhum dos dois apps).
HttpResponse HttpsGet(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent);

// O mesmo GET com o cabecalho "Authorization: Bearer <bearer>" (a chave do computador no chat, 0.2.0; so ASCII visivel,
// senao falha com ERROR_INVALID_PARAMETER) e sem seguir redirecionamento (WINHTTP_OPTION_REDIRECT_POLICY_NEVER): a
// chave nunca vai a outro endereco, e um 3xx volta como a resposta.
HttpResponse HttpsGetBearer(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent,
                            const std::string& bearer);
