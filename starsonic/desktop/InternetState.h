#pragma once
// A internet que o executavel ve (rc.3, spec 8 com os Rulings 16, 23 e 25): o que o monitor de rede do executavel diz
// ao DesktopApp (DesktopApp::SetInternet) e o que cada estado faz com o motor. C++ portatil.
namespace starsonic {

enum class InternetState {
    // Com internet.
    Online,
    // Sem rede (regra a do Ruling 16): o Windows nao ve nenhuma rede. O "sem internet" forte: o motor para (nao tenta
    // registrar nem tentar de novo; o registro que o servidor tem fica ate vencer) e a ligacao nao sai.
    NoNetwork,
    // Sem o DNS (regra b, com o Ruling 23): duas falhas seguidas do teste DNS do servidor, contadas so com a conta fora
    // do ar. O "sem internet" fraco: so a bolinha; o motor segue como esta (sem pausa: o registro, as ligacoes e as
    // novas tentativas continuam).
    NoDns,
};

}  // namespace starsonic
