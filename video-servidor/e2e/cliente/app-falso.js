// O app de mentira (a etapa 2a, seção 7.5 da spec): a janela de cima que mostra a página da reunião num iframe, como a
// interface do Starsonic Phone, e conversa com ela por postMessage. O código da reunião vem depois do # do endereço,
// que o servidor não recebe. O que a página manda fica guardado para os testes (o recebidas), e os testes mandam o que o
// app mandaria (o mandar). Com o window.pausarAoEntrarDoTeste, o app responde ao primeiro estado com a fase naReuniao
// com o pausar, sozinho, como o app de verdade faz quando já há uma ligação. A hora (o Date.now, o mesmo relógio do
// quadro) em que esse primeiro naReuniao chegou fica guardada: os prazos da pausa contam dela. Nada disto vai ao
// console.

// A origem do chat do teste (o CHAT do servidores.ts), a única a que o app fala e de que ouve.
const CHAT = 'http://127.0.0.1:4191';

// O quadro da reunião, com o allow da spec (seção 7.4) só para a origem do chat. O endereço e o allow vão juntos, antes
// de o quadro entrar no documento: um iframe com o allow e sem o endereço guarda o documento vazio do começo, da origem
// do app, para o qual nada do allow vale, e o Chromium avisa no console cada recurso dele ("Potential permissions
// policy violation"). O speaker-selection da spec fica de fora: o Chromium do teste não conhece o nome e o recusa no
// allow, também com um aviso no console.
const quadro = document.createElement('iframe');
quadro.id = 'reuniao';
quadro.title = 'Reunião';
quadro.width = '1200';
quadro.height = '760';
quadro.allow = ['camera', 'microphone', 'display-capture', 'autoplay'].map((p) => `${p} ${CHAT}`).join('; ');
quadro.src = `${CHAT}/r/${location.hash.slice(1)}`;

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

document.body.append(quadro);
