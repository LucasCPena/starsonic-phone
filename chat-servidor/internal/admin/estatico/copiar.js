// O "Copiar o código" da página de uma empresa (seção 4.3 da spec), e o "Copiar o link" da
// reunião de teste. O botão começa escondido e só aparece quando este arquivo roda e o
// navegador sabe copiar: sem JavaScript, o texto continua na tela para selecionar. O botão pode
// dar os avisos dele (data-copiado e data-erro); sem eles, valem os do código. O ouvinte fica
// aqui, e não no HTML, para a CSP default-src 'self' valer sem exceção.
(function () {
  "use strict";
  var botao = document.getElementById("copiar");
  var codigo = document.getElementById("codigo");
  var aviso = document.getElementById("copiado");
  if (!botao || !codigo || !aviso || !navigator.clipboard) {
    return;
  }
  var copiado = botao.getAttribute("data-copiado") || "Código copiado.";
  var erro = botao.getAttribute("data-erro") || "Não deu para copiar. Selecione o código e copie.";
  botao.hidden = false;
  botao.addEventListener("click", function () {
    navigator.clipboard.writeText(codigo.textContent.trim()).then(
      function () {
        aviso.textContent = copiado;
      },
      function () {
        aviso.textContent = erro;
      }
    );
  });
})();
