// Os testes da conversa com o app (app.js): a página dentro do iframe da interface do app fala só com a janela de cima,
// e só aceita o que vem dela, com a origem do app (seção 7.5 da spec). A janela, a de cima e o documento são de
// mentira: nada aqui toca num navegador.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarApp, origensDoApp } from '../../internal/pagina/estatico/app.js';

const APP = 'https://app.starsonic.local';
const DE_TESTE = 'http://127.0.0.1:4194';
const ORIGENS = [APP, DE_TESTE];

// Uma janela de mentira: a de cima guarda o que recebe ({m, origem}); a chegar entrega um evento message aos ouvintes.
// O ancestrais é o location.ancestorOrigins (o Chromium o tem; o Firefox, não).
function janelaDeMentira({ dentro = true, ancestrais } = {}) {
  const ouvintes = [];
  const cima = {
    recebidas: [],
    postMessage(m, origem) {
      this.recebidas.push({ m, origem });
    },
  };
  const janela = {
    parent: null,
    location: ancestrais === undefined ? {} : { ancestorOrigins: ancestrais },
    addEventListener(tipo, fn) {
      if (tipo === 'message') ouvintes.push(fn);
    },
    chegar(evento) {
      for (const fn of ouvintes) fn(evento);
    },
    ouvintes,
  };
  janela.parent = dentro ? cima : janela;
  return { janela, cima };
}

// O app dentro da janela de mentira, e os eventos que ele deu ao cérebro.
function comApp(opcoes, origens = ORIGENS) {
  const { janela, cima } = janelaDeMentira(opcoes);
  const eventos = [];
  const app = criarApp((e) => eventos.push(e), { janela, origens });
  return { app, janela, cima, eventos };
}

const PASSE = { starsonic: 1, tipo: 'passe', passe: 'p'.repeat(43), aparelhos: {} };

test('o meta dá as origens do app', () => {
  const doc = (content) => ({
    querySelector: (s) => (s === 'meta[name="starsonic-app"]' && content !== null ? { getAttribute: () => content } : null),
  });
  assert.deepEqual(origensDoApp(doc(APP)), [APP]);
  assert.deepEqual(origensDoApp(doc(`  ${APP}   ${DE_TESTE} `)), ORIGENS);
  // Sem o meta, ou vazio, nenhuma; o que não é uma origem (o modelo sem a troca, um caminho) fica de fora.
  assert.deepEqual(origensDoApp(doc(null)), []);
  assert.deepEqual(origensDoApp(doc('')), []);
  assert.deepEqual(origensDoApp(doc(`{{ORIGENS_DO_APP}} ${APP}/r *`)), []);
  assert.deepEqual(origensDoApp(undefined), []);
});

test('dentro só com a janela de cima e uma origem', () => {
  assert.equal(comApp({}).app.dentro, true);
  // A página que é a janela de cima, ou sem origem nenhuma na lista, não está no app: nada sai, e nada é ouvido.
  for (const [opcoes, origens] of [
    [{ dentro: false }, ORIGENS],
    [{}, []],
  ]) {
    const { app, janela, cima } = comApp(opcoes, origens);
    assert.equal(app.dentro, false);
    app.mandar('pronta');
    assert.deepEqual(cima.recebidas, []);
    assert.equal(janela.ouvintes.length, 0);
  }
});

test('a mensagem da janela de cima, com a origem do app, chega ao cérebro', () => {
  const { janela, cima, eventos } = comApp({});
  for (const tipo of ['passe', 'aparelhos', 'pausar', 'retomar', 'bloqueio', 'sair']) {
    const m = tipo === 'passe' ? PASSE : { starsonic: 1, tipo };
    janela.chegar({ source: cima, origin: DE_TESTE, data: m });
  }
  assert.deepEqual(
    eventos.map((e) => e.tipo),
    ['app', 'app', 'app', 'app', 'app', 'app'],
  );
  assert.deepEqual(eventos[0].m, PASSE);
  assert.deepEqual(
    eventos.map((e) => e.m.tipo),
    ['passe', 'aparelhos', 'pausar', 'retomar', 'bloqueio', 'sair'],
  );
});

test('o que não vem do app é ignorado', () => {
  const { janela, cima, eventos } = comApp({});
  // Um iframe da própria página, ou outra janela qualquer, com a origem certa.
  const outraJanela = { postMessage() {} };
  for (const ev of [
    { source: cima, origin: 'https://outro.exemplo.com.br', data: PASSE },
    { source: cima, origin: 'null', data: PASSE },
    { source: outraJanela, origin: APP, data: PASSE },
    { source: janela, origin: APP, data: PASSE },
    { source: null, origin: APP, data: PASSE },
    // Sem o starsonic, com outro, e com um tipo desconhecido.
    { source: cima, origin: APP, data: { tipo: 'passe', passe: PASSE.passe } },
    { source: cima, origin: APP, data: { ...PASSE, starsonic: 2 } },
    { source: cima, origin: APP, data: { ...PASSE, starsonic: '1' } },
    { source: cima, origin: APP, data: { starsonic: 1, tipo: 'abrir' } },
    { source: cima, origin: APP, data: { starsonic: 1 } },
    // O data nulo, texto, número ou lista.
    { source: cima, origin: APP, data: null },
    { source: cima, origin: APP, data: JSON.stringify(PASSE) },
    { source: cima, origin: APP, data: 1 },
    { source: cima, origin: APP, data: [PASSE] },
  ]) {
    janela.chegar(ev);
  }
  assert.deepEqual(eventos, []);
});

test('o mandar vai à janela de cima, a cada origem', () => {
  // Sem o ancestorOrigins, o navegador não diz quem está em cima: a mensagem vai a cada origem da lista, e só a de
  // verdade a recebe.
  const { app, cima } = comApp({});
  app.mandar('fim', { motivo: 'saiu' });
  assert.deepEqual(cima.recebidas, [
    { m: { starsonic: 1, tipo: 'fim', motivo: 'saiu' }, origem: APP },
    { m: { starsonic: 1, tipo: 'fim', motivo: 'saiu' }, origem: DE_TESTE },
  ]);
  // Sem campos, só o starsonic e o tipo. O tipo dos campos não toma o lugar do tipo.
  cima.recebidas.length = 0;
  app.mandar('pronta');
  app.mandar('estado', { tipo: 'outro', fase: 'entrada', microfone: true });
  assert.deepEqual(
    cima.recebidas.map((r) => r.m),
    [
      { starsonic: 1, tipo: 'pronta' },
      { starsonic: 1, tipo: 'pronta' },
      { starsonic: 1, tipo: 'estado', fase: 'entrada', microfone: true },
      { starsonic: 1, tipo: 'estado', fase: 'entrada', microfone: true },
    ],
  );
});

test('com o ancestorOrigins, só à origem de verdade', () => {
  // O Chromium diz a origem de cima: a mensagem vai só a ela (as outras dariam um aviso no console, com as origens).
  const { app, cima } = comApp({ ancestrais: [DE_TESTE] });
  assert.equal(app.dentro, true);
  app.mandar('pronta');
  assert.deepEqual(cima.recebidas, [{ m: { starsonic: 1, tipo: 'pronta' }, origem: DE_TESTE }]);
  // A de cima que não é do app não recebe nada, e nada dela é ouvido.
  const fora = comApp({ ancestrais: ['https://outro.exemplo.com.br'] });
  assert.equal(fora.app.dentro, false);
  fora.app.mandar('pronta');
  assert.deepEqual(fora.cima.recebidas, []);
  assert.equal(fora.janela.ouvintes.length, 0);
});
