// As regras da sala (src/sala/estado.ts), os textos com conta (src/sala/textos.ts) e a arrumação do núcleo em frações
// (src/sala/mosaico.ts), sobre os estados dos cenários da ponte falsa. Roda no Node, sem a página.
import { expect, test } from '@playwright/test';
import { createScenario } from '../../src/fake-scenarios';
import {
  cameraDaSalaDesativada,
  foraDaSala,
  mostraAdicionar,
  nomeNaSala,
  nomesDaSala,
  pessoasNaSala,
  podeAdicionar,
  salaDe,
  salaEmbaixo,
  salaEmCima,
} from '../../src/sala/estado';
import { arrumacao, naLinhaDeBaixo } from '../../src/sala/mosaico';
import { ligacoesVaoDesligar, pessoas } from '../../src/sala/textos';
import type { AppState, CallState, SalaDaLigacao } from '../../src/state';

/** O estado do cenário (o `createScenario` monta na hora, com as datas a partir de agora). */
const cenario = (nome: string): AppState => createScenario(nome)!.state;
const ligacaoDe = (nome: string): CallState => cenario(nome).ligacao!;
const salaDoCenario = (nome: string): SalaDaLigacao => ligacaoDe(nome).sala!;

test("arrumacao follows the core's MosaicCells", () => {
  expect(arrumacao(1)).toEqual([{ x: 0, y: 0, largura: 1, altura: 1 }]);
  expect(arrumacao(2)).toEqual([
    { x: 0, y: 0, largura: 0.5, altura: 1 },
    { x: 0.5, y: 0, largura: 0.5, altura: 1 },
  ]);
  expect(arrumacao(3)).toEqual([
    { x: 0, y: 0, largura: 0.5, altura: 0.5 },
    { x: 0.5, y: 0, largura: 0.5, altura: 0.5 },
    { x: 0.25, y: 0.5, largura: 0.5, altura: 0.5 },
  ]);
  expect(arrumacao(4)).toEqual([
    { x: 0, y: 0, largura: 0.5, altura: 0.5 },
    { x: 0.5, y: 0, largura: 0.5, altura: 0.5 },
    { x: 0, y: 0.5, largura: 0.5, altura: 0.5 },
    { x: 0.5, y: 0.5, largura: 0.5, altura: 0.5 },
  ]);
  // A célula de 426 px (o par de 1280/3) e a linha de baixo, de 2, no centro a partir do 214.
  expect(arrumacao(5)).toEqual([
    { x: 0, y: 0, largura: 0.3328125, altura: 0.5 },
    { x: 0.3328125, y: 0, largura: 0.3328125, altura: 0.5 },
    { x: 0.665625, y: 0, largura: 0.3328125, altura: 0.5 },
    { x: 0.1671875, y: 0.5, largura: 0.3328125, altura: 0.5 },
    { x: 0.5, y: 0.5, largura: 0.3328125, altura: 0.5 },
  ]);
  expect(arrumacao(0)).toEqual([]);
  expect(arrumacao(6)).toEqual([]);
  for (let n = 1; n <= 5; n++) {
    for (const q of arrumacao(n)) expect(naLinhaDeBaixo(q), `${n}: ${JSON.stringify(q)}`).toBe(q.y === 0.5);
  }
});

test('salaDe is null on the iPhone, without a call and without a room', () => {
  const comSala = cenario('sala');
  expect(salaDe(comSala)).toEqual(comSala.ligacao!.sala);
  expect(salaDe({ ...comSala, plataforma: 'ios' })).toBeNull();
  expect(salaDe(cenario('principal'))).toBeNull();
  const videochamada = cenario('video');
  expect(salaDe(videochamada)).toBeNull();
  // Um estado montado à mão, de antes da sala, vem sem o campo.
  const { sala: _semSala, ...semCampo } = videochamada.ligacao!;
  expect(salaDe({ ...videochamada, ligacao: semCampo })).toBeNull();
});

test('the room line on top, below and out', () => {
  const onde = (l: CallState, sala: SalaDaLigacao | null) => ({
    emCima: salaEmCima(l, sala),
    embaixo: salaEmbaixo(l, sala),
    fora: foraDaSala(l, sala),
  });
  const emCima = ligacaoDe('sala');
  expect(onde(emCima, emCima.sala!)).toEqual({ emCima: true, embaixo: false, fora: false });
  // Em cima com a ligação de fora em espera embaixo: você está na sala.
  const deVolta = ligacaoDe('sala-de-volta');
  expect(onde(deVolta, deVolta.sala!)).toEqual({ emCima: true, embaixo: false, fora: false });
  // Em cima ainda em espera (a de fora acabando): fora.
  expect(onde({ ...emCima, top: { ...emCima.top, held: true } }, emCima.sala!)).toEqual({ emCima: true, embaixo: false, fora: true });
  const embaixo = ligacaoDe('sala-fora');
  expect(onde(embaixo, embaixo.sala!)).toEqual({ emCima: false, embaixo: true, fora: true });
  expect(onde(ligacaoDe('video'), null)).toEqual({ emCima: false, embaixo: false, fora: false });
});

test('pessoasNaSala counts every guest and you', () => {
  expect(pessoasNaSala(salaDoCenario('sala'))).toBe(3);
  // naSala, chamando, naSala sem imagem e emEspera: os chamados também contam.
  expect(salaDoCenario('sala-estados').participantes.map((p) => [p.estado, p.imagem])).toEqual([
    ['naSala', true],
    ['chamando', false],
    ['naSala', false],
    ['emEspera', false],
  ]);
  expect(pessoasNaSala(salaDoCenario('sala-estados'))).toBe(5);
  expect(pessoasNaSala(salaDoCenario('sala-cheia'))).toBe(6);
  expect(pessoas(1)).toBe('1 pessoa');
  expect(pessoas(6)).toBe('6 pessoas');
});

test('nomesDaSala joins the names like the question', () => {
  const sala = salaDoCenario('sala');
  expect(nomesDaSala({ ...sala, participantes: sala.participantes.slice(0, 1) })).toBe('Ana Souza');
  expect(nomesDaSala(sala)).toBe('Ana Souza e Carlos Lima');
  expect(nomesDaSala(salaDoCenario('sala-grande'))).toBe('Ana Souza, Carlos Lima e Bia Ramos');
  expect(ligacoesVaoDesligar(nomesDaSala(sala))).toBe('As ligações com Ana Souza e Carlos Lima vão desligar.');
  // Um convidado sem nome entra com o número.
  const semNome = { ...sala.participantes[1], id: 41, numero: '2005', nome: '' };
  expect(nomeNaSala(semNome)).toBe('2005');
  expect(nomesDaSala({ ...sala, participantes: [...sala.participantes, semNome] })).toBe('Ana Souza, Carlos Lima e 2005');
});

test('Adicionar pessoa shows in a lone video call and in the room on top, and waits for what the core needs', () => {
  // Cada caso muda uma coisa da videochamada sozinha (o `video`: o vídeo do app ligado, a de cima atendida, com o vídeo
  // ativo e fora da espera, sem a segunda, fora da conferência e da consulta), ou da sala em cima (o `sala`).
  const videochamada = cenario('video');
  const l = videochamada.ligacao!;
  const comLigacao = (ligacao: CallState): AppState => ({ ...videochamada, ligacao });
  const carlos = { ...ligacaoDe('duas-ligacoes').top, video: l.top.video };
  const comSala = cenario('sala');
  const s = comSala.ligacao!;
  const naSala = (ligacao: CallState): AppState => ({ ...comSala, ligacao });
  // A sala embaixo, com a de fora em cima com o vídeo ativo: só a sala embaixo decide.
  const fora = ligacaoDe('sala-fora');
  const casos: Array<[string, AppState, { mostra: boolean; pode: boolean }]> = [
    ['the lone active video call', videochamada, { mostra: true, pode: true }],
    ['the top still calling', comLigacao({ ...l, top: { ...l.top, phase: 'dialing', activeSinceMs: 0 } }), { mostra: true, pode: false }],
    // Cada regra sozinha, mesmo num estado que o núcleo não manda: atendida sem o tempo, a conferência e a consulta sem a
    // segunda.
    ['the top active without its time', comLigacao({ ...l, top: { ...l.top, activeSinceMs: 0 } }), { mostra: true, pode: false }],
    ['only conference', comLigacao({ ...l, conference: true }), { mostra: true, pode: false }],
    ['only consulting', comLigacao({ ...l, consulting: true }), { mostra: true, pode: false }],
    ['the top held', comLigacao({ ...l, top: { ...l.top, held: true } }), { mostra: true, pode: false }],
    ['with a second call', comLigacao({ ...l, second: { ...carlos, held: true }, secondKind: 'held' }), { mostra: true, pode: false }],
    [
      'in a conference',
      comLigacao({ ...l, second: carlos, secondKind: 'active', conference: true, conferenceSinceMs: l.top.activeSinceMs }),
      { mostra: true, pode: false },
    ],
    [
      'in a consultation',
      comLigacao({ ...l, second: { ...carlos, held: true }, secondKind: 'held', consulting: true, colleagueActive: false }),
      { mostra: true, pode: false },
    ],
    [
      'voice only',
      comLigacao({ ...l, top: { ...l.top, video: { ...l.top.video!, ativo: false, imagem: false, camera: false } } }),
      { mostra: false, pode: false },
    ],
    ["the app's video.ligado off", { ...videochamada, video: { ...videochamada.video!, ligado: false } }, { mostra: false, pode: false }],
    ['the iPhone', { ...videochamada, plataforma: 'ios' }, { mostra: false, pode: false }],
    ['the room on top', comSala, { mostra: true, pode: true }],
    ['the room on top, its line held', naSala({ ...s, top: { ...s.top, held: true } }), { mostra: true, pode: false }],
    ['the room on top with fora', naSala({ ...s, sala: { ...s.sala!, fora: true } }), { mostra: true, pode: false }],
    ['the room on top with cheia', naSala({ ...s, sala: { ...s.sala!, cheia: true } }), { mostra: true, pode: false }],
    [
      'the room below',
      naSala({ ...fora, top: { ...fora.top, video: { ...fora.top.video!, ativo: true } } }),
      { mostra: false, pode: false },
    ],
  ];
  for (const [nome, state, esperado] of casos) {
    expect({ mostra: mostraAdicionar(state, state.ligacao!), pode: podeAdicionar(state, state.ligacao!) }, nome).toEqual(esperado);
  }
});

test("the room's Câmera only waits while the room is held", () => {
  const linha = ligacaoDe('sala').top;
  const ligada = linha.video!;
  const desligada = { ...ligada, camera: false };
  const emEspera = { ...linha, held: true };
  // Ligada, ela sempre desliga; desligada, ela só espera a sala sair da espera (a linha da sala nunca está chamando).
  expect(cameraDaSalaDesativada(linha, ligada)).toBe(false);
  expect(cameraDaSalaDesativada(emEspera, ligada)).toBe(false);
  expect(cameraDaSalaDesativada(linha, desligada)).toBe(false);
  expect(cameraDaSalaDesativada(emEspera, desligada)).toBe(true);
});
