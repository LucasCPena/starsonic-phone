// Testes da fonte e da loja da lista da empresa (spec da rc.4, secoes 5.2 a 5.4 e 5.6): as conversoes do link colado
// (ListaEmpresa.h: CompanySourceFor), o resultado de uma resposta HTTP (FromHttp) e a CompanyListStore (Stores.h), a
// ultima lista boa guardada em contatos-empresa.json. Todos os links, enderecos e ids daqui sao inventados.
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ListaEmpresa.h"
#include "Stores.h"
#include "nlohmann/json.hpp"
#include "test_support.h"

using namespace starsonic;

namespace {

// ---------------------------------------------------------------- Os links

// O link colado, o tipo da fonte (CompanySourceName) e o que o app busca.
struct SourceRow {
    const char* link;
    const char* kind;
    const char* location;
};

void CheckSources(const std::vector<SourceRow>& rows) {
    for (const SourceRow& row : rows) {
        CAPTURE(row.link);
        const std::optional<CompanySource> source = CompanySourceFor(row.link);
        CHECK(source.has_value());
        if (!source) continue;
        CHECK(std::string(CompanySourceName(source->kind)) == row.kind);
        CHECK(source->location == row.location);
    }
}

void CheckNothing(const std::vector<std::string>& links) {
    for (const std::string& link : links) {
        CAPTURE(link);
        CHECK_FALSE(CompanySourceFor(link).has_value());
    }
}

// ---------------------------------------------------------------- A resposta HTTP

std::string ErrorName(CompanyFetchError error) {
    switch (error) {
        case CompanyFetchError::None: return "None";
        case CompanyFetchError::Closed: return "Closed";
        case CompanyFetchError::Offline: return "Offline";
        case CompanyFetchError::NotFound: return "NotFound";
        case CompanyFetchError::TooLarge: return "TooLarge";
    }
    return "?";
}

// ---------------------------------------------------------------- A loja

const char* const kCompanyPath = "dados/contatos-empresa.json";

SheetContact MakeSheetContact(const std::wstring& name, const std::string& number,
                              const std::wstring& note = std::wstring()) {
    SheetContact contact;
    contact.name = name;
    contact.number = number;
    contact.note = note;
    return contact;
}

// Os contatos, um por texto: "nome|numero|observacao".
std::vector<std::wstring> Rows(const std::vector<SheetContact>& contacts) {
    std::vector<std::wstring> rows;
    for (const SheetContact& contact : contacts) {
        std::wstring row = contact.name + L"|";
        for (const char ch : contact.number) row.push_back(static_cast<wchar_t>(static_cast<unsigned char>(ch)));
        rows.push_back(row + L"|" + contact.note);
    }
    return rows;
}

// As chaves de um objeto JSON, em ordem.
std::vector<std::string> Keys(const nlohmann::json& object) {
    std::vector<std::string> keys;
    for (auto it = object.begin(); it != object.end(); ++it) keys.push_back(it.key());
    return keys;
}

}  // namespace

// ================================================================ CompanySourceFor

TEST_CASE("company link: a Google Sheets link becomes the csv export of its tab") {
    CheckSources({
        {"https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=456", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export?format=csv&gid=456"},
        // Sem a aba, o Google manda a primeira.
        {"https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit?usp=sharing", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export?format=csv"},
        // A aba nos dois lugares.
        {"https://docs.google.com/spreadsheets/d/1AbC/edit?gid=789#gid=789", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=789"},
        // So na consulta, nao sendo o primeiro parametro.
        {"https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing&gid=12", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=12"},
        // A aba 0 e uma aba: fica no endereco.
        {"https://docs.google.com/spreadsheets/d/1AbC/edit#gid=0", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=0"},
        // O fragmento tem outros parametros alem do gid.
        {"https://docs.google.com/spreadsheets/d/1AbC/edit#gid=5&range=A1:C9", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=5"},
        // O link sem o /edit, e o de quem tem mais de uma conta Google (/u/1/).
        {"https://docs.google.com/spreadsheets/d/1AbC", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv"},
        {"https://docs.google.com/spreadsheets/u/1/d/1AbC/edit#gid=3", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=3"},
        // O link de baixar que a pessoa ja tinha: o formato que vale e o CSV.
        {"https://docs.google.com/spreadsheets/d/1AbC/export?format=xlsx&gid=7", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=7"},
    });
}

TEST_CASE("company link: the tab of a Google link is the fragment's, then the query's, and only digits") {
    CheckSources({
        // Os dois, diferentes: vale o do fragmento (o que o Google atualiza ao trocar de aba).
        {"https://docs.google.com/spreadsheets/d/1AbC/edit?gid=1#gid=2", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=2"},
        // Um gid que nao e numero nao vira parte do endereco.
        {"https://docs.google.com/spreadsheets/d/1AbC/edit#gid=abc", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv"},
        {"https://docs.google.com/spreadsheets/d/1AbC/edit?gid=12x", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv"},
        {"https://docs.google.com/spreadsheets/d/1AbC/edit?gid=", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv"},
        // Um fragmento sem gid que presta deixa valer o da consulta.
        {"https://docs.google.com/spreadsheets/d/1AbC/edit?gid=4#gid=x", "Google",
         "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=4"},
    });
}

TEST_CASE("company link: a Google link published on the web becomes the published csv") {
    CheckSources({
        {"https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pubhtml", "Google (publicado)",
         "https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv"},
        {"https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?gid=0&single=true&output=xlsx",
         "Google (publicado)", "https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv&gid=0&single=true"},
        // O que a janela "Publicar na Web" da de uma aba so.
        {"https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pubhtml?gid=123&single=true", "Google (publicado)",
         "https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv&gid=123&single=true"},
        {"https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pubhtml#gid=55", "Google (publicado)",
         "https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv&gid=55"},
        // O que nao e "single=true" nao vai.
        {"https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?single=false&output=csv", "Google (publicado)",
         "https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv"},
        {"https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv", "Google (publicado)",
         "https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv"},
    });
}

TEST_CASE("company link: personal OneDrive is converted like SharePoint, with download=1 (ruling R4)") {
    CheckSources({
        {"https://1drv.ms/x/s!AbCdEf123", "OneDrive", "https://1drv.ms/x/s!AbCdEf123?download=1"},
        {"https://1drv.ms/x/c/1a2b3c4d5e6f7a8b/EaBcDeF_123?e=Xy12Ab", "OneDrive",
         "https://1drv.ms/x/c/1a2b3c4d5e6f7a8b/EaBcDeF_123?e=Xy12Ab&download=1"},
        {"https://onedrive.live.com/edit?id=ABC123%21105&resid=ABC123%21105&authkey=!XyZ", "OneDrive",
         "https://onedrive.live.com/edit?id=ABC123%21105&resid=ABC123%21105&authkey=!XyZ&download=1"},
        // O fragmento nao e um parametro: sai.
        {"https://onedrive.live.com/:x:/g/personal/1A2B3C4D5E6F7A8B/EaBcDeF_123?e=Xy12Ab#x", "OneDrive",
         "https://onedrive.live.com/:x:/g/personal/1A2B3C4D5E6F7A8B/EaBcDeF_123?e=Xy12Ab&download=1"},
        // Quem ja tem o download=1 fica como esta.
        {"https://1drv.ms/x/c/1a2b/EaB?download=1", "OneDrive", "https://1drv.ms/x/c/1a2b/EaB?download=1"},
    });
}

TEST_CASE("company link: a SharePoint link gets download=1 once") {
    CheckSources({
        {"https://empresa.sharepoint.com/:x:/s/Comercial/EaBcD?e=Xy12", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/Comercial/EaBcD?e=Xy12&download=1"},
        {"https://empresa-my.sharepoint.com/:x:/g/personal/ana_empresa_com/EaBc#x", "SharePoint",
         "https://empresa-my.sharepoint.com/:x:/g/personal/ana_empresa_com/EaBc?download=1"},
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?download=1", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?download=1"},
        // A consulta e o fragmento juntos; o download=1 que ja estava no meio fica, e so o fragmento sai.
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?e=1&download=1&x=2#topo", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?e=1&download=1&x=2"},
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?e=Xy12#topo", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?e=Xy12&download=1"},
        // Um download=0 passa a 1, no mesmo lugar.
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?download=0&e=1", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?download=1&e=1"},
        // So o parametro de nome download conta, e uma consulta vazia ou terminada em & nao ganha um & a mais.
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?mydownload=1", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?mydownload=1&download=1"},
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?e=download=1", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?e=download=1&download=1"},
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?download=1"},
        {"https://empresa.sharepoint.com/:x:/s/C/EaB?e=1&", "SharePoint",
         "https://empresa.sharepoint.com/:x:/s/C/EaB?e=1&download=1"},
        // O link direto do arquivo na biblioteca.
        {"https://empresa.sharepoint.com/sites/Comercial/Shared%20Documents/contatos.xlsx", "SharePoint",
         "https://empresa.sharepoint.com/sites/Comercial/Shared%20Documents/contatos.xlsx?download=1"},
    });
}

TEST_CASE("company link: a Dropbox link gets dl=1") {
    CheckSources({
        {"https://www.dropbox.com/scl/fi/abc/contatos.xlsx?rlkey=k1&dl=0", "Dropbox",
         "https://www.dropbox.com/scl/fi/abc/contatos.xlsx?rlkey=k1&dl=1"},
        {"https://www.dropbox.com/s/abc/contatos.csv", "Dropbox", "https://www.dropbox.com/s/abc/contatos.csv?dl=1"},
        {"https://www.dropbox.com/scl/fi/abc/contatos.xlsx?rlkey=k1&dl=1", "Dropbox",
         "https://www.dropbox.com/scl/fi/abc/contatos.xlsx?rlkey=k1&dl=1"},
        {"https://www.dropbox.com/s/abc/contatos.csv?dl=0#topo", "Dropbox",
         "https://www.dropbox.com/s/abc/contatos.csv?dl=1"},
        {"https://dropbox.com/s/abc/contatos.csv", "Dropbox", "https://dropbox.com/s/abc/contatos.csv?dl=1"},
    });
}

TEST_CASE("company link: any other https link stays as it is, without the fragment") {
    CheckSources({
        {"https://intranet.empresa.com.br/contatos.csv#topo", "link", "https://intranet.empresa.com.br/contatos.csv"},
        {"https://intranet.empresa.com.br/contatos.csv", "link", "https://intranet.empresa.com.br/contatos.csv"},
        {"https://intranet.empresa.com.br/lista?formato=csv&x=1#a", "link",
         "https://intranet.empresa.com.br/lista?formato=csv&x=1"},
        {"https://intranet.empresa.com.br", "link", "https://intranet.empresa.com.br"},
        // Um servico do Google que nao e planilha, e o Google no meio do caminho de outro servidor, nao sao Google.
        {"https://docs.google.com/document/d/1AbC/edit", "link", "https://docs.google.com/document/d/1AbC/edit"},
        {"https://intranet.empresa.com.br/docs.google.com/spreadsheets/d/X/edit", "link",
         "https://intranet.empresa.com.br/docs.google.com/spreadsheets/d/X/edit"},
        {"https://intranet.empresa.com.br/lista?de=https://empresa.sharepoint.com/x", "link",
         "https://intranet.empresa.com.br/lista?de=https://empresa.sharepoint.com/x"},
    });
}

TEST_CASE("company link: a path stays a path") {
    CheckSources({
        {R"x(  \\servidor\pasta\contatos.xlsx  )x", "caminho", R"x(\\servidor\pasta\contatos.xlsx)x"},
        // O "Copiar como caminho" do Explorer poe aspas.
        {R"x("C:\Users\Ana\contatos.csv")x", "caminho", R"x(C:\Users\Ana\contatos.csv)x"},
        {R"x( "C:\Users\Ana Maria\Meus contatos.csv" )x", "caminho", R"x(C:\Users\Ana Maria\Meus contatos.csv)x"},
        {R"x("\\servidor\pasta compartilhada\lista.xlsx")x", "caminho", R"x(\\servidor\pasta compartilhada\lista.xlsx)x"},
        {"Z:/lista.xlsx", "caminho", "Z:/lista.xlsx"},
        {R"x(Z:\lista.xlsx)x", "caminho", R"x(Z:\lista.xlsx)x"},
        {R"x(c:\dados\lista.csv)x", "caminho", R"x(c:\dados\lista.csv)x"},
        {"\tZ:/lista.xlsx\r\n", "caminho", "Z:/lista.xlsx"},
        // Um link https entre aspas tambem perde as aspas.
        {"\"https://intranet.empresa.com.br/contatos.csv\"", "link", "https://intranet.empresa.com.br/contatos.csv"},
    });
}

TEST_CASE("company link: a file:// link becomes a Windows path") {
    CheckSources({
        {"file:///C:/Users/Ana/Meus%20contatos.csv", "caminho", R"x(C:\Users\Ana\Meus contatos.csv)x"},
        {"file://servidor/pasta/x.xlsx", "caminho", R"x(\\servidor\pasta\x.xlsx)x"},
        // O %XX e UTF-8: o "e" com acento agudo e %C3%A9.
        {"file:///C:/Users/Ana/Lista%20de%20contatos%20-%20Jos%C3%A9.csv", "caminho",
         "C:\\Users\\Ana\\Lista de contatos - Jos\xc3\xa9.csv"},
        // A pasta de rede como o Edge e o Chrome a escrevem (tres a mais), e com o caractere : codificado.
        {"file://///servidor/pasta/x.xlsx", "caminho", R"x(\\servidor\pasta\x.xlsx)x"},
        {"file:////servidor/pasta/x.xlsx", "caminho", R"x(\\servidor\pasta\x.xlsx)x"},
        {"file:///C%3A/Users/Ana/x.csv", "caminho", R"x(C:\Users\Ana\x.csv)x"},
        // A caixa do esquema nao importa; a do caminho fica.
        {"FILE:///C:/Users/Ana/X.CSV", "caminho", R"x(C:\Users\Ana\X.CSV)x"},
        {"File://Servidor/Pasta/X.xlsx", "caminho", R"x(\\Servidor\Pasta\X.xlsx)x"},
        // Um % que nao e seguido de dois digitos hexadecimais fica como esta.
        {"file:///C:/Users/Ana/100%.csv", "caminho", R"x(C:\Users\Ana\100%.csv)x"},
        {"file:///C:/Users/Ana/a%2.csv", "caminho", R"x(C:\Users\Ana\a%2.csv)x"},
        {"file:///C:/Users/Ana/a%zzb.csv", "caminho", R"x(C:\Users\Ana\a%zzb.csv)x"},
    });
}

TEST_CASE("company link: what is not an https link or a path is nothing") {
    CheckNothing({
        "http://intranet/contatos.csv",
        "",
        "contatos",
        "ftp://x/y.csv",
        "https://",
        // Pontas sem nada, aspas sem nada.
        "   ",
        "\"\"",
        "\"",
        "\"https://intranet.empresa.com.br/contatos.csv",
        // O https tem de ter host.
        "https:///contatos.csv",
        "https://:443/contatos.csv",
        "https://usuario@/contatos.csv",
        "https:/intranet.empresa.com.br/contatos.csv",
        "https:intranet.empresa.com.br",
        "HTTP://intranet/contatos.csv",
        // Um espaco ou um caractere de controle no meio de um link nao e link.
        "https://intranet.empresa.com.br/meus contatos.csv",
        "https://intranet.empresa.com.br/contatos.csv outra coisa",
        "https://intranet.empresa.com.br/\ncontatos.csv",
        std::string("https://intranet.empresa.com.br/con") + std::string(1, '\0') + "tatos.csv",
        "https://intranet.empresa.com.br/con\x01tatos.csv",
        // Caminhos que nao sao de arquivo do Windows.
        R"x(\\)x",
        R"x(\\\servidor\pasta)x",
        "C:",
        "C:contatos.csv",
        R"x(1:\contatos.csv)x",
        "//servidor/pasta/x.xlsx",
        "/usr/lib/x.csv",
        R"x(pasta\contatos.csv)x",
        "C:\\pasta\\con\ntatos.csv",
        // file: sem o formato do Windows ou com bytes que nao sao texto.
        "file://",
        "file:///",
        "file:////",
        "file://///",
        "file:/C:/x.csv",
        "file:C:/x.csv",
        "file:///Users/ana/x.csv",
        "file:///C:/x%00.csv",
        "file:///C:/x%E9.csv",
        "file:///C:/x%C3.csv",
        "file:///C:/x%0A.csv",
    });
}

TEST_CASE("company link: the scheme and the host are compared without case, the path and the query keep theirs") {
    CheckSources({
        {"HTTPS://DOCS.GOOGLE.COM/spreadsheets/d/AbC_Dd/edit#gid=5", "Google",
         "https://docs.google.com/spreadsheets/d/AbC_Dd/export?format=csv&gid=5"},
        {"Https://Docs.Google.Com/spreadsheets/d/e/2PACX-AbCd/pubhtml?gid=7&single=true", "Google (publicado)",
         "https://docs.google.com/spreadsheets/d/e/2PACX-AbCd/pub?output=csv&gid=7&single=true"},
        {"HTTPS://1DRV.MS/x/s!AbCdEf123", "OneDrive", "https://1drv.ms/x/s!AbCdEf123?download=1"},
        {"https://OneDrive.Live.com/Edit?Id=ABC&AuthKey=!XyZ", "OneDrive",
         "https://onedrive.live.com/Edit?Id=ABC&AuthKey=!XyZ&download=1"},
        {"Https://EMPRESA-MY.SharePoint.Com/:x:/g/personal/Ana_Empresa_Com/EaBc?E=Xy", "SharePoint",
         "https://empresa-my.sharepoint.com/:x:/g/personal/Ana_Empresa_Com/EaBc?E=Xy&download=1"},
        // O nome de um parametro tambem e do link: o "DL" nao e o "dl".
        {"HTTPS://WWW.DROPBOX.COM/s/AbC/Contatos.CSV?DL=0", "Dropbox",
         "https://www.dropbox.com/s/AbC/Contatos.CSV?DL=0&dl=1"},
        {"HTTPS://Intranet.Empresa.com.br/Contatos/Lista.CSV?Token=AbC#Topo", "link",
         "https://intranet.empresa.com.br/Contatos/Lista.CSV?Token=AbC"},
    });
}

TEST_CASE("company link: the host decides, and a host matches a domain only at a label boundary") {
    CheckSources({
        // Quem compra um nome parecido nao e do Google, da Microsoft nem do Dropbox.
        {"https://sharepoint.com.example.org/:x:/s/C/EaB", "link", "https://sharepoint.com.example.org/:x:/s/C/EaB"},
        {"https://notsharepoint.com/:x:/s/C/EaB", "link", "https://notsharepoint.com/:x:/s/C/EaB"},
        {"https://empresa.sharepoint.com.br/:x:/s/C/EaB", "link", "https://empresa.sharepoint.com.br/:x:/s/C/EaB"},
        {"https://docs.google.com.example.org/spreadsheets/d/AbC/edit", "link",
         "https://docs.google.com.example.org/spreadsheets/d/AbC/edit"},
        {"https://notdocs.google.com/spreadsheets/d/AbC/edit", "link",
         "https://notdocs.google.com/spreadsheets/d/AbC/edit"},
        {"https://dropbox.com.example.org/s/abc/x.csv", "link", "https://dropbox.com.example.org/s/abc/x.csv"},
        {"https://mydropbox.com/s/abc/x.csv", "link", "https://mydropbox.com/s/abc/x.csv"},
        {"https://1drv.ms.example.org/x/s!AbC", "link", "https://1drv.ms.example.org/x/s!AbC"},
        {"https://x1drv.ms/x/s!AbC", "link", "https://x1drv.ms/x/s!AbC"},
        {"https://live.com/edit?id=1", "link", "https://live.com/edit?id=1"},
        // O nome do servico no caminho ou na consulta de outro servidor.
        {"https://example.org/sharepoint.com/x", "link", "https://example.org/sharepoint.com/x"},
        {"https://example.org/x?u=https://empresa.sharepoint.com/y", "link",
         "https://example.org/x?u=https://empresa.sharepoint.com/y"},
        // O usuario antes do @ nao e o host: o host e o que vem depois.
        {"https://docs.google.com@example.org/spreadsheets/d/AbC/edit", "link",
         "https://docs.google.com@example.org/spreadsheets/d/AbC/edit"},
        {"https://example.org@docs.google.com/spreadsheets/d/AbC/edit", "Google",
         "https://docs.google.com/spreadsheets/d/AbC/export?format=csv"},
        // A porta tambem nao e o host. No Google ela sai; nos outros fica como estava.
        {"https://docs.google.com:443/spreadsheets/d/AbC/edit", "Google",
         "https://docs.google.com/spreadsheets/d/AbC/export?format=csv"},
        {"https://empresa.sharepoint.com:443/:x:/s/C/EaB", "SharePoint",
         "https://empresa.sharepoint.com:443/:x:/s/C/EaB?download=1"},
        {"https://Usuario:Senha@Intranet.empresa.com.br:8443/lista.csv", "link",
         "https://Usuario:Senha@intranet.empresa.com.br:8443/lista.csv"},
    });
}

TEST_CASE("company link: a Google link that is not a sheet link is left as it is") {
    CheckSources({
        {"https://docs.google.com/spreadsheets/", "link", "https://docs.google.com/spreadsheets/"},
        {"https://docs.google.com/spreadsheets/d/", "link", "https://docs.google.com/spreadsheets/d/"},
        {"https://docs.google.com/spreadsheets/d/e", "link", "https://docs.google.com/spreadsheets/d/e"},
        {"https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/edit", "link",
         "https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/edit"},
        {"https://docs.google.com/spreadsheets/d/1Ab%20C/edit", "link",
         "https://docs.google.com/spreadsheets/d/1Ab%20C/edit"},
        {"https://docs.google.com/spreadsheets/d/../edit", "link", "https://docs.google.com/spreadsheets/d/../edit"},
        {"https://docs.google.com/spreadsheets/u/x/d/1AbC/edit", "link",
         "https://docs.google.com/spreadsheets/u/x/d/1AbC/edit"},
    });
}

TEST_CASE("company source names are the ones the diagnostics use") {
    CHECK(std::string(CompanySourceName(CompanySourceKind::Google)) == "Google");
    CHECK(std::string(CompanySourceName(CompanySourceKind::GooglePublished)) == "Google (publicado)");
    CHECK(std::string(CompanySourceName(CompanySourceKind::OneDrive)) == "OneDrive");
    CHECK(std::string(CompanySourceName(CompanySourceKind::SharePoint)) == "SharePoint");
    CHECK(std::string(CompanySourceName(CompanySourceKind::Dropbox)) == "Dropbox");
    CHECK(std::string(CompanySourceName(CompanySourceKind::Link)) == "link");
    CHECK(std::string(CompanySourceName(CompanySourceKind::Path)) == "caminho");
}

// ================================================================ FromHttp

TEST_CASE("fetch result: a 200 with a body that is not a page carries the bytes") {
    CompanyFetch fetch = FromHttp(200, false, false, "Nome;Numero\n");
    CHECK(ErrorName(fetch.error) == "None");
    CHECK(fetch.bytes == "Nome;Numero\n");

    // Os bytes passam como vieram: um .xlsx tem NULs e nao e texto.
    const std::string xlsx("PK\x03\x04\x14\0\0\0\x08\0", 10);
    fetch = FromHttp(200, false, false, xlsx);
    CHECK(ErrorName(fetch.error) == "None");
    CHECK(fetch.bytes == xlsx);

    // Sem corpo, a leitura da planilha e que diz que nao e planilha.
    fetch = FromHttp(200, false, false, "");
    CHECK(ErrorName(fetch.error) == "None");
    CHECK(fetch.bytes.empty());
}

TEST_CASE("fetch result: only the start of the body says it is a page") {
    const std::vector<std::string> sheets = {
        "Nome;Numero\nAna;2002\n",
        "\xef\xbb\xbfNome;N\xc3\xbamero\r\nAna;2002\r\n",
        "Nome;Numero\n<html>;2002\n",
        "<Nome>;Numero\n",
        "html;2002\n",
        "<!-- sem fim",
        "<!-- um -->Nome;Numero\n",
    };
    for (const std::string& sheet : sheets) {
        CAPTURE(sheet);
        const CompanyFetch fetch = FromHttp(200, false, false, sheet);
        CHECK(ErrorName(fetch.error) == "None");
        CHECK(fetch.bytes == sheet);
    }
}

TEST_CASE("fetch result: a 200 with a web page is a closed link") {
    const std::vector<std::string> pages = {
        "<!DOCTYPE html><html><head><title>Sign in</title></head><body></body></html>",
        "  <html>",
        "\r\n\t <!doctype HTML PUBLIC \"-//W3C//DTD HTML 4.01//EN\">",
        "<HTML lang=\"pt-BR\">",
        "\xef\xbb\xbf<!DOCTYPE html>",
        // A pagina de entrar da Microsoft comeca com um comentario.
        "<!-- Copyright (C) Microsoft Corporation. All rights reserved. -->\r\n<!DOCTYPE html>\r\n<html dir=\"ltr\">",
        "<!-- um -->  <!-- dois --><html>",
    };
    for (const std::string& page : pages) {
        CAPTURE(page);
        const CompanyFetch fetch = FromHttp(200, false, false, page);
        CHECK(ErrorName(fetch.error) == "Closed");
        CHECK(fetch.bytes.empty());
    }
}

TEST_CASE("fetch result: 401, 403 and 404 are a closed link") {
    for (const int status : {401, 403, 404}) {
        CAPTURE(status);
        CompanyFetch fetch = FromHttp(status, false, false, "");
        CHECK(ErrorName(fetch.error) == "Closed");
        CHECK(fetch.bytes.empty());
        // Com o corpo da pagina de erro, o resultado e o mesmo e os bytes nao vao.
        fetch = FromHttp(status, false, false, "<html>Not found</html>");
        CHECK(ErrorName(fetch.error) == "Closed");
        CHECK(fetch.bytes.empty());
        fetch = FromHttp(status, false, false, "Nome;Numero\n");
        CHECK(ErrorName(fetch.error) == "Closed");
        CHECK(fetch.bytes.empty());
    }
}

TEST_CASE("fetch result: a server error, a network error and any other status are offline") {
    for (const int status : {500, 502, 503, 504, 599}) {
        CAPTURE(status);
        const CompanyFetch fetch = FromHttp(status, false, false, "<html>Erro</html>");
        CHECK(ErrorName(fetch.error) == "Offline");
        CHECK(fetch.bytes.empty());
    }
    // Sem resposta: o status nao diz nada.
    for (const int status : {0, 200, 404}) {
        CAPTURE(status);
        const CompanyFetch fetch = FromHttp(status, true, false, "Nome;Numero\n");
        CHECK(ErrorName(fetch.error) == "Offline");
        CHECK(fetch.bytes.empty());
    }
    // Os outros: o redirecionamento que o WinHTTP nao seguiu, o que nao existe mais, o limite de pedidos...
    for (const int status : {0, 204, 206, 301, 302, 304, 400, 410, 429}) {
        CAPTURE(status);
        const CompanyFetch fetch = FromHttp(status, false, false, "Nome;Numero\n");
        CHECK(ErrorName(fetch.error) == "Offline");
        CHECK(fetch.bytes.empty());
    }
}

TEST_CASE("fetch result: a body over the limit is too large") {
    CompanyFetch fetch = FromHttp(200, false, true, "");
    CHECK(ErrorName(fetch.error) == "TooLarge");
    CHECK(fetch.bytes.empty());
    // O corpo cortado no limite nao se julga: nem pagina, nem bytes.
    fetch = FromHttp(200, false, true, "<!DOCTYPE html>");
    CHECK(ErrorName(fetch.error) == "TooLarge");
    CHECK(fetch.bytes.empty());
    fetch = FromHttp(200, false, true, "Nome;Numero\n");
    CHECK(ErrorName(fetch.error) == "TooLarge");
    CHECK(fetch.bytes.empty());
    // Sem status (a busca parou no limite antes de ler o cabecalho) ainda e grande demais.
    CHECK(ErrorName(FromHttp(0, false, true, "").error) == "TooLarge");
    // A pagina de erro grande de um link fechado ou de um servidor fora do ar diz o que o status diz.
    CHECK(ErrorName(FromHttp(404, false, true, "").error) == "Closed");
    CHECK(ErrorName(FromHttp(403, false, true, "").error) == "Closed");
    CHECK(ErrorName(FromHttp(503, false, true, "").error) == "Offline");
    // E sem rede nao ha o que medir.
    CHECK(ErrorName(FromHttp(200, true, true, "").error) == "Offline");
}

// ================================================================ CompanyListStore

TEST_CASE("company list: Replace writes the exact format and another store reads it back") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    const std::vector<SheetContact> list = {
        MakeSheetContact(L"Jos\u00e9 da Silva", "(11) 5060-3000", L"Vendas \u2013 filial"),
        MakeSheetContact(L"Ana", "2002"),
        MakeSheetContact(L"Z\u00e9", "+55 11 98888-7777", L"linha1\nlinha2"),
    };
    REQUIRE(store.Replace(list, 1760000000123));

    const nlohmann::json json = nlohmann::json::parse(files.files.at(kCompanyPath));
    CHECK(Keys(json) == std::vector<std::string>{"atualizada", "contatos", "versao"});
    CHECK(json["versao"] == 1);
    CHECK(json["atualizada"] == 1760000000123);
    REQUIRE(json["contatos"].is_array());
    REQUIRE(json["contatos"].size() == 3);
    for (const nlohmann::json& entry : json["contatos"]) {
        CHECK(Keys(entry) == std::vector<std::string>{"nome", "numero", "observacao"});
    }
    CHECK(json["contatos"][0]["nome"] == "Jos\xc3\xa9 da Silva");
    CHECK(json["contatos"][0]["numero"] == "(11) 5060-3000");
    CHECK(json["contatos"][0]["observacao"] == "Vendas \xe2\x80\x93 filial");
    CHECK(json["contatos"][1]["nome"] == "Ana");
    CHECK(json["contatos"][1]["numero"] == "2002");
    CHECK(json["contatos"][1]["observacao"] == "");
    CHECK(json["contatos"][2]["nome"] == "Z\xc3\xa9");
    CHECK(json["contatos"][2]["numero"] == "+55 11 98888-7777");
    CHECK(json["contatos"][2]["observacao"] == "linha1\nlinha2");
    CHECK(files.files.count(std::string(kCompanyPath) + ".tmp") == 0);

    CHECK(Rows(store.All()) == Rows(list));
    CHECK(store.UpdatedMs() == 1760000000123);

    CompanyListStore reloaded(files, kCompanyPath);
    REQUIRE(reloaded.Load());
    CHECK(Rows(reloaded.All()) == Rows(list));
    CHECK(reloaded.UpdatedMs() == 1760000000123);
    CHECK(reloaded.NameFor("11 5060 3000") == L"Jos\u00e9 da Silva");
}

TEST_CASE("company list: a store with no file is an empty list and not an error") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    CHECK(store.Load());
    CHECK(store.All().empty());
    CHECK(store.UpdatedMs() == 0);
    CHECK(store.NameFor("2002").empty());
    CHECK(files.files.empty());
}

TEST_CASE("company list: an unreadable file is an empty list, Load says false and the file stays") {
    MemoryFileSystem files;
    std::string content;
    SUBCASE("not json") { content = "{ isto nao e json"; }
    SUBCASE("empty file") { content = ""; }
    SUBCASE("another version") {
        content = R"({"versao":2,"atualizada":5,"contatos":[{"nome":"Ana","numero":"1001"}]})";
    }
    SUBCASE("no version") { content = R"({"atualizada":5,"contatos":[{"nome":"Ana","numero":"1001"}]})"; }
    SUBCASE("version that is not a number") {
        content = R"({"versao":"1","atualizada":5,"contatos":[{"nome":"Ana","numero":"1001"}]})";
    }
    SUBCASE("not an object") { content = R"([{"nome":"Ana","numero":"1001"}])"; }
    SUBCASE("no list of contacts") { content = R"({"versao":1,"atualizada":5})"; }
    SUBCASE("contacts that are not a list") {
        content = R"({"versao":1,"atualizada":5,"contatos":{"nome":"Ana","numero":"1001"}})";
    }
    files.files[kCompanyPath] = content;

    CompanyListStore store(files, kCompanyPath);
    CHECK_FALSE(store.Load());
    CHECK(store.All().empty());
    CHECK(store.UpdatedMs() == 0);
    CHECK(store.NameFor("1001").empty());
    CHECK(files.files[kCompanyPath] == content);   // o arquivo nao e tocado ate a proxima gravacao

    // A proxima leitura boa o troca.
    REQUIRE(store.Replace({MakeSheetContact(L"Bia", "2003")}, 9000));
    CHECK(files.files[kCompanyPath] != content);
    CompanyListStore reloaded(files, kCompanyPath);
    CHECK(reloaded.Load());
    CHECK(Rows(reloaded.All()) == std::vector<std::wstring>{L"Bia|2003|"});
}

TEST_CASE("company list: Load throws away the list a store had when the file is no longer readable") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "2002")}, 1000));
    files.files[kCompanyPath] = "lixo";
    CHECK_FALSE(store.Load());
    CHECK(store.All().empty());
    CHECK(store.UpdatedMs() == 0);
    CHECK(store.NameFor("2002").empty());
}

TEST_CASE("company list: an entry that cannot be read is left out and the others are kept") {
    MemoryFileSystem files;
    files.files[kCompanyPath] = R"({"versao":1,"atualizada":42,"contatos":[
        {"nome":"Ana","numero":"1001","observacao":"x"},
        {"nome":"Sem numero"},
        {"numero":"1003"},
        {"nome":"","numero":"1004"},
        {"nome":"Numero vazio","numero":""},
        {"nome":"So tracos","numero":" - "},
        {"nome":3,"numero":"1005"},
        {"nome":"Numero que nao e texto","numero":1006},
        5,
        "texto",
        null,
        [],
        {"nome":"Bruno","numero":"1002"}
    ]})";
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Load());
    CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Ana|1001|x", L"Bruno|1002|"});
    CHECK(store.UpdatedMs() == 42);
}

TEST_CASE("company list: a missing or mistyped time keeps the contacts and reads as no good read") {
    MemoryFileSystem files;
    const std::vector<std::string> times = {
        "",                                   // sem a chave
        R"("atualizada":"agora",)",
        R"("atualizada":1.5,)",
        R"("atualizada":-7,)",
        R"("atualizada":null,)",
        R"("atualizada":18446744073709551615,)",   // nao cabe em 64 bits com sinal
    };
    for (const std::string& time : times) {
        CAPTURE(time);
        files.files[kCompanyPath] = R"({"versao":1,)" + time + R"("contatos":[{"nome":"Ana","numero":"1001"}]})";
        CompanyListStore store(files, kCompanyPath);
        REQUIRE(store.Load());
        CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Ana|1001|"});
        CHECK(store.UpdatedMs() == 0);
    }
}

TEST_CASE("company list: a file with a UTF-8 BOM loads") {
    MemoryFileSystem files;
    files.files[kCompanyPath] =
        "\xEF\xBB\xBF" R"({"versao":1,"atualizada":77,"contatos":[{"nome":"Ana","numero":"1001"}]})";
    CompanyListStore store(files, kCompanyPath);
    CHECK(store.Load());
    CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Ana|1001|"});
    CHECK(store.UpdatedMs() == 77);
}

TEST_CASE("company list: All keeps the order of the sheet, in memory and on disk") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    const std::vector<SheetContact> list = {
        MakeSheetContact(L"Zeca", "3003"),
        MakeSheetContact(L"ana", "1001"),
        MakeSheetContact(L"\u00c1lvaro", "2002"),
        MakeSheetContact(L"Zeca", "3003"),   // uma linha repetida da planilha fica
    };
    REQUIRE(store.Replace(list, 5));
    CHECK(Rows(store.All()) == Rows(list));
    CompanyListStore reloaded(files, kCompanyPath);
    REQUIRE(reloaded.Load());
    CHECK(Rows(reloaded.All()) == Rows(list));
}

TEST_CASE("company list: Replace swaps the whole list") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "1001"), MakeSheetContact(L"Bruno", "1002")}, 1000));
    REQUIRE(store.Replace({MakeSheetContact(L"Caio", "1003")}, 2000));
    CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Caio|1003|"});
    CHECK(store.UpdatedMs() == 2000);
    CHECK(store.NameFor("1001").empty());
    CHECK(store.NameFor("1003") == L"Caio");
    CHECK(nlohmann::json::parse(files.files.at(kCompanyPath))["contatos"].size() == 1);

    // Uma planilha so com o cabecalho e uma lista vazia valida, com a hora da leitura.
    REQUIRE(store.Replace({}, 3000));
    CHECK(store.All().empty());
    CHECK(store.UpdatedMs() == 3000);
    CHECK(store.NameFor("1003").empty());
    const nlohmann::json json = nlohmann::json::parse(files.files.at(kCompanyPath));
    CHECK(json["atualizada"] == 3000);
    CHECK(json["contatos"].is_array());
    CHECK(json["contatos"].empty());
    CompanyListStore reloaded(files, kCompanyPath);
    CHECK(reloaded.Load());
    CHECK(reloaded.All().empty());
    CHECK(reloaded.UpdatedMs() == 3000);
}

TEST_CASE("company list: Replace leaves out the entries without a name or without a number that dials") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "1001"), MakeSheetContact(L"", "1002"),
                           MakeSheetContact(L"   ", "1003"), MakeSheetContact(L"Sem numero", ""),
                           MakeSheetContact(L"So tracos", " - "), MakeSheetContact(L"Bia", "1004")},
                          7));
    CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Ana|1001|", L"Bia|1004|"});
    // O arquivo diz o mesmo que a memoria.
    CHECK(nlohmann::json::parse(files.files.at(kCompanyPath))["contatos"].size() == 2);
    CompanyListStore reloaded(files, kCompanyPath);
    REQUIRE(reloaded.Load());
    CHECK(Rows(reloaded.All()) == Rows(store.All()));
}

TEST_CASE("company list: a negative time is stored as no good read") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "1001")}, -5));
    CHECK(store.UpdatedMs() == 0);
    CHECK(nlohmann::json::parse(files.files.at(kCompanyPath))["atualizada"] == 0);
}

TEST_CASE("company list: a Replace that the disk refuses changes nothing, in memory or on disk") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "2002")}, 1000));
    const std::string before = files.files.at(kCompanyPath);

    files.failWrites = true;
    CHECK_FALSE(store.Replace({MakeSheetContact(L"Bruno", "3003"), MakeSheetContact(L"Caio", "4004")}, 2000));
    CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Ana|2002|"});
    CHECK(store.UpdatedMs() == 1000);
    CHECK(store.NameFor("2002") == L"Ana");
    CHECK(store.NameFor("3003").empty());
    CHECK(files.files.at(kCompanyPath) == before);

    // Quando o disco volta, a proxima leitura boa grava.
    files.failWrites = false;
    REQUIRE(store.Replace({MakeSheetContact(L"Bruno", "3003")}, 3000));
    CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Bruno|3003|"});
    CHECK(store.UpdatedMs() == 3000);
}

TEST_CASE("company list: Clear writes the empty list with time 0") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "2002")}, 1000));
    REQUIRE(store.Clear());
    CHECK(store.All().empty());
    CHECK(store.UpdatedMs() == 0);
    CHECK(store.NameFor("2002").empty());

    const nlohmann::json json = nlohmann::json::parse(files.files.at(kCompanyPath));
    CHECK(Keys(json) == std::vector<std::string>{"atualizada", "contatos", "versao"});
    CHECK(json["versao"] == 1);
    CHECK(json["atualizada"] == 0);
    CHECK(json["contatos"].is_array());
    CHECK(json["contatos"].empty());
    CompanyListStore reloaded(files, kCompanyPath);
    CHECK(reloaded.Load());
    CHECK(reloaded.All().empty());
    CHECK(reloaded.UpdatedMs() == 0);
}

TEST_CASE("company list: Clear writes the file even when there was none") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Clear());
    REQUIRE(files.files.count(kCompanyPath) == 1);
    CHECK(nlohmann::json::parse(files.files.at(kCompanyPath))["contatos"].empty());
}

TEST_CASE("company list: a Clear that the disk refuses changes nothing") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "2002")}, 1000));
    const std::string before = files.files.at(kCompanyPath);

    files.failWrites = true;
    CHECK_FALSE(store.Clear());
    CHECK(Rows(store.All()) == std::vector<std::wstring>{L"Ana|2002|"});
    CHECK(store.UpdatedMs() == 1000);
    CHECK(store.NameFor("2002") == L"Ana");
    CHECK(files.files.at(kCompanyPath) == before);
}

TEST_CASE("company list: the name for a number compares normalized numbers") {
    MemoryFileSystem files;
    CompanyListStore store(files, kCompanyPath);
    REQUIRE(store.Replace({MakeSheetContact(L"Ana", "(11) 5060-3000"), MakeSheetContact(L"Bruno", "+55 11 98888-7777"),
                           MakeSheetContact(L"Outra Ana", "11 5060 3000"), MakeSheetContact(L"Caio", "  2002  ")},
                          1));
    // O "11 5060 3000" acha o contato gravado como "(11) 5060-3000"; entre dois com o mesmo numero, o primeiro.
    CHECK(store.NameFor("11 5060 3000") == L"Ana");
    CHECK(store.NameFor("1150603000") == L"Ana");
    CHECK(store.NameFor("(11)5060.3000") == L"Ana");
    CHECK(store.NameFor("  11 5060-3000 ") == L"Ana");
    CHECK(store.NameFor("+5511988887777") == L"Bruno");
    CHECK(store.NameFor("+55 (11) 98888-7777") == L"Bruno");
    CHECK(store.NameFor("5511988887777").empty());   // o '+' conta, como no ContactsStore
    CHECK(store.NameFor("2002") == L"Caio");
    CHECK(store.NameFor("9999").empty());
    CHECK(store.NameFor("").empty());
    CHECK(store.NameFor(" - ").empty());

    // Depois de ler do disco, igual.
    CompanyListStore reloaded(files, kCompanyPath);
    REQUIRE(reloaded.Load());
    CHECK(reloaded.NameFor("11 5060 3000") == L"Ana");
    CHECK(reloaded.NameFor("+5511988887777") == L"Bruno");
}

TEST_CASE("company list: NameFor matches the way ContactsStore::NameFor does") {
    MemoryFileSystem files;
    ContactsStore contacts(files, "dados/contatos.json");
    CompanyListStore company(files, kCompanyPath);
    std::vector<SheetContact> sheet;
    const std::vector<std::pair<std::wstring, std::string>> people = {
        {L"Ana", "(11) 3333-4444"}, {L"Bruno", "+55 11 98888-7777"}, {L"Caio", "0800 123 456"}, {L"Dina", "1001"},
        {L"Edu", "11.97777.6666"},
    };
    for (const auto& person : people) {
        Contact contact;
        contact.name = person.first;
        contact.number = person.second;
        REQUIRE(contacts.Save(contact));
        sheet.push_back(MakeSheetContact(person.first, person.second));
    }
    REQUIRE(company.Replace(sheet, 1));
    const std::vector<std::string> queries = {"1133334444",    "11 3333.4444", "(11) 3333-4444", "+5511988887777",
                                              "5511988887777", "0800123456",   "0800 123",       "1001",
                                              "10 01",         "9999",         "",               " - ",
                                              "11977776666",   "+11977776666"};
    for (const std::string& query : queries) {
        CAPTURE(query);
        CHECK(company.NameFor(query) == contacts.NameFor(query));
    }
}
