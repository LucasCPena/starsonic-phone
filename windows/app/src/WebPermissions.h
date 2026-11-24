#pragma once
// As permissoes do WebView2 (spec da W1, 6.4): so a origem do app (https://app.starsonic.local/) e so duas:
// - o microfone (os rotulos do enumerateDevices, que o Configuracoes compara com os nomes do motor; a interface nunca
//   captura som: o motor captura);
// - a reproducao automatica (o toque, que toca antes de qualquer clique, Task 10): se o runtime pedir a permissao em
//   vez de seguir o --autoplay-policy, negar deixaria o toque mudo.
// Todo o resto e negado.
//
// O quadro da reuniao (spec 7.7): a pagina de uma reuniao do chat abre num iframe da janela principal. Quem decide o que
// o quadro ganha e o endereco do DOCUMENTO do quadro, nunca a origem que o WebView2 diz no pedido (com um iframe ela
// nao e garantida): so o quadro de uma reuniao, na janela principal, ganha a camera, o microfone e a reproducao
// automatica, e so ele captura a tela. A pagina do app nunca ganha a camera.
//
// C++ portatil: so o texto da URL.
#include <cstdint>
#include <map>
#include <string>

namespace starsonic {

extern const char kAppOrigin[];   // "https://app.starsonic.local"

enum class WebPermission { Microphone, Camera, Autoplay, Other };
// Qual WebView2 pergunta: o da janela principal ou o do aviso de ligacao.
enum class WebWindow { Main, Notice };

// A URL e do app: a origem exata seguida de "/" (nunca https://app.starsonic.local.outro.com).
bool IsAppUrl(const std::string& url);

bool AllowWebPermission(WebPermission kind, const std::string& url);

// O endereco de uma reuniao: exatamente kChatOrigin (ChatFiles.h) + "/r/" + 10 caracteres do alfabeto dos codigos.
bool IsMeetingUrl(const std::string& url);
// Um quadro so navega dentro do app ou, na janela principal, para uma reuniao.
bool AllowFrameNavigation(WebWindow window, const std::string& url);
// O que um quadro pede: so o quadro de uma reuniao, na janela principal, e so a camera, o microfone e a reproducao
// automatica. frameUrl e o endereco do documento do quadro ("" quando nao se sabe).
bool AllowFramePermission(WebWindow window, WebPermission kind, const std::string& frameUrl);
// A captura de tela: so o quadro de uma reuniao, na janela principal.
bool AllowFrameScreenCapture(WebWindow window, const std::string& frameUrl);

// O endereco do documento que um quadro mostra, pelas navegacoes dele (os ids de navegacao do WebView2). E ele, e nao o
// de uma navegacao que so comecou, que decide o que o quadro ganha: uma navegacao cancelada que nao para (o WebView2
// 131) ou que nunca carrega nao muda o documento, e um quadro que sai da reuniao deixa de ser um quadro de reuniao.
class FrameAddress {
public:
    // NavigationStarting: guarda o endereco dessa navegacao (um redirecionamento repete o id, com o endereco novo).
    void Start(uint64_t navigation, const std::string& url);
    // ContentLoading: o quadro passou a mostrar o documento dessa navegacao ("" numa pagina de erro ou num id que nao
    // comecou aqui).
    void Commit(uint64_t navigation, bool errorPage);
    // NavigationCompleted: a navegacao acabou e o id e esquecido. Uma que deu certo sem o ContentLoading tambem vale,
    // a nao ser que seja dentro do mesmo documento (o mesmo endereco, fora o fragmento).
    void End(uint64_t navigation, bool success);
    // "" antes do primeiro documento, numa pagina de erro e num documento desconhecido.
    const std::string& Shown() const;

private:
    struct Navigation {
        std::string url;
        bool committed = false;
    };
    std::map<uint64_t, Navigation> navigations_;
    std::string shown_;
};

}  // namespace starsonic
