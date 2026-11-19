// A atualização sozinha das páginas dos ramais (a lista das empresas e a página de uma empresa): a cada 30 s, este
// arquivo busca a própria página de novo e troca só as partes marcadas com data-ao-vivo, que são as que mudam sozinhas
// (os números, as listas e as tabelas). O resto fica como está: o código da empresa, com o "Copiar o código", e o
// cartão de apagar. Sem JavaScript, as páginas continuam certas: só não se atualizam, e a frase que promete a
// atualização (data-so-com-script) nem aparece.
//
// A troca espera enquanto a pessoa está com o foco num campo, num formulário ou dentro de uma parte que seria trocada
// (ela perderia o lugar). Se a sessão venceu ou a página deixou de existir, a página se recarrega: aparece a entrada,
// ou a "não encontrada". Em qualquer outra falha, o aviso diz desde quando a página está sem atualizar, e a busca
// continua a cada 30 s.
//
// O HTML que chega é lido com o DOMParser, e os elementos entram com o importNode: nenhum texto vira marcação aqui. O
// arquivo é externo, e não um script dentro da página, para a CSP default-src 'self' valer sem exceção.
(function () {
  "use strict";
  var INTERVALO_MS = 30000;
  var PRAZO_MS = 20000;

  var aviso = document.getElementById("sem-atualizar");
  if (!aviso || !window.fetch || !window.DOMParser || !document.querySelector("[data-ao-vivo]")) {
    return;
  }
  var soComScript = document.querySelectorAll("[data-so-com-script]");
  for (var i = 0; i < soComScript.length; i++) {
    soComScript[i].hidden = false;
  }

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
    aviso.hidden = texto === "";
  }

  // O foco está num campo, num formulário ou dentro de uma parte que seria trocada.
  function focoSegura() {
    var e = document.activeElement;
    if (!e || e === document.body || e === document.documentElement) {
      return false;
    }
    if (e.nodeName === "INPUT" || e.nodeName === "SELECT" || e.nodeName === "TEXTAREA") {
      return true;
    }
    return !!e.closest && (e.closest("form") !== null || e.closest("[data-ao-vivo]") !== null);
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
    var nome;
    for (nome in daqui) {
      if (!Object.prototype.hasOwnProperty.call(de, nome)) {
        return false;
      }
    }
    for (nome in daqui) {
      daqui[nome].parentNode.replaceChild(document.importNode(de[nome], true), daqui[nome]);
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
    if (focoSegura()) {
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
        // O foco pode ter chegado durante a busca: a troca fica para a rodada seguinte.
        if (focoSegura()) {
          esperar();
        } else if (trocar(new DOMParser().parseFromString(html, "text/html"))) {
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
