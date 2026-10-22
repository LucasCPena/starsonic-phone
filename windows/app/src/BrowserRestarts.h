#pragma once
// Quando o navegador do WebView2 sai (morto ou caido), a MainWindow refaz o ambiente, a janela e o aviso. Esta conta
// decide se refaz: um navegador que sai de novo antes de a interface mandar o ready (3 vezes seguidas) desiste, e a
// MainWindow mostra a mensagem do WebView2 (spec da W1, 11.1), em vez de refazer para sempre; um ambiente que nao abre
// durante um refazer (o navegador velho ainda saindo) e tentado de novo ate kMaxCreateFailures vezes. O ready da
// interface zera as contas.
//
// C++ portatil (sem o windows.h). Na thread da janela.
namespace starsonic {

class BrowserRestarts {
public:
    static constexpr int kMaxWithoutReady = 3;
    static constexpr int kMaxCreateFailures = 5;

    // O navegador saiu: true refaz; false desiste.
    bool OnBrowserExited();
    // O ambiente ou o WebView nao abriu: true tenta de novo (so durante um refazer); false: a falha vale.
    bool OnCreateFailed();
    // A interface mandou o ready.
    void OnReady();
    // Um refazer esta em andamento (ate o ready).
    bool Restarting() const { return restarting_; }

private:
    int withoutReady_ = 0;
    int createFailures_ = 0;
    bool restarting_ = false;
};

}  // namespace starsonic
