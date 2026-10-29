#pragma once
// A leitura da planilha da empresa no executavel (spec da rc.4, 5.2 a 5.4 e 7.4): o gancho fetchCompanyList do
// DesktopApp. A fonte ja vem decidida (CompanySourceFor, ListaEmpresa.h):
// - Um link https://: pelo WinHTTP (HttpsGet, Http.h), ate kSheetMaxBytes, com o user agent do atualizador; os
//   redirecionamentos e os cookies na regra padrao do WinHTTP (o download=1 do OneDrive e do SharePoint e o export do
//   Google redirecionam; nunca de HTTPS para HTTP). A resposta vira o resultado pelo FromHttp.
// - Um caminho (\\servidor\pasta\x.xlsx, C:\... ou Z:/..., em UTF-8): pelo disco, com o acesso do usuario do Windows,
//   tambem a planilha aberta no Excel (os tres FILE_SHARE). O tamanho e conferido antes de ler: mais de kSheetMaxBytes
//   e TooLarge. Nao abrir ou nao ler (nao existe, sem acesso, a pasta da rede fora do ar, um caminho que nao e de um
//   arquivo) e NotFound.
// O diagnostico leva so o motivo e o codigo do erro (o do Windows, ou o status HTTP), nunca o link nem o caminho.
//
// Threads: uma thread propria le os pedidos, um por vez, na ordem; Fetch so poe na fila e volta (a thread de comandos
// do DesktopApp nunca espera a rede nem o disco). Cada pedido recebe uma resposta, uma vez (o done, na thread que le),
// ate o Stop. O Stop nao espera a leitura de agora (uma pasta da rede fora do ar, ou um link lento, com 10 s + 30 s a
// cada redirecionamento, segurariam o Sair): marca a parada, descarta os pedidos na fila e volta; a leitura de agora
// termina sozinha e nao responde. A thread confere a parada com a trava do Stop presa, e o done e o diagnostico rodam
// com ela: depois de o Stop voltar, nenhum done e nenhuma linha. Como as threads do Updater, a thread guarda o que
// precisa: o CompanyFetcher pode sair antes dela, e uma leitura presa dura ate o fim do processo.
#include <functional>
#include <memory>
#include <string>

#include "ListaEmpresa.h"

namespace starsonic {

class CompanyFetcher {
public:
    // userAgent: o do atualizador ("Starsonic Phone/<versao>"). log: uma linha do diagnostico (de qualquer thread).
    CompanyFetcher(std::wstring userAgent, std::function<void(const std::string&)> log);
    ~CompanyFetcher();   // Stop()

    CompanyFetcher(const CompanyFetcher&) = delete;
    CompanyFetcher& operator=(const CompanyFetcher&) = delete;

    // Le a fonte na thread propria; o done leva o resultado. Depois do Stop: descartado (sem resposta). De qualquer
    // thread; nunca espera.
    void Fetch(const CompanySource& source, std::function<void(const CompanyFetch&)> done);
    // Ver acima. De qualquer thread; de novo, nada.
    void Stop();

private:
    struct Shared;   // o estado dividido com a thread (CompanyFetcher.cpp)
    static void Work(std::shared_ptr<Shared> shared);

    std::shared_ptr<Shared> shared_;
};

}  // namespace starsonic
