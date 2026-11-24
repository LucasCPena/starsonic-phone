// O canal do rede.js que a página abandona ainda conectando: o close() de um WebSocket que conecta faz o Chromium
// escrever no console a URL dele, com o bilhete. O canal novo que toma o lugar de um que ainda conecta é o caminho que
// a página não alcança (o cérebro só abre um canal depois de fechar o anterior): aqui, com um WebSocket falso.
import assert from 'node:assert/strict';
import { test } from 'node:test';

class SocketFalso {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static todos = [];

  constructor(url) {
    this.url = url;
    this.readyState = SocketFalso.CONNECTING;
    this.fechamentos = []; // o readyState de cada close()
    this.enviadas = [];
    SocketFalso.todos.push(this);
  }

  send(texto) {
    this.enviadas.push(JSON.parse(texto));
  }

  close(codigo) {
    this.fechamentos.push(this.readyState);
    if (this.readyState === SocketFalso.OPEN) this.readyState = SocketFalso.CLOSING;
    this.codigo = codigo;
  }

  /** O servidor aceitou: o canal abre. */
  abrir() {
    this.readyState = SocketFalso.OPEN;
    this.onopen?.({});
  }
}

globalThis.WebSocket = SocketFalso;
globalThis.location = { protocol: 'https:', host: 'chat.exemplo.com.br' };
const { criarRede } = await import('../../internal/pagina/estatico/rede.js');

test('o canal novo no lugar de um que ainda conecta', () => {
  const eventos = [];
  const rede = criarRede((e) => eventos.push(e), 'k7q49xwpht');
  rede.abrirCanal('bilhete-1');
  rede.abrirCanal('bilhete-2');
  const [velho, novo] = SocketFalso.todos;
  assert.match(velho.url, /^wss:\/\/chat\.exemplo\.com\.br\/api\/v1\/pagina\/canal\?bilhete=bilhete-1$/);

  // O velho não é fechado conectando; quando abre, a página o fecha, e nada dele chega ao cérebro.
  assert.deepEqual(velho.fechamentos, []);
  velho.abrir();
  assert.deepEqual(velho.fechamentos, [SocketFalso.OPEN]);
  assert.equal(velho.codigo, 1000);
  assert.deepEqual(eventos, []);

  // O novo é o canal da página.
  novo.abrir();
  assert.deepEqual(eventos, [{ tipo: 'canalAbriu' }]);
  rede.mandar({ tipo: 'pedir', nome: 'Maria Lima' });
  assert.deepEqual(novo.enviadas, [{ tipo: 'pedir', nome: 'Maria Lima' }]);
  assert.deepEqual(velho.enviadas, []);
  rede.fecharCanal();
  assert.deepEqual(novo.fechamentos, [SocketFalso.OPEN]);
});

// O abrir, com um fetch falso: ele guarda cada chamada e responde o que o teste mandou.
const chamadas = [];
let resposta = { status: 200, corpo: {} };
globalThis.fetch = async (url, opcoes) => {
  chamadas.push({ url, opcoes });
  const { status, corpo } = resposta;
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
};
const REUNIAO = { tipo: 'naHora', assunto: '', inicio: 0 };

async function abrirCom(corpoDoAbrir, status, corpo) {
  chamadas.length = 0;
  resposta = { status, corpo };
  const eventos = [];
  const rede = criarRede((e) => eventos.push(e), 'k7q49xwpht');
  if (corpoDoAbrir === undefined) await rede.abrir(4);
  else await rede.abrir(4, corpoDoAbrir);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, '/api/v1/pagina/reunioes/k7q49xwpht');
  return { opcoes: chamadas[0].opcoes, eventos };
}

test('o abrir sem corpo não manda corpo nem Content-Type', async () => {
  const { opcoes, eventos } = await abrirCom(undefined, 200, { reuniao: REUNIAO, bilhete: 'bilhete-4' });
  assert.equal(opcoes.method, 'POST');
  assert.equal(opcoes.body, undefined);
  assert.equal(opcoes.headers, undefined);
  // Sem o colega, o abriu é o de hoje, letra por letra.
  assert.deepEqual(eventos, [{ tipo: 'abriu', reuniao: REUNIAO, bilhete: 'bilhete-4', abertura: 4 }]);
});

test('o 200 com a partida a repassa no abriu', async () => {
  const resposta = { reuniao: REUNIAO, bilhete: 'bilhete-4', partida: 'partida-1' };
  const { eventos } = await abrirCom(undefined, 200, resposta);
  assert.deepEqual(eventos, [{ tipo: 'abriu', reuniao: REUNIAO, bilhete: 'bilhete-4', abertura: 4, partida: 'partida-1' }]);
});

test('o 200 sem a partida, ou com uma que não é texto, não leva a partida no abriu', async () => {
  for (const partida of [undefined, null, 7, { a: 1 }]) {
    const resposta = { reuniao: REUNIAO, bilhete: 'bilhete-4', partida };
    const { eventos } = await abrirCom(undefined, 200, resposta);
    assert.deepEqual(eventos, [{ tipo: 'abriu', reuniao: REUNIAO, bilhete: 'bilhete-4', abertura: 4 }]);
  }
});

test('o abrir com corpo manda o JSON', async () => {
  for (const corpo of [{ passe: 'p'.repeat(43) }, { colega: 'c'.repeat(43) }]) {
    const { opcoes } = await abrirCom(corpo, 200, { reuniao: REUNIAO, bilhete: 'bilhete-4' });
    assert.equal(opcoes.method, 'POST');
    assert.deepEqual(opcoes.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(opcoes.body), corpo);
  }
});

test('o 200 com o colega o repassa', async () => {
  const colega = { nome: 'Júlia Martins', chave: 'c'.repeat(43), valeAte: null };
  const resposta = { reuniao: REUNIAO, bilhete: 'bilhete-4', colega };
  const { eventos } = await abrirCom({ passe: 'p'.repeat(43) }, 200, resposta);
  assert.deepEqual(eventos, [{ tipo: 'abriu', reuniao: REUNIAO, bilhete: 'bilhete-4', abertura: 4, colega }]);
});

test('o 401 com o erro passe dá o abrirFalhou com o passe', async () => {
  let { eventos } = await abrirCom({ passe: 'p'.repeat(43) }, 401, { erro: 'passe' });
  assert.deepEqual(eventos, [
    { tipo: 'abrirFalhou', status: 401, esperarSegundos: undefined, abertura: 4, passe: true },
  ]);
  // Os outros erros são os de hoje, sem o passe.
  ({ eventos } = await abrirCom(undefined, 404, { erro: 'naoEncontrado' }));
  assert.deepEqual(eventos, [{ tipo: 'abrirFalhou', status: 404, esperarSegundos: undefined, abertura: 4 }]);
  ({ eventos } = await abrirCom({ colega: 'c'.repeat(43) }, 429, { erro: 'tentativas', esperarSegundos: 7 }));
  assert.deepEqual(eventos, [{ tipo: 'abrirFalhou', status: 429, esperarSegundos: 7, abertura: 4 }]);
});
