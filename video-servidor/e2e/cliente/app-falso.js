// O app de mentira (a etapa 2a, seção 7.5 da spec): a janela de cima que mostra a página da reunião num iframe, como a
// interface do Starsonic Phone, e conversa com ela por postMessage. O código da reunião vem depois do # do endereço,
// que o servidor não recebe. O que a página manda fica guardado para os testes (o recebidas), e os testes mandam o que o
// app mandaria (o mandar). Com o window.pausarAoEntrarDoTeste, o app responde ao primeiro estado com a fase naReuniao
// com o pausar, sozinho, como o app de verdade faz quando já há uma ligação. A hora (o Date.now, o mesmo relógio do
// quadro) em que esse primeiro naReuniao chegou fica guardada: os prazos da pausa contam dela. Nada disto vai ao
// console.

// A origem do chat do teste (o CHAT do servidores.ts), a única a que o app fala e de que ouve.
const CHAT = 'http://127.0.0.1:4191';

const quadro = document.getElementById('reuniao');
const recebidas = [];
let pausarAoEntrar = window.pausarAoEntrarDoTeste === true;
let naReuniaoEm = null;

function mandar(tipo, campos = {}) {
  quadro.contentWindow?.postMessage({ ...campos, starsonic: 1, tipo }, CHAT);
}

addEventListener('message', (e) => {
  if (e.source !== quadro.contentWindow || e.origin !== CHAT) return;
  const m = e.data;
  if (m === null || typeof m !== 'object' || m.starsonic !== 1) return;
  recebidas.push(m);
  if (m.tipo === 'estado' && m.fase === 'naReuniao') naReuniaoEm ??= Date.now();
  if (pausarAoEntrar && m.tipo === 'estado' && m.fase === 'naReuniao') {
    pausarAoEntrar = false;
    mandar('pausar');
  }
});

window.appFalso = { mandar, recebidas: () => recebidas.slice(), naReuniaoEm: () => naReuniaoEm };

quadro.src = `${CHAT}/r/${location.hash.slice(1)}`;
