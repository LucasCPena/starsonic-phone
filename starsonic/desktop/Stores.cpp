#include "Stores.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>

#include "CallMessages.h"
#include "Text.h"
#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

using Json = nlohmann::json;

constexpr int kFormatVersion = 1;

// ---- Leitura e gravacao do arquivo ----

enum class ReadResult { Missing, Ok, Corrupt };

// Le o arquivo e confere o envelope: um objeto com "versao": 1. Missing: o arquivo nao existe (loja vazia, sem erro).
ReadResult ReadRoot(const FileSystem& files, const std::string& path, Json& root) {
    if (!files.Exists(path)) return ReadResult::Missing;
    const std::optional<std::string> bytes = files.Read(path);
    if (!bytes) return ReadResult::Corrupt;
    // Um editor de texto do Windows pode ter posto o BOM do UTF-8 na frente.
    root = Json::parse(StripUtf8Bom(*bytes), nullptr, false);
    if (root.is_discarded() || !root.is_object()) return ReadResult::Corrupt;
    const auto version = root.find("versao");
    if (version == root.end() || !version->is_number_integer() || version->get<int64_t>() != kFormatVersion) {
        return ReadResult::Corrupt;
    }
    return ReadResult::Ok;
}

// O arquivo de uma lista: root[listKey] precisa ser uma lista.
const Json* ListOf(const Json& root, const char* listKey) {
    const auto list = root.find(listKey);
    if (list == root.end() || !list->is_array()) return nullptr;
    return &*list;
}

bool WriteRoot(FileSystem& files, const std::string& path, const Json& root) {
    // replace: um nome que a central mandou com bytes que nao sao UTF-8 nao pode impedir a gravacao.
    return files.WriteAtomic(path, root.dump(2, ' ', false, Json::error_handler_t::replace) + "\n");
}

Json NewRoot() {
    Json root = Json::object();
    root["versao"] = kFormatVersion;
    return root;
}

// ---- Campos ----

std::string GetString(const Json& object, const char* key, const std::string& fallback = std::string()) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_string()) return fallback;
    return found->get<std::string>();
}

bool GetBool(const Json& object, const char* key, bool fallback) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_boolean()) return fallback;
    return found->get<bool>();
}

// Um inteiro de 64 bits do JSON; false se a chave nao existe, nao e inteira ou nao cabe.
bool GetInt64(const Json& object, const char* key, int64_t& out) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_number_integer()) return false;
    if (found->is_number_unsigned()) {
        const uint64_t value = found->get<uint64_t>();
        if (value > static_cast<uint64_t>(INT64_MAX)) return false;
        out = static_cast<int64_t>(value);
        return true;
    }
    out = found->get<int64_t>();
    return true;
}

int GetInt(const Json& object, const char* key, int fallback) {
    int64_t value = 0;
    if (!GetInt64(object, key, value) || value < INT_MIN || value > INT_MAX) return fallback;
    return static_cast<int>(value);
}

// ---- Texto ----

// Letras latinas de U+00C0 a U+017F sem acento e sem caixa; '.' = sem troca (os sinais de multiplicar e dividir).
const char kFoldTable[] =
    "aaaaaaaceeeeiiiidnooooo.ouuuuyts"
    "aaaaaaaceeeeiiiidnooooo.ouuuuyty"
    "aaaaaaccccccccddddeeeeeeeeeegggg"
    "gggghhhhiiiiiiiiiiiijjkkklllllll"
    "lllnnnnnnnnnoooooooorrrrrrssssss"
    "ssttttttuuuuuuuuuuuuwwyyyzzzzzzs";
constexpr wchar_t kFoldFirst = 0xC0;
constexpr wchar_t kFoldLast = 0x17F;

std::string ToUtf8(const std::wstring& text) { return WideToUtf8(text); }

std::wstring NormalizedNumber(const std::string& number) {
    return NormalizeDialString(Trim(Utf8ToWide(number)));
}

}  // namespace

std::wstring FoldForSearch(const std::wstring& text) {
    std::wstring out;
    out.reserve(text.size());
    for (wchar_t ch : text) {
        if (ch >= kFoldFirst && ch <= kFoldLast) {
            const char mapped = kFoldTable[ch - kFoldFirst];
            out.push_back(mapped == '.' ? ch : static_cast<wchar_t>(mapped));
        } else if (ch >= L'A' && ch <= L'Z') {
            out.push_back(static_cast<wchar_t>(ch - L'A' + L'a'));
        } else {
            out.push_back(ch);
        }
    }
    return out;
}

std::string NewStoreId() {
    static std::mutex mutex;
    static std::mt19937_64 engine = [] {
        std::random_device device;
        const uint64_t seed = (static_cast<uint64_t>(device()) << 32) ^ device() ^
                              static_cast<uint64_t>(std::chrono::high_resolution_clock::now().time_since_epoch().count());
        return std::mt19937_64(seed);
    }();
    uint64_t value = 0;
    {
        std::lock_guard<std::mutex> lock(mutex);
        value = engine();
    }
    char buffer[24];
    std::snprintf(buffer, sizeof(buffer), "%016llx", static_cast<unsigned long long>(value));
    return buffer;
}

// ---------------------------------------------------------------- AccountsStore

AccountsStore::AccountsStore(FileSystem& files, SecretCipher& cipher, std::string path)
    : files_(files), cipher_(cipher), path_(std::move(path)) {}

bool AccountsStore::Load() {
    std::lock_guard<std::mutex> lock(mutex_);
    entries_.clear();
    activeId_.clear();
    pending_.clear();
    Json root;
    const ReadResult result = ReadRoot(files_, path_, root);
    if (result == ReadResult::Missing) return true;
    const Json* list = result == ReadResult::Ok ? ListOf(root, "contas") : nullptr;
    if (!list) return false;
    for (const Json& item : *list) {
        if (!item.is_object()) continue;
        Entry entry;
        entry.account.id = GetString(item, "id");
        if (entry.account.id.empty()) continue;
        const bool duplicate = std::any_of(entries_.begin(), entries_.end(), [&](const Entry& other) {
            return other.account.id == entry.account.id;
        });
        if (duplicate) continue;
        if (item.find("servidor") == item.end() || item.find("ramal") == item.end()) continue;
        entry.account.address = Utf8ToWide(GetString(item, "servidor"));
        entry.account.transport = GetString(item, "protocolo") == "tcp" ? Transport::Tcp : Transport::Udp;
        entry.account.ramal = Utf8ToWide(GetString(item, "ramal"));
        entry.account.name = Utf8ToWide(GetString(item, "nome"));
        entry.sealed = GetString(item, "senha_protegida");
        const std::optional<std::string> password =
            entry.sealed.empty() ? std::nullopt : cipher_.Unprotect(entry.sealed);
        if (password) {
            entry.account.senha = Utf8ToWide(*password);
        }
        entry.account.needsPassword = entry.account.senha.empty();
        if (activeId_.empty() && GetBool(item, "em_uso", false)) activeId_ = entry.account.id;
        entries_.push_back(std::move(entry));
    }
    const auto pending = root.find("migracao_pendente");
    if (pending != root.end() && pending->is_array()) {
        for (const Json& item : *pending) {
            if (item.is_string() && std::find(pending_.begin(), pending_.end(), item.get<std::string>()) == pending_.end()) {
                pending_.push_back(item.get<std::string>());
            }
        }
    }
    return true;
}

std::vector<SavedAccount> AccountsStore::All() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<SavedAccount> accounts;
    for (const Entry& entry : entries_) accounts.push_back(entry.account);
    return accounts;
}

std::optional<SavedAccount> AccountsStore::Active() const {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const Entry& entry : entries_) {
        if (entry.account.id == activeId_) return entry.account;
    }
    return std::nullopt;
}

std::string AccountsStore::LastSavedId() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return lastSavedId_;
}

bool AccountsStore::Write(const std::vector<Entry>& entries, const std::string& active,
                          const std::vector<std::string>& pending) const {
    Json root = NewRoot();
    Json list = Json::array();
    for (const Entry& entry : entries) {
        const SavedAccount& account = entry.account;
        Json item = Json::object();
        item["id"] = account.id;
        item["servidor"] = ToUtf8(account.address);
        item["protocolo"] = account.transport == Transport::Tcp ? "tcp" : "udp";
        item["ramal"] = ToUtf8(account.ramal);
        item["senha_protegida"] = entry.sealed;   // a senha nunca vai em claro
        item["nome"] = ToUtf8(account.name);
        item["em_uso"] = !active.empty() && account.id == active;
        list.push_back(std::move(item));
    }
    root["contas"] = std::move(list);
    if (!pending.empty()) root["migracao_pendente"] = pending;
    return WriteRoot(files_, path_, root);
}

bool AccountsStore::Save(SavedAccount account) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (account.id.empty()) account.id = NewStoreId();
    Entry entry;
    if (!account.senha.empty()) {
        const std::optional<std::string> sealed = cipher_.Protect(ToUtf8(account.senha));
        if (!sealed || sealed->empty()) return false;
        entry.sealed = *sealed;
    }
    account.needsPassword = account.senha.empty();
    entry.account = account;

    std::vector<Entry> updated = entries_;
    const auto existing = std::find_if(updated.begin(), updated.end(), [&](const Entry& other) {
        return other.account.id == account.id;
    });
    if (existing != updated.end()) {
        *existing = entry;
    } else {
        updated.push_back(entry);
    }
    if (!Write(updated, activeId_, pending_)) return false;
    entries_ = std::move(updated);
    lastSavedId_ = account.id;
    return true;
}

bool AccountsStore::Remove(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Entry> updated = entries_;
    const auto existing = std::find_if(updated.begin(), updated.end(), [&](const Entry& other) {
        return other.account.id == id;
    });
    if (existing == updated.end()) return false;
    updated.erase(existing);
    const std::string active = activeId_ == id ? std::string() : activeId_;
    if (!Write(updated, active, pending_)) return false;
    entries_ = std::move(updated);
    activeId_ = active;
    return true;
}

bool AccountsStore::SetActive(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    const bool exists = std::any_of(entries_.begin(), entries_.end(), [&](const Entry& other) {
        return other.account.id == id;
    });
    if (!exists) return false;
    if (!Write(entries_, id, pending_)) return false;
    activeId_ = id;
    return true;
}

std::vector<std::string> AccountsStore::PendingMigration() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return pending_;
}

bool AccountsStore::SetPendingMigration(std::vector<std::string> pending) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!Write(entries_, activeId_, pending)) return false;
    pending_ = std::move(pending);
    return true;
}

// ---------------------------------------------------------------- ContactsStore

ContactsStore::ContactsStore(FileSystem& files, std::string path) : files_(files), path_(std::move(path)) {}

bool ContactsStore::Load() {
    std::lock_guard<std::mutex> lock(mutex_);
    contacts_.clear();
    Json root;
    const ReadResult result = ReadRoot(files_, path_, root);
    if (result == ReadResult::Missing) return true;
    const Json* list = result == ReadResult::Ok ? ListOf(root, "contatos") : nullptr;
    if (!list) return false;
    for (const Json& item : *list) {
        if (!item.is_object()) continue;
        Contact contact;
        contact.id = GetString(item, "id");
        contact.name = Utf8ToWide(GetString(item, "nome"));
        contact.number = GetString(item, "numero");
        contact.note = Utf8ToWide(GetString(item, "observacao"));
        if (contact.id.empty() || contact.name.empty() || contact.number.empty()) continue;
        const bool duplicate = std::any_of(contacts_.begin(), contacts_.end(), [&](const Contact& other) {
            return other.id == contact.id;
        });
        if (!duplicate) contacts_.push_back(std::move(contact));
    }
    return true;
}

namespace {

// Os contatos na ordem de All(): nome sem acento e sem caixa; empate pelo nome como foi escrito e pelo id.
std::vector<Contact> SortedContacts(const std::vector<Contact>& contacts) {
    struct Keyed {
        std::wstring key;
        const Contact* contact;
    };
    std::vector<Keyed> keyed;
    keyed.reserve(contacts.size());
    for (const Contact& contact : contacts) keyed.push_back({FoldForSearch(contact.name), &contact});
    std::sort(keyed.begin(), keyed.end(), [](const Keyed& a, const Keyed& b) {
        if (a.key != b.key) return a.key < b.key;
        if (a.contact->name != b.contact->name) return a.contact->name < b.contact->name;
        return a.contact->id < b.contact->id;
    });
    std::vector<Contact> sorted;
    sorted.reserve(contacts.size());
    for (const Keyed& item : keyed) sorted.push_back(*item.contact);
    return sorted;
}

}  // namespace

std::vector<Contact> ContactsStore::All() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return SortedContacts(contacts_);
}

bool ContactsStore::Write(const std::vector<Contact>& contacts) const {
    Json root = NewRoot();
    Json list = Json::array();
    for (const Contact& contact : contacts) {
        Json item = Json::object();
        item["id"] = contact.id;
        item["nome"] = ToUtf8(contact.name);
        item["numero"] = contact.number;
        item["observacao"] = ToUtf8(contact.note);
        list.push_back(std::move(item));
    }
    root["contatos"] = std::move(list);
    return WriteRoot(files_, path_, root);
}

bool ContactsStore::Save(Contact contact) {
    contact.name = Trim(contact.name);
    contact.number = ToUtf8(Trim(Utf8ToWide(contact.number)));
    if (contact.name.empty() || NormalizedNumber(contact.number).empty()) return false;
    std::lock_guard<std::mutex> lock(mutex_);
    if (contact.id.empty()) contact.id = NewStoreId();
    std::vector<Contact> updated = contacts_;
    const auto existing = std::find_if(updated.begin(), updated.end(), [&](const Contact& other) {
        return other.id == contact.id;
    });
    if (existing != updated.end()) {
        *existing = contact;
    } else {
        updated.push_back(contact);
    }
    if (!Write(updated)) return false;
    contacts_ = std::move(updated);
    return true;
}

bool ContactsStore::AddAll(std::vector<Contact> contacts) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Contact> updated = contacts_;
    for (Contact& contact : contacts) {
        contact.name = Trim(contact.name);
        contact.number = ToUtf8(Trim(Utf8ToWide(contact.number)));
        if (contact.name.empty() || NormalizedNumber(contact.number).empty()) continue;
        contact.id = NewStoreId();
        updated.push_back(std::move(contact));
    }
    if (!Write(updated)) return false;
    contacts_ = std::move(updated);
    return true;
}

bool ContactsStore::Remove(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Contact> updated = contacts_;
    const auto existing = std::find_if(updated.begin(), updated.end(), [&](const Contact& other) {
        return other.id == id;
    });
    if (existing == updated.end()) return false;
    updated.erase(existing);
    if (!Write(updated)) return false;
    contacts_ = std::move(updated);
    return true;
}

std::vector<Contact> ContactsStore::Search(const std::wstring& text) const {
    const std::wstring trimmed = Trim(text);
    const std::wstring nameQuery = FoldForSearch(trimmed);
    const std::wstring numberQuery = NormalizeDialString(trimmed);
    std::vector<Contact> sorted = All();
    if (nameQuery.empty()) return sorted;
    std::vector<Contact> found;
    for (Contact& contact : sorted) {
        const bool byName = FoldForSearch(contact.name).find(nameQuery) != std::wstring::npos;
        const bool byNumber =
            !numberQuery.empty() && NormalizedNumber(contact.number).find(numberQuery) != std::wstring::npos;
        if (byName || byNumber) found.push_back(std::move(contact));
    }
    return found;
}

std::wstring ContactsStore::NameFor(const std::string& number) const {
    const std::wstring wanted = NormalizedNumber(number);
    if (wanted.empty()) return std::wstring();
    for (const Contact& contact : All()) {
        if (NormalizedNumber(contact.number) == wanted) return contact.name;
    }
    return std::wstring();
}

// ---------------------------------------------------------------- CompanyListStore

namespace {

// Deixa na lista so as entradas com nome e com numero que vale (depois do NormalizeDialString), na mesma ordem, e devolve
// o indice dos numeros: o numero normalizado de cada uma -> o lugar da primeira com ele. A leitura da planilha ja so
// entrega entradas assim; conferir de novo aqui faz a memoria e o arquivo dizerem sempre o mesmo.
std::unordered_map<std::wstring, size_t> KeepEntries(std::vector<SheetContact>& contacts) {
    std::vector<SheetContact> kept;
    kept.reserve(contacts.size());
    std::unordered_map<std::wstring, size_t> byNumber;
    byNumber.reserve(contacts.size());
    for (SheetContact& contact : contacts) {
        std::wstring number = NormalizedNumber(contact.number);
        if (number.empty() || Trim(contact.name).empty()) continue;
        byNumber.emplace(std::move(number), kept.size());   // o emplace nao troca: o primeiro de cada numero fica
        kept.push_back(std::move(contact));
    }
    contacts = std::move(kept);
    return byNumber;
}

}  // namespace

CompanyListStore::CompanyListStore(FileSystem& files, std::string path) : files_(files), path_(std::move(path)) {}

bool CompanyListStore::Load() {
    std::lock_guard<std::mutex> lock(mutex_);
    contacts_.clear();
    byNumber_.clear();
    updatedMs_ = 0;
    Json root;
    const ReadResult result = ReadRoot(files_, path_, root);
    if (result == ReadResult::Missing) return true;
    const Json* list = result == ReadResult::Ok ? ListOf(root, "contatos") : nullptr;
    if (!list) return false;
    std::vector<SheetContact> contacts;
    for (const Json& item : *list) {
        if (!item.is_object()) continue;
        SheetContact contact;
        contact.name = Utf8ToWide(GetString(item, "nome"));
        contact.number = GetString(item, "numero");
        contact.note = Utf8ToWide(GetString(item, "observacao"));
        contacts.push_back(std::move(contact));
    }
    byNumber_ = KeepEntries(contacts);
    contacts_ = std::move(contacts);
    int64_t updatedMs = 0;   // sem a hora (ou com uma que nao presta), a lista vale e a hora e 0
    if (GetInt64(root, "atualizada", updatedMs) && updatedMs > 0) updatedMs_ = updatedMs;
    return true;
}

std::vector<SheetContact> CompanyListStore::All() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return contacts_;
}

int64_t CompanyListStore::UpdatedMs() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return updatedMs_;
}

bool CompanyListStore::Write(const std::vector<SheetContact>& contacts, int64_t updatedMs) const {
    Json root = NewRoot();
    root["atualizada"] = updatedMs;
    Json list = Json::array();
    for (const SheetContact& contact : contacts) {
        Json item = Json::object();
        item["nome"] = ToUtf8(contact.name);
        item["numero"] = contact.number;
        item["observacao"] = ToUtf8(contact.note);
        list.push_back(std::move(item));
    }
    root["contatos"] = std::move(list);
    return WriteRoot(files_, path_, root);
}

bool CompanyListStore::Replace(std::vector<SheetContact> contacts, int64_t updatedMs) {
    if (updatedMs < 0) updatedMs = 0;
    // A conta dos numeros fica fora da trava: o NameFor roda na thread do motor e nao deve esperar por ela.
    std::unordered_map<std::wstring, size_t> byNumber = KeepEntries(contacts);
    std::lock_guard<std::mutex> lock(mutex_);
    if (!Write(contacts, updatedMs)) return false;
    contacts_ = std::move(contacts);
    byNumber_ = std::move(byNumber);
    updatedMs_ = updatedMs;
    return true;
}

bool CompanyListStore::Clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!Write(std::vector<SheetContact>(), 0)) return false;
    contacts_.clear();
    byNumber_.clear();
    updatedMs_ = 0;
    return true;
}

std::wstring CompanyListStore::NameFor(const std::string& number) const {
    const std::wstring wanted = NormalizedNumber(number);
    if (wanted.empty()) return std::wstring();
    std::lock_guard<std::mutex> lock(mutex_);
    const auto found = byNumber_.find(wanted);
    return found == byNumber_.end() ? std::wstring() : contacts_[found->second].name;
}

// ---------------------------------------------------------------- RecentsStore

RecentsStore::RecentsStore(FileSystem& files, std::string path) : files_(files), path_(std::move(path)) {}

namespace {

const char* KindToText(Recent::Kind kind) {
    switch (kind) {
        case Recent::Outgoing: return "feita";
        case Recent::Incoming: return "recebida";
        case Recent::Missed: return "perdida";
    }
    return "feita";
}

bool KindFromText(const std::string& text, Recent::Kind& kind) {
    if (text == "feita") kind = Recent::Outgoing;
    else if (text == "recebida") kind = Recent::Incoming;
    else if (text == "perdida") kind = Recent::Missed;
    else return false;
    return true;
}

}  // namespace

bool RecentsStore::Load() {
    std::lock_guard<std::mutex> lock(mutex_);
    recents_.clear();
    Json root;
    const ReadResult result = ReadRoot(files_, path_, root);
    if (result == ReadResult::Missing) return true;
    const Json* list = result == ReadResult::Ok ? ListOf(root, "recentes") : nullptr;
    if (!list) return false;
    for (const Json& item : *list) {
        if (!item.is_object()) continue;
        Recent recent;
        recent.number = GetString(item, "numero");
        recent.name = GetString(item, "nome");
        int64_t duration = 0;
        if (!KindFromText(GetString(item, "tipo"), recent.kind) || !GetInt64(item, "inicio", recent.startMs)) continue;
        if (GetInt64(item, "duracao", duration)) recent.durationMs = duration < 0 ? 0 : duration;
        recents_.push_back(std::move(recent));
    }
    std::stable_sort(recents_.begin(), recents_.end(),
                     [](const Recent& a, const Recent& b) { return a.startMs > b.startMs; });
    if (recents_.size() > kMax) recents_.resize(kMax);
    return true;
}

bool RecentsStore::Write() const {
    Json root = NewRoot();
    Json list = Json::array();
    for (const Recent& recent : recents_) {
        Json item = Json::object();
        item["numero"] = recent.number;
        item["nome"] = recent.name;
        item["tipo"] = KindToText(recent.kind);
        item["inicio"] = recent.startMs;
        item["duracao"] = recent.durationMs;   // em milissegundos
        list.push_back(std::move(item));
    }
    root["recentes"] = std::move(list);
    return WriteRoot(files_, path_, root);
}

bool RecentsStore::Add(const Recent& recent) {
    std::lock_guard<std::mutex> lock(mutex_);
    // Depois das que comecaram junto ou depois: a lista fica do inicio mais novo ao mais antigo.
    const auto position = std::find_if(recents_.begin(), recents_.end(),
                                       [&](const Recent& other) { return other.startMs < recent.startMs; });
    recents_.insert(position, recent);
    if (recents_.size() > kMax) recents_.resize(kMax);
    return Write();
}

bool RecentsStore::AddAll(const std::vector<Recent>& recents) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Recent> previous = recents_;
    for (const Recent& recent : recents) {
        const auto position = std::find_if(recents_.begin(), recents_.end(),
                                           [&](const Recent& other) { return other.startMs < recent.startMs; });
        recents_.insert(position, recent);
    }
    if (recents_.size() > kMax) recents_.resize(kMax);
    if (Write()) return true;
    recents_ = std::move(previous);
    return false;
}

std::vector<Recent> RecentsStore::All() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return recents_;
}

int RecentsStore::MissedCount(int64_t sinceMs) const {
    std::lock_guard<std::mutex> lock(mutex_);
    int count = 0;
    for (const Recent& recent : recents_) {
        if (recent.kind == Recent::Missed && recent.startMs > sinceMs) ++count;
    }
    return count;
}

// ---------------------------------------------------------------- SettingsStore

SettingsStore::SettingsStore(FileSystem& files, std::string path) : files_(files), path_(std::move(path)) {}

namespace {

void Clamp(Settings& settings) {
    settings.autoAnswerSeconds = std::max(0, std::min(SettingsStore::kMaxAutoAnswerSeconds, settings.autoAnswerSeconds));
    // Um tamanho de janela que nao e positivo: sem tamanho guardado (o executavel abre no padrao).
    if (settings.windowW <= 0 || settings.windowH <= 0) {
        settings.windowW = 0;
        settings.windowH = 0;
    }
}

}  // namespace

bool SettingsStore::Load() {
    std::lock_guard<std::mutex> lock(mutex_);
    settings_ = Settings();
    Json root;
    const ReadResult result = ReadRoot(files_, path_, root);
    if (result == ReadResult::Missing) return true;
    if (result == ReadResult::Corrupt) return false;
    const Settings defaults;
    settings_.captureDevice = GetInt(root, "microfone", defaults.captureDevice);
    settings_.playbackDevice = GetInt(root, "alto_falante", defaults.playbackDevice);
    settings_.ringDeviceId = GetString(root, "toque");
    settings_.doNotDisturb = GetBool(root, "nao_perturbe", defaults.doNotDisturb);
    settings_.autoAnswer = GetBool(root, "atender_automatico", defaults.autoAnswer);
    settings_.autoAnswerSeconds = GetInt(root, "atender_segundos", defaults.autoAnswerSeconds);
    settings_.startWithWindows = GetBool(root, "iniciar_com_windows", defaults.startWithWindows);
    settings_.windowX = GetInt(root, "janela_x", defaults.windowX);
    settings_.windowY = GetInt(root, "janela_y", defaults.windowY);
    settings_.windowW = GetInt(root, "janela_largura", defaults.windowW);
    settings_.windowH = GetInt(root, "janela_altura", defaults.windowH);
    settings_.captureName = GetString(root, "microfone_nome");
    settings_.playbackName = GetString(root, "alto_falante_nome");
    settings_.bipeFim = GetBool(root, "bipe_fim", defaults.bipeFim);
    settings_.companyListLink = GetString(root, "planilha_empresa");   // um config.json de antes da rc.4: nenhuma
    settings_.bipeTecla = GetBool(root, "bipe_tecla", defaults.bipeTecla);   // um de antes do iPhone: ligado
    Clamp(settings_);
    return true;
}

Settings SettingsStore::Get() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return settings_;
}

bool SettingsStore::Save(Settings settings) {
    std::lock_guard<std::mutex> lock(mutex_);
    Clamp(settings);
    Json root = NewRoot();
    root["microfone"] = settings.captureDevice;
    root["alto_falante"] = settings.playbackDevice;
    root["toque"] = settings.ringDeviceId;
    root["nao_perturbe"] = settings.doNotDisturb;
    root["atender_automatico"] = settings.autoAnswer;
    root["atender_segundos"] = settings.autoAnswerSeconds;
    root["iniciar_com_windows"] = settings.startWithWindows;
    if (settings.windowX != INT_MIN) root["janela_x"] = settings.windowX;
    if (settings.windowY != INT_MIN) root["janela_y"] = settings.windowY;
    if (settings.windowW > 0 && settings.windowH > 0) {
        root["janela_largura"] = settings.windowW;
        root["janela_altura"] = settings.windowH;
    }
    root["microfone_nome"] = settings.captureName;
    root["alto_falante_nome"] = settings.playbackName;
    root["bipe_fim"] = settings.bipeFim;
    root["planilha_empresa"] = settings.companyListLink;
    root["bipe_tecla"] = settings.bipeTecla;
    if (!WriteRoot(files_, path_, root)) return false;
    settings_ = settings;
    return true;
}

}  // namespace starsonic
