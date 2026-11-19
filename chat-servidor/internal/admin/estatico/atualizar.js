// A atualização sozinha das páginas dos ramais (a lista das empresas e a página de uma empresa): a cada 30 s, este
// arquivo busca a própria página de novo e troca só as partes marcadas com data-ao-vivo, que são as que mudam sozinhas
// (os números, as listas e as tabelas). O resto fica como está: o código da empresa, com o "Copiar o código", e o
// cartão de apagar. Sem JavaScript, as páginas continuam certas: só não se atualizam, e a frase que promete a
// atualização (data-so-com-script) nem aparece.
//
// A troca espera enquanto a pessoa está num campo, ou anda com o teclado por um formulário ou por uma parte que seria
// trocada (ela perderia o lugar), e enquanto o ponteiro está em cima de um botão de formulário de uma dessas partes
// (as linhas podem mudar de lugar bem na hora do clique). Uma parte que rola por dentro continua rolada como estava.
// Se a sessão venceu ou a página deixou de existir, a página se recarrega: aparece a entrada, ou a "não encontrada".
// Ela também se recarrega quando o chat foi atualizado com ela aberta: a página que chega pede outro estilo ou outro
// script (o endereço de cada arquivo leva uma marca do conteúdo dele), e as partes novas não entram no meio dos velhos.
// Em qualquer outra falha, o aviso diz desde quando a página está sem atualizar, e a busca continua a cada 30 s.
//
// O HTML que chega é lido com o DOMParser, e os elementos entram com o importNode: nenhum texto vira marcação aqui. O
// arquivo é externo, e não um script dentro da página, para a CSP default-src 'self' valer sem exceção.
(function () {
  "use strict";
  var INTERVALO_MS = 30000;
  var PRAZO_MS = 20000;
  var ESTATICOS = "/admin/estatico/";

  var aviso = document.getElementById("sem-atualizar");
  if (!aviso || !window.fetch || !window.DOMParser || !document.querySelector("[data-ao-vivo]")) {
    return;
  }
  var soComScript = document.querySelectorAll("[data-so-com-script]");
  for (var i = 0; i < soComScript.length; i++) {
    soComScript[i].hidden = false;
  }
  // O aviso fica na página o tempo todo, vazio (sem tamanho, pelo estilo): o leitor de tela só diz o texto que chega a
  // um aviso que já estava lá.
  aviso.hidden = false;

  // O estilo e os scripts que um documento pede ao chat. Só os da própria administração contam: uma extensão do
  // navegador pode pôr os dela na página aberta, e eles não vêm na página que a busca traz.
  function arquivosDe(documento) {
    var lista = documento.querySelectorAll('link[rel="stylesheet"][href], script[src]');
    var enderecos = [];
    for (var i = 0; i < lista.length; i++) {
      var endereco = lista[i].getAttribute("href") || lista[i].getAttribute("src");
      if (endereco.indexOf(ESTATICOS) === 0) {
        enderecos.push(endereco);
      }
    }
    return enderecos.join(" ");
  }

  // Os desta carga da página.
  var arquivos = arquivosDe(document);
  // A última vez em que a página ficou em dia: a carga, ou a última troca.
  var emDia = new Date();
  // Quantas rodadas seguidas o foco segurou.
  var esperas = 0;

  function doisDigitos(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function desde() {
    return "Sem atualizar desde as " + doisDigitos(emDia.getHours()) + ":" + doisDigitos(emDia.getMinutes());
  }

  function avisar(texto) {
    aviso.textContent = texto;
    // Com o aviso na tela, o estilo deixa uma folga embaixo da janela: o navegador rola o que recebe o foco do teclado
    // para cima do aviso, e não para trás dele.
    document.documentElement.classList.toggle("com-aviso", texto !== "");
  }

  // O foco segura a troca quando a pessoa está escrevendo, ou andando pela página com o teclado: num campo, sempre; num
  // botão ou num link de um formulário, ou de uma parte que seria trocada, só quando o foco chegou pelo teclado (o
  // :focus-visible). O clique do mouse também deixa o foco no botão ou no link (o clique com o Ctrl num "Abrir", que
  // abre a empresa em outra aba, por exemplo), e ali a pessoa não está parada no lugar. Num navegador sem o
  // :focus-visible, todo foco desses segura.
  function focoSegura() {
    var e = document.activeElement;
    if (!e || e === document.body || e === document.documentElement) {
      return false;
    }
    if (e.nodeName === "INPUT" || e.nodeName === "SELECT" || e.nodeName === "TEXTAREA") {
      return true;
    }
    if (!e.closest || (e.closest("form") === null && e.closest("[data-ao-vivo]") === null)) {
      return false;
    }
    try {
      return e.matches(":focus-visible");
    } catch (semOSeletor) {
      return true;
    }
  }

  // O ponteiro está em cima de um botão de formulário de uma parte que seria trocada (o "Tirar do chat", o × de um
  // computador). A troca pode mudar as linhas de lugar bem na hora do clique, e esses botões não têm volta.
  function ponteiroSegura() {
    try {
      return document.querySelector("[data-ao-vivo] form button:hover") !== null;
    } catch (semOSeletor) {
      return false;
    }
  }

  function segura() {
    return focoSegura() || ponteiroSegura();
  }

  // As partes de um documento, pelo valor do data-ao-vivo.
  function partesDe(documento) {
    var partes = {};
    var lista = documento.querySelectorAll("[data-ao-vivo]");
    for (var i = 0; i < lista.length; i++) {
      partes[lista[i].getAttribute("data-ao-vivo")] = lista[i];
    }
    return partes;
  }

  // Troca cada parte da página pela de mesmo nome do documento que chegou. Se faltar alguma, não troca nenhuma.
  function trocar(novo) {
    var daqui = partesDe(document);
    var de = partesDe(novo);
    var nome, antiga, nova, paraOLado, paraBaixo;
    for (nome in daqui) {
      if (!Object.prototype.hasOwnProperty.call(de, nome)) {
        return false;
      }
    }
    for (nome in daqui) {
      antiga = daqui[nome];
      nova = document.importNode(de[nome], true);
      paraOLado = antiga.scrollLeft;
      paraBaixo = antiga.scrollTop;
      antiga.parentNode.replaceChild(nova, antiga);
      // A parte pode rolar por dentro (a tabela, numa tela estreita): a nova fica rolada como a antiga estava.
      if (paraOLado) {
        nova.scrollLeft = paraOLado;
      }
      if (paraBaixo) {
        nova.scrollTop = paraBaixo;
      }
    }
    return true;
  }

  function esperar() {
    esperas += 1;
    if (esperas >= 2) {
      avisar(desde() + ": a página espera você sair do campo ou do botão em que está.");
    }
  }

  function falhou() {
    esperas = 0;
    avisar(desde() + ". A página tenta de novo sozinha.");
  }

  function agendar() {
    setTimeout(rodada, INTERVALO_MS);
  }

  function rodada() {
    if (segura()) {
      esperar();
      agendar();
      return;
    }
    var cancelar = window.AbortController ? new AbortController() : null;
    var prazo = setTimeout(function () {
      if (cancelar) {
        cancelar.abort();
      }
    }, PRAZO_MS);
    fetch(window.location.href, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "follow",
      signal: cancelar ? cancelar.signal : undefined
    })
      .then(function (resposta) {
        // A sessão venceu (o servidor mandou para a entrada) ou a página não existe mais: quem diz isso é a
        // própria página, recarregada.
        if (resposta.redirected || resposta.status === 404) {
          return null;
        }
        if (resposta.status !== 200) {
          throw new Error("a página respondeu " + resposta.status);
        }
        return resposta.text();
      })
      .then(function (html) {
        clearTimeout(prazo);
        if (html === null) {
          window.location.reload();
          return;
        }
        var novo = new DOMParser().parseFromString(html, "text/html");
        // O foco ou o ponteiro podem ter chegado durante a busca: a troca fica para a rodada seguinte.
        if (segura()) {
          esperar();
        } else if (arquivosDe(novo) !== arquivos) {
          // O chat mudou de versão: a página inteira vem de novo, com o estilo e os scripts dela.
          window.location.reload();
          return;
        } else if (trocar(novo)) {
          esperas = 0;
          emDia = new Date();
          avisar("");
        } else {
          falhou();
        }
        agendar();
      })
      .catch(function () {
        clearTimeout(prazo);
        falhou();
        agendar();
      });
  }

  agendar();
})();
