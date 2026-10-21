#pragma once
// Atualizador (spec 7.3): versao.json e instalador dos releases do GitHub, por HTTPS com validacao de certificado
// (Http.h) e SHA-256 conferido (Sha256.h). Win32 puro, sem MFC: serve ao app antigo (pelo adaptador de Hooks.cpp,
// com as caixas de mensagem de sempre) e ao app novo (windows/app, com a pergunta dentro da interface).
//
// Quem mostra (UpdateUi) e quem hospeda (UpdaterOptions) sao do app:
// - Check() baixa o versao.json numa thread propria. O resultado volta pelo options.post, que roda o passo seguinte
//   na thread de quem mostra (o app antigo: a janela principal, pela UM_UPDATE_CHECKER_LOADED). Sem post, o passo
//   roda na hora, na thread do download (o app novo: o Ask espera a resposta da interface sem travar a janela).
// - Achou uma versao mais nova: Ask(versao, notas). Sim: com uma ligacao (Busy), "Termine a chamada para
//   atualizar."; senao baixa o instalador (outra thread), confere o SHA-256, confere de novo a ligacao, roda o
//   instalador com /S e pede para o app fechar (options.quit).
// - Uma verificacao com o aviso aberto ou o download em andamento e ignorada.
#include <windows.h>

#include <functional>
#include <memory>
#include <string>

namespace starsonic {

// Os textos que o atualizador mostra (Show), em UTF-16.
extern const wchar_t kUpdateLatestText[];        // "Voce ja esta na versao mais recente." (so quando a pessoa pediu)
extern const wchar_t kUpdateFinishCallText[];    // "Termine a chamada para atualizar."
extern const wchar_t kUpdateFailedText[];        // "Nao foi possivel baixar a atualizacao. Tentaremos de novo..."
extern const wchar_t kUpdateDownloadingText[];   // "Baixando atualizacao..." (o status)

// Quem mostra o atualizador para a pessoa. Chamado na thread em que os passos rodam (ver acima).
class UpdateUi {
public:
    virtual ~UpdateUi() = default;
    // A pergunta "Atualizar agora?" com a versao (ASCII) e as notas do versao.json. true: atualizar agora.
    virtual bool Ask(const std::string& version, const std::wstring& notes) = 0;
    // Ha uma ligacao em andamento (a atualizacao fica para depois).
    virtual bool Busy() = 0;
    // Um aviso para a pessoa (os textos acima).
    virtual void Show(const std::wstring& text) = 0;
};

// Um passo do atualizador, rodado por quem hospeda. userAsked: a pessoa pediu a verificacao (o menu do app antigo):
// so entao "Voce ja esta na versao mais recente." aparece.
using UpdateStep = std::function<void(bool userAsked)>;

struct UpdaterOptions {
    std::string installedVersion;   // a versao do app (X.Y.Z ou X.Y.Z-rc.N)
    bool testChannel = false;       // o canal de teste (o pre-release canal-teste)
    HWND owner = nullptr;           // a janela dona do instalador (ShellExecute)
    // Roda o passo na thread de quem mostra. false: nao deu (a janela saiu) e o passo e descartado. Vazio: na hora.
    std::function<bool(UpdateStep step)> post;
    std::function<void(int level, const std::string& line)> log;   // ASCII; 1 = erro ... 4 = detalhe
    std::function<void(const std::wstring& text)> status;          // o download comecou (texto) ou acabou ("")
    std::function<void()> quit;                                     // o instalador abriu: o app fecha
};

class Updater {
public:
    Updater(std::shared_ptr<UpdateUi> ui, UpdaterOptions options);
    ~Updater();

    Updater(const Updater&) = delete;
    Updater& operator=(const Updater&) = delete;

    // Comeca uma verificacao (nunca espera a rede). As threads guardam o que precisam: o Updater pode sair antes.
    void Check();

    struct Shared;   // o estado dividido com as threads (Updater.cpp)

private:
    std::shared_ptr<Shared> shared_;
};

// versao.json do canal: o ultimo release que nao e pre-release, ou o pre-release fixo canal-teste.
std::wstring ManifestUrl(bool testChannel);

// Unico prefixo aceito para o instalador indicado no versao.json.
std::string InstallerUrlPrefix();

}  // namespace starsonic
