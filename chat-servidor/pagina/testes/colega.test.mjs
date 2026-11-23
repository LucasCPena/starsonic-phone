// Os testes do colega.js: as contas e os textos da página do colega, puros, sem DOM, sem rede e sem relógio. Os textos
// são os da seção "Os textos" do plano, letra por letra.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LISTA_VAZIA,
  ditoDaResposta,
  ehWindows,
  fraseDoEncerrar,
  iniciais,
  lerLista,
  nomeNaLista,
  passeDoEndereco,
  rotuloDoBotao,
  tituloDoCartao,
} from '../../internal/pagina/estatico/colega.js';

// Os pedidos de mentira, na ordem da lista do servidor.
const PEDIDOS = [
  { id: 'a000000000000001', nome: 'Maria Lima' },
  { id: 'a000000000000002', nome: 'Bia Ramos' },
  { id: 'a000000000000003', nome: 'Roberto Alves' },
  { id: 'a000000000000004', nome: 'Pedro Nunes' },
  { id: 'a000000000000005', nome: 'Carlos Lima' },
];
const pedidos = (n) => PEDIDOS.slice(0, n);

test('LISTA_VAZIA', () => {
  assert.deepEqual(LISTA_VAZIA, { participantes: [], pedidos: [] });
  assert.ok(Object.isFrozen(LISTA_VAZIA));
});

test('iniciais', () => {
  for (const [nome, esperado] of [
    ['', '?'],
    ['   ', '?'],
    ['Ana', 'A'],
    ['Júlia Martins', 'JM'],
    ['Ana Maria Souza', 'AS'],
    ['  carlos   lima  ', 'CL'],
    ['ágata', 'Á'],
  ]) {
    assert.equal(iniciais(nome), esperado, nome);
  }
});

test('rotuloDoBotao', () => {
  for (const [n, esperado] of [
    [0, 'Participantes'],
    [1, 'Participantes, 1 pessoa quer entrar'],
    [2, 'Participantes, 2 pessoas querem entrar'],
    [5, 'Participantes, 5 pessoas querem entrar'],
  ]) {
    assert.equal(rotuloDoBotao(pedidos(n)), esperado, String(n));
  }
});

test('tituloDoCartao', () => {
  for (const [n, esperado] of [
    [0, ''],
    [1, 'Maria Lima quer entrar'],
    [2, 'Maria Lima e mais 1 querem entrar'],
    [5, 'Maria Lima e mais 4 querem entrar'],
  ]) {
    assert.equal(tituloDoCartao(pedidos(n)), esperado, String(n));
  }
});

test('fraseDoEncerrar', () => {
  // As datas no relógio local: agora são 15:00 de 23/11/2026.
  const agora = new Date(2026, 10, 23, 15, 0).getTime();
  const ate = (dia, mes, h = 23, m = 59) => new Date(2026, mes - 1, dia, h, m).getTime();
  const recomeca = (quando) => `O link continua valendo até ${quando}: a reunião recomeça se um colega entrar de novo.`;
  const naoVale = 'Depois disso, o link não vale mais.';
  for (const [n, tipo, valeAte, esperado] of [
    [5, 'naHora', null, ['As 5 pessoas saem agora.', naoVale]],
    [1, 'naHora', null, ['Você sai agora.', naoVale]],
    [2, 'marcada', ate(23, 11), ['As 2 pessoas saem agora.', recomeca('hoje, 23:59')]],
    [2, 'marcada', ate(24, 11), ['As 2 pessoas saem agora.', recomeca('amanhã, 23:59')]],
    [2, 'marcada', ate(26, 11), ['As 2 pessoas saem agora.', recomeca('26/11, 23:59')]],
    [2, 'marcada', ate(5, 12, 18, 30), ['As 2 pessoas saem agora.', recomeca('05/12, 18:30')]],
    [1, 'marcada', ate(23, 11), ['Você sai agora.', recomeca('hoje, 23:59')]],
    // A marcada com o valeAte já passado.
    [3, 'marcada', ate(23, 11, 14, 59), ['As 3 pessoas saem agora.', naoVale]],
    // O valeAte que não é número: a segunda frase é a dos outros casos.
    [3, 'marcada', null, ['As 3 pessoas saem agora.', naoVale]],
    [3, 'marcada', '1795000000000', ['As 3 pessoas saem agora.', naoVale]],
    [3, 'marcada', Number.NaN, ['As 3 pessoas saem agora.', naoVale]],
  ]) {
    assert.deepEqual(fraseDoEncerrar(n, tipo, valeAte, agora), esperado, `${n} ${tipo} ${valeAte}`);
  }
});

test('ditoDaResposta', () => {
  assert.equal(ditoDaResposta('aceitar', 'Maria Lima'), 'O pedido de Maria Lima foi aceito');
  assert.equal(ditoDaResposta('recusar', 'Maria Lima'), 'O pedido de Maria Lima foi recusado');
  assert.equal(ditoDaResposta('tirar', 'Pedro Nunes'), 'Pedro Nunes saiu da reunião');
});

// O participante sem nome (o que volta ao chat que reiniciou chega com o nome vazio) é "Participante", como nos quadros
// e no chat da reunião: no painel, no cartão e no que o leitor de tela ouve.
test('o participante sem nome é Participante', () => {
  assert.equal(nomeNaLista(''), 'Participante');
  assert.equal(nomeNaLista('Maria Lima'), 'Maria Lima');
  const semNome = { id: 'a000000000000009', nome: '' };
  assert.equal(tituloDoCartao([semNome]), 'Participante quer entrar');
  assert.equal(tituloDoCartao([semNome, ...pedidos(1)]), 'Participante e mais 1 querem entrar');
  assert.equal(ditoDaResposta('aceitar', ''), 'O pedido de Participante foi aceito');
  assert.equal(ditoDaResposta('recusar', ''), 'O pedido de Participante foi recusado');
  assert.equal(ditoDaResposta('tirar', ''), 'Participante saiu da reunião');
});

test('lerLista', () => {
  const ana = { id: 'b000000000000001', nome: 'Ana Souza', deFora: false, tela: false, voce: true };
  const maria = { id: 'a000000000000001', nome: 'Maria Lima' };
  // A lista que vale: só os campos conhecidos, e os booleanos que faltam são falsos.
  assert.deepEqual(
    lerLista({
      tipo: 'participantes',
      participantes: [
        { ...ana, extra: 1 },
        { id: 'b2', nome: '' },
      ],
      pedidos: [maria],
    }),
    {
      participantes: [ana, { id: 'b2', nome: '', deFora: false, tela: false, voce: false }],
      pedidos: [maria],
    },
  );
  // Uma mensagem sem as listas não vale.
  assert.equal(lerLista({ tipo: 'participantes' }), null);
  assert.equal(lerLista({ tipo: 'participantes', participantes: [] }), null);
  assert.equal(lerLista({ tipo: 'participantes', pedidos: [] }), null);
  assert.equal(lerLista({ tipo: 'participantes', participantes: {}, pedidos: [] }), null);
  // Um item sem id sai.
  assert.deepEqual(lerLista({ participantes: [{ nome: 'Ana Souza' }, ana], pedidos: [{ nome: 'Maria Lima' }] }), {
    participantes: [ana],
    pedidos: [],
  });
  // Um nome que não é texto sai, e o item que não é objeto também.
  assert.deepEqual(
    lerLista({ participantes: [{ ...ana, nome: 7 }, null], pedidos: [{ ...maria, nome: null }, 'x', maria] }),
    { participantes: [], pedidos: [maria] },
  );
  // 14 participantes valem: quem limita é o servidor.
  const muitos = Array.from({ length: 14 }, (_, i) => ({ ...ana, id: `c${i}`, voce: i === 0 }));
  assert.equal(lerLista({ participantes: muitos, pedidos: [] }).participantes.length, 14);
});

test('passeDoEndereco', () => {
  // 43 caracteres base64url: as letras, os números, o - e o _.
  const passe = 'Ab9_-'.repeat(8) + 'xyz';
  assert.equal(passe.length, 43);
  assert.equal(passeDoEndereco(`#p=${passe}`), passe);
  for (const [hash, porque] of [
    [`#p=${passe.slice(1)}`, 'com 42'],
    [`#p=${passe}a`, 'com 44'],
    [`#p=${passe.slice(1)}=`, 'com o ='],
    [`#p=${passe.slice(1)}+`, 'com o +'],
    [`#q=${passe}`, 'com outro nome'],
    [`#p=${passe}&x=1`, 'com dois parâmetros'],
    [`#x=1&p=${passe}`, 'com dois parâmetros, o passe no fim'],
    ['', 'vazio'],
    ['#', 'só o #'],
    ['#p=', 'sem o passe'],
    [passe, 'sem o #p='],
    [null, 'sem o hash'],
    [undefined, 'sem o hash'],
  ]) {
    assert.equal(passeDoEndereco(hash), null, porque);
  }
});

test('ehWindows', () => {
  // Os agentes de verdade, com o userAgentData onde o navegador o tem (o Chromium); sem ele, decide o agente.
  const CHROME_WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/131.0.0.0`;
  const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
  const CHROME_ANDROID =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const CHROME_LINUX =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const dados = (platform) => ({ platform, mobile: platform === 'Android', brands: [] });
  for (const [navegador, esperado, qual] of [
    [{ userAgent: CHROME_WINDOWS, userAgentData: dados('Windows') }, true, 'o Chrome no Windows'],
    [{ userAgent: EDGE_WINDOWS, userAgentData: dados('Windows') }, true, 'o Edge no Windows'],
    [{ userAgent: FIREFOX_WINDOWS }, true, 'o Firefox no Windows'],
    [{ userAgent: CHROME_ANDROID, userAgentData: dados('Android') }, false, 'o Chrome no Android'],
    [{ userAgent: SAFARI_IPHONE }, false, 'o Safari no iPhone'],
    [{ userAgent: CHROME_MAC, userAgentData: dados('macOS') }, false, 'o Chrome no macOS'],
    [{ userAgent: CHROME_LINUX, userAgentData: dados('Linux') }, false, 'o Chrome no Linux'],
    // Com o userAgentData, quem decide é ele, e não o agente.
    [{ userAgent: CHROME_LINUX, userAgentData: dados('Windows') }, true, 'o platform Windows'],
    [{ userAgent: CHROME_WINDOWS, userAgentData: dados('Linux') }, false, 'o platform Linux'],
    // Sem o platform, o agente.
    [{ userAgent: CHROME_WINDOWS, userAgentData: dados('') }, true, 'o platform vazio'],
    [{ userAgent: CHROME_WINDOWS, userAgentData: null }, true, 'o userAgentData null'],
    [{}, false, 'sem nada'],
    [undefined, false, 'sem o navegador'],
  ]) {
    assert.equal(ehWindows(navegador), esperado, qual);
  }
});
