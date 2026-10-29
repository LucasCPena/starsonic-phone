#pragma once
// A fonte da lista da empresa (spec da rc.4, secoes 5.2 a 5.4): o que a pessoa cola em Configuracoes vira o que o app
// busca (CompanySourceFor), e a resposta HTTP ja lida vira o resultado da busca (FromHttp). C++ portatil: nada de
// Windows aqui. Quem busca de verdade (o WinHTTP e o disco) e o executavel (windows/app/src); a ultima lista lida fica
// na CompanyListStore (Stores.h).
#include <optional>
#include <string>

namespace starsonic {

enum class CompanySourceKind { Google, GooglePublished, OneDrive, SharePoint, Dropbox, Link, Path };

struct CompanySource {
    CompanySourceKind kind = CompanySourceKind::Link;
    std::string location;   // a URL https a buscar, ou o caminho do arquivo (UTF-8)
};

// O texto colado sem os brancos das pontas (UTF-8): o espaco, o tab, o CR e o LF, e os invisiveis que o texto copiado
// traz junto, U+00A0 (o Outlook classico e o Word o poem no texto copiado), U+2000 a U+200B, U+202F, U+205F, U+3000 e
// U+FEFF. O meio fica como esta. O setCompanyList grava o link assim, e o CompanySourceFor o le assim.
std::string TrimLinkBlanks(const std::string& text);

// O link colado, sem os brancos das pontas (TrimLinkBlanks) e sem as aspas em volta (o "Copiar como caminho" do
// Explorer; os brancos de dentro delas tambem saem), vira a fonte. Nada se nao e um link https:// nem um caminho: o
// http:// sem o "s" nao vale, e o link com espaco ou caractere de controle no meio nao e link.
// O tipo vem do HOST do link, nao de um pedaco dele. O esquema e o host se comparam sem caixa (e saem em minusculas); o
// resto do endereco, o caminho e a consulta, sai como foi colado (os ids do Google diferenciam maiusculas). Um host vale
// um dominio so na fronteira de um nome: empresa.sharepoint.com e do sharepoint.com, sharepoint.com.example.org nao. O
// #fragmento nunca vai ao servidor e sai (menos o gid do Google).
// - Google Planilhas, docs.google.com/spreadsheets/d/<id>/... (tambem com o /u/<n>/ antes do /d/):
//   https://docs.google.com/spreadsheets/d/<id>/export?format=csv, com &gid=<aba> quando o link tem a aba, no #gid= ou
//   no ?gid= (so digitos; se estao nos dois, vale o do fragmento, que e o que o Google troca ao mudar de aba). Sem a
//   aba, o Google manda a primeira.
// - Google publicado na web, .../spreadsheets/d/e/<id>/pubhtml ou /pub:
//   https://docs.google.com/spreadsheets/d/e/<id>/pub?output=csv, com &gid=<aba> e &single=true quando o link tem.
// - OneDrive pessoal (1drv.ms e onedrive.live.com), e OneDrive ou SharePoint do trabalho (*.sharepoint.com): o mesmo
//   link com download=1. (A spec 5.2 mandava o OneDrive pessoal para api.onedrive.com/v1.0/shares/u!<base64url>/root/
//   content, mas esse endereco responde 401 a quem nao entrou na conta desde agosto de 2024; o link com download=1 baixa.)
// - Dropbox (dropbox.com e www.dropbox.com): o mesmo link com dl=1.
//   Nos dois, o parametro de mesmo nome que o link ja tem passa a valer 1 (no mesmo lugar); sem ele, entra no fim da
//   consulta. Quem ja tem download=1 ou dl=1 fica como esta.
// - Outro https://: o link como esta.
// - Caminho: \\servidor\pasta\arquivo, C:\... e Z:/... (a letra, os dois pontos e a barra), como foi colado; e o
//   file:///C:/pasta/x.csv e o file://servidor/pasta/x.csv, que viram C:\pasta\x.csv e \\servidor\pasta\x.csv (tambem a
//   pasta de rede como o Edge e o Chrome a escrevem, file://///servidor/pasta/x.csv). Os %XX do file:// sao UTF-8: o
//   que nao e %XX fica como esta, e o que sai sem ser UTF-8 valido ou com caractere de controle nao e caminho.
std::optional<CompanySource> CompanySourceFor(const std::string& link);

// Para o diagnostico (que nunca leva o link): "Google", "Google (publicado)", "OneDrive", "SharePoint", "Dropbox",
// "link" e "caminho".
const char* CompanySourceName(CompanySourceKind kind);

// Por que a busca nao deu os bytes. Closed: o link fechado (401, 403, 404 ou uma pagina de entrar no lugar da planilha).
// Offline: sem rede, servidor fora do ar ou tempo esgotado. NotFound: o arquivo do caminho nao existe ou o computador
// nao tem acesso (so o disco chega a ele, o FromHttp nunca). TooLarge: mais de 10 MB (kSheetMaxBytes).
enum class CompanyFetchError { None, Closed, Offline, NotFound, TooLarge };

struct CompanyFetch {
    CompanyFetchError error = CompanyFetchError::None;
    std::string bytes;   // so com error None
};

// A resposta HTTP ja lida pelo executavel: o status, se a rede falhou (sem resposta), se o corpo passou do limite e o
// corpo. O que cada uma vira:
// - networkError: Offline (sem resposta nao ha status).
// - 401, 403 e 404: Closed.
// - 5xx e qualquer outro status que nao seja o 200 (o redirecionamento que o WinHTTP nao seguiu, o 429...): Offline.
// - tooLarge, com um status que nao falhou: TooLarge (o corpo cortado no limite nao se julga).
// - 200 com uma pagina HTML no lugar da planilha, o Google ou a Microsoft pedindo login: Closed. E pagina o corpo que
//   comeca (depois do BOM, dos espacos e dos comentarios <!-- -->) com <!doctype html ou <html, sem caixa.
// - 200 com o resto: None, com os bytes como vieram (quem os le e o ReadContactSheet, que decide se e planilha).
CompanyFetch FromHttp(int status, bool networkError, bool tooLarge, std::string body);

}  // namespace starsonic
