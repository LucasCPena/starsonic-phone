#pragma once
// As lojas do app de PC (spec 6.6): contas, contatos, recentes e configuracoes, cada uma num arquivo JSON UTF-8
// gravado de forma atomica (FileSystem::WriteAtomic). C++ portatil: nada de Windows aqui.
//
// Formato (todos): um objeto {"versao": 1, "<lista>": [...]} (as configuracoes: o objeto com as chaves). Chaves em
// portugues, como no disco do Android.
// - contas.json:   {"versao":1,"contas":[{"id","servidor","protocolo":"udp"|"tcp","ramal","senha_protegida","nome","em_uso"}]}
//                  e, enquanto falta algo da migracao da rc.7, "migracao_pendente": ["contatos","recentes"]
// - contatos.json: {"versao":1,"contatos":[{"id","nome","numero","observacao"}]}
// - recentes.json: {"versao":1,"recentes":[{"numero","nome","tipo":"feita"|"recebida"|"perdida","inicio","duracao"}]}
//   (inicio: ms desde 1970; duracao: em MILISSEGUNDOS, ao contrario do Android, que grava segundos)
// - config.json:   {"versao":1,"microfone":-1,"alto_falante":-1,"toque":"","nao_perturbe":false,...}
//
// Carregar (Load): arquivo que nao existe vale como lista vazia (true); arquivo ilegivel, que nao e JSON, de outra
// versao ou do formato errado vale como vazio e Load devolve false; o arquivo nao e tocado ate o proximo Save.
// Uma entrada da lista que nao da para ler fica de fora.
//
// Cada loja tem uma trava propria: pode ser chamada de qualquer thread (os Recentes e os nomes dos contatos sao
// chamados pelo controlador de ligacoes, na thread do motor). As funcoes de leitura devolvem copias.
#include <climits>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "CallController.h"   // Recent
#include "Cipher.h"
#include "Files.h"
#include "Profile.h"          // Transport

namespace starsonic {

// Um identificador novo para uma conta ou um contato (16 digitos hexadecimais, aleatorio).
std::string NewStoreId();

// O texto como a busca e a ordem o veem: sem caixa e sem acento (letras latinas, de U+00C0 a U+017F).
std::wstring FoldForSearch(const std::wstring& text);

struct SavedAccount {
    std::string id;           // estavel, gerado na criacao (NewStoreId); vazio no Save = a loja gera
    std::wstring address;
    Transport transport = Transport::Udp;
    std::wstring ramal;
    std::wstring senha;       // so na memoria; no disco, so cifrada
    std::wstring name;
    bool needsPassword = false;   // so na leitura: a senha gravada nao decifrou (ou nao havia): digitar de novo
};

class AccountsStore {
public:
    AccountsStore(FileSystem& files, SecretCipher& cipher, std::string path);

    bool Load();
    std::vector<SavedAccount> All() const;               // na ordem em que foram incluidas
    std::optional<SavedAccount> Active() const;
    // Inclui, ou substitui a de mesmo id. Nao muda qual esta em uso (SetActive). Com a senha vazia, a conta e gravada
    // sem senha (needsPassword). false se a senha nao cifrou ou o disco falhou: nada muda.
    bool Save(SavedAccount account);
    std::string LastSavedId() const;                     // o id da ultima conta gravada com sucesso
    bool Remove(const std::string& id);                  // false se nao existe ou o disco falhou
    bool SetActive(const std::string& id);               // false se nao existe ou o disco falhou
    // O que ainda falta migrar da rc.7 ("contatos", "recentes"; LegacyImport). Vazio: nada.
    std::vector<std::string> PendingMigration() const;
    bool SetPendingMigration(std::vector<std::string> pending);   // false se o disco falhou: nada muda

private:
    struct Entry {
        SavedAccount account;
        std::string sealed;   // senha_protegida como esta no disco (guardada para as outras contas nao a perderem)
    };
    bool Write(const std::vector<Entry>& entries, const std::string& active,
               const std::vector<std::string>& pending) const;

    FileSystem& files_;
    SecretCipher& cipher_;
    std::string path_;
    mutable std::mutex mutex_;
    std::vector<Entry> entries_;
    std::string activeId_;
    std::string lastSavedId_;
    std::vector<std::string> pending_;
};

struct Contact {
    std::string id;
    std::wstring name;
    std::string number;
    std::wstring note;
};

class ContactsStore {
public:
    ContactsStore(FileSystem& files, std::string path);

    bool Load();
    std::vector<Contact> All() const;                          // por nome, sem acento e sem caixa
    // Inclui ou substitui (pelo id; vazio = id novo). Exige nome e numero (depois do Trim e do NormalizeDialString).
    bool Save(Contact contact);
    // Inclui varios de uma vez, cada um com um id novo, numa gravacao so; os que o Save recusaria ficam de fora.
    // false se o disco falhou: nada muda.
    bool AddAll(std::vector<Contact> contacts);
    bool Remove(const std::string& id);
    // Os contatos cujo nome (sem acento e sem caixa) ou numero contem o texto; na ordem de All. Texto vazio: todos.
    std::vector<Contact> Search(const std::wstring& text) const;
    // O nome do contato com esse numero (comparados com NormalizeDialString); vazio se nao ha.
    std::wstring NameFor(const std::string& number) const;

private:
    bool Write(const std::vector<Contact>& contacts) const;

    FileSystem& files_;
    std::string path_;
    mutable std::mutex mutex_;
    std::vector<Contact> contacts_;
};

class RecentsStore {
public:
    static constexpr size_t kMax = 500;

    RecentsStore(FileSystem& files, std::string path);

    bool Load();
    // Anota a ligacao; ficam as 500 de inicio mais novo. A lista na memoria muda mesmo que o disco falhe (false).
    bool Add(const Recent& recent);
    // Anota varias de uma vez, numa gravacao so (ficam as 500 mais novas). Ao contrario do Add, se o disco falha a
    // lista na memoria tambem nao muda (false).
    bool AddAll(const std::vector<Recent>& recents);
    std::vector<Recent> All() const;                 // a mais nova primeiro
    // Quantas perdidas comecaram depois de sinceMs (a ultima vez que a tela Recentes foi vista).
    int MissedCount(int64_t sinceMs) const;

private:
    bool Write() const;   // com a trava

    FileSystem& files_;
    std::string path_;
    mutable std::mutex mutex_;
    std::vector<Recent> recents_;
};

struct Settings {
    int captureDevice = -1;
    int playbackDevice = -1;
    std::string ringDeviceId;
    bool doNotDisturb = false;
    bool autoAnswer = false;
    int autoAnswerSeconds = 3;
    bool startWithWindows = true;
    int windowX = INT_MIN;     // INT_MIN: sem posicao guardada
    int windowY = INT_MIN;
    std::string captureName;
    std::string playbackName;
};

class SettingsStore {
public:
    SettingsStore(FileSystem& files, std::string path);

    bool Load();                          // sem arquivo ou ilegivel: os padroes
    Settings Get() const;
    bool Save(Settings settings);         // autoAnswerSeconds fica entre 0 e 30
    static constexpr int kMaxAutoAnswerSeconds = 30;

private:
    FileSystem& files_;
    std::string path_;
    mutable std::mutex mutex_;
    Settings settings_;
};

}  // namespace starsonic
