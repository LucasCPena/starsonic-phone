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
