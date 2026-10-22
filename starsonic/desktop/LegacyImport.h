#pragma once
// A migracao da rc.7 (spec 7.1): o app de antes era o MicroSIP 3.22 com a marca Starsonic. C++ portatil; so a senha
// precisa do Windows (LegacyDecrypt, em starsonic/win/LegacyCrypto.h), e chega aqui como uma funcao.
//
// Onde a rc.7 guardava os dados (todos na pasta das configuracoes do MicroSIP: %APPDATA%\Starsonic Phone\ quando
// instalada, a pasta do executavel quando portatil):
// - StarsonicPhone.ini (UTF-16LE com BOM, lido como o GetPrivateProfileString le): [Account1]..[AccountN] com server
//   (<endereco>:<porta>), transport, username (o ramal), password (cifrada pelo IniEncrypt) e label; [Settings]
//   accountId (a conta em uso).
// - Contacts.xml (UTF-8): <contacts><contact name=".." number=".." comment=".." .../></contacts>. O MicroSIP 3.22 abre
//   tambem um contacts.db, mas nao cria tabela nenhuma nele (o ContactsRepository nao e usado para gravar): a agenda
//   e o Contacts.xml.
// - call_log.db (SQLite): call_log(id, callId, number, name, type, time, duration, info); type 0 feita, 1 recebida,
//   2 perdida, 3 atendida em outro aparelho; time em segundos desde 1970; duration em segundos.
#include <functional>
#include <optional>
#include <string>

#include "Files.h"
#include "Stores.h"

namespace starsonic {

// Os caminhos (UTF-8) dos arquivos da rc.7.
struct LegacyPaths {
    std::string ini;           // StarsonicPhone.ini
    std::string contactsXml;   // Contacts.xml
    std::string callsDb;       // call_log.db
};

struct LegacyImportResult {
    int accounts = 0;                  // contas migradas nesta chamada
    int accountsWithoutPassword = 0;   // dessas, as que entraram sem a senha (vazia ou que nao decifrou)
    bool contactsDone = false;         // os contatos foram lidos nesta chamada (ou nao havia o arquivo)
    bool callsDone = false;            // o historico foi lido nesta chamada (ou nao havia o arquivo)
};

// Decifra o password do .ini (o IniDecrypt do MicroSIP); nullopt se nao decifra.
using LegacyDecryptFunction = std::function<std::optional<std::wstring>(const std::wstring& encrypted)>;

// Migra o que a rc.7 deixou. As lojas ja devem estar carregadas (Load).
// - Com o .ini e sem nenhuma conta na loja: as contas viram contas (o endereco do server sem a porta, o protocolo,
//   o ramal, o nome do label quando nao e o rotulo automatico, a senha decifrada) e a do accountId fica em uso (se ela
//   nao migrou, a primeira que migrou); os contatos e o historico sao lidos. Com contas na loja, o .ini nao e lido (a migracao ja aconteceu).
// - Sem o .ini: so tenta de novo o que ficou pendente (contas.json, "migracao_pendente").
// Os bancos sao abertos somente para leitura. Cada arquivo lido com sucesso e renomeado para <nome>.migrado (voltar
// para a rc.7 e renomear de volta); o que nao deu para ler (travado, ilegivel) fica com o nome e vai para a
// "migracao_pendente", para a proxima abertura. Contatos e ligacoes que ja estao nas lojas nao entram de novo.
LegacyImportResult ImportLegacy(const LegacyPaths& paths, LegacyDecryptFunction decrypt, AccountsStore& accounts,
                                ContactsStore& contacts, RecentsStore& recents, FileSystem& files);

}  // namespace starsonic
