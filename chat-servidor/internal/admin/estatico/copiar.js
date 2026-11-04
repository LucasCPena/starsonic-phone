// O "Copiar o código" da página de uma empresa (seção 4.3 da spec). O botão começa escondido
// e só aparece quando este arquivo roda e o navegador sabe copiar: sem JavaScript, o código
// continua na tela para selecionar. O ouvinte fica aqui, e não no HTML, para a CSP
// default-src 'self' valer sem exceção.
(function () {
  "use strict";
  var botao = document.getElementById("copiar");
  var codigo = document.getElementById("codigo");
  var aviso = document.getElementById("copiado");
  if (!botao || !codigo || !aviso || !navigator.clipboard) {
    return;
  }
  botao.hidden = false;
  botao.addEventListener("click", function () {
    navigator.clipboard.writeText(codigo.textContent.trim()).then(
      function () {
        aviso.textContent = "Código copiado.";
      },
      function () {
        aviso.textContent = "Não deu para copiar. Selecione o código e copie.";
      }
    );
  });
})();
