// Os testes da conta do sinalizador de qualidade (qualidade.js): a leitura do getStats, a medida entre duas leituras, a
// tabela dos estados, as regras de piorar e melhorar, o medidor, com o relatório, o relógio e a aba de mentira, e os
// textos do botão e do cartão.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVISO_DA_CONEXAO_RUIM,
  INTERVALO_MS,
  LIMITES,
  PAUSA_MS,
  VALIDADE_DO_RELATORIO_MS,
  classificar,
  conta,
  criarMedidor,
  leitura,
  medida,
  numerosDoCartao,
  passo,
  textosDoSinal,
} from '../../internal/pagina/estatico/qualidade.js';

// ---- O relatório de mentira: um Map com os objetos do getStats, como o RTCStatsReport. ----

/**
 * O relatório de uma leitura. agora: o timestamp dos objetos; som e video: os contadores do inbound-rtp de cada tipo
 * ({recebidos, perdidos, imagens}); manda: os pacotes que a página mandou de cada tipo até ali, os packetsSent do
 * outbound-rtp ({audio, video}); sai: os remote-inbound-rtp ({tipo, perda, perdidos (os que o servidor conta desde o
 * começo; sem eles, o navegador não os dá), atraso (em s), ha (ms atrás)}); par: o par
 * de endereços em uso ({atraso (em s), respostas (as respostas que ele já recebeu; sem elas, o navegador não as
 * conta), por: 'transport' | 'selected' | 'nominated'}).
 */
function relatorio({
  agora = 100_000,
  som = null,
  video = null,
  manda = {},
  sai = [],
  par = null,
  outros = [],
} = {}) {
  const r = new Map();
  const por = (o) => r.set(o.id, o);
  for (const [tipo, pacotes] of Object.entries(manda)) {
    por({ id: `out-${tipo}`, type: 'outbound-rtp', kind: tipo, timestamp: agora, packetsSent: pacotes });
  }
  if (som) {
    por({
      id: 'in-som',
      type: 'inbound-rtp',
      kind: 'audio',
      timestamp: agora,
      packetsReceived: som.recebidos,
      packetsLost: som.perdidos,
    });
  }
  if (video) {
    por({
      id: 'in-video',
      type: 'inbound-rtp',
      kind: 'video',
      timestamp: agora,
      packetsReceived: video.recebidos,
      packetsLost: video.perdidos,
      framesDecoded: video.imagens,
    });
  }
  sai.forEach((s, i) => {
    por({
      id: `sai-${i}`,
      type: 'remote-inbound-rtp',
      kind: s.tipo,
      timestamp: agora - (s.ha ?? 0),
      fractionLost: s.perda,
      packetsLost: s.perdidos,
      roundTripTime: s.atraso,
    });
  });
  if (par) {
    const modo = par.por ?? 'transport';
    // Um par nomeado que não deu certo, antes do par em uso: o atraso dele não conta.
    por({
      id: 'par-0',
      type: 'candidate-pair',
      timestamp: agora,
      currentRoundTripTime: 0.7,
      state: 'failed',
      nominated: true,
    });
    if (modo === 'transport') {
      por({ id: 'transporte', type: 'transport', timestamp: agora, selectedCandidatePairId: 'par-1' });
    }
    por({
      id: 'par-1',
      type: 'candidate-pair',
      timestamp: agora,
      currentRoundTripTime: par.atraso,
      responsesReceived: par.respostas,
      selected: modo === 'selected' ? true : undefined,
      nominated: modo === 'nominated' ? true : undefined,
      state: modo === 'nominated' ? 'succeeded' : 'in-progress',
    });
    // Outro par, que também não é o em uso.
    por({
      id: 'par-2',
      type: 'candidate-pair',
      timestamp: agora,
      currentRoundTripTime: 0.9,
      state: 'failed',
      nominated: false,
    });
  }
  for (const o of outros) por(o);
  return r;
}

// O que sai de um tipo, numa leitura: os pacotes que a página mandou até ali, desde quando ela manda sem parar (o
// agora da primeira leitura que a viu mandar), e a perda que o servidor diz do que ela mandou desde então.
const vai = (enviados, perda = null, desde = null) => ({ enviados, desde, perda });
const NAO_VAI = vai(null);
const SEM_NADA = {
  som: null,
  video: null,
  sai: { som: NAO_VAI, video: NAO_VAI },
  relatos: {},
  atraso: null,
  amostras: [],
};
/** A leitura do último relatório de uma sequência, cada uma com a memória da anterior. */
const emCadeia = (...relatorios) => relatorios.reduce((antes, r) => leitura(r, antes), null);

test('os valores da spec', () => {
  assert.equal(INTERVALO_MS, 2000);
  assert.equal(VALIDADE_DO_RELATORIO_MS, 10000);
  assert.equal(PAUSA_MS, 6000);
  assert.deepEqual(LIMITES, { perda: { instavel: 0.02, ruim: 0.08 }, atraso: { instavel: 250, ruim: 500 } });
  assert.ok(Object.isFrozen(LIMITES));
});

test('a leitura', () => {
  const r = relatorio({
    agora: 100_000,
    som: { recebidos: 5000, perdidos: 12 },
    video: { recebidos: 9000, perdidos: 30, imagens: 2500 },
    manda: { audio: 5100, video: 800 },
    sai: [
      { tipo: 'audio', perda: 0.01, atraso: 0.21 },
      { tipo: 'video', perda: 0.04, atraso: 0.3 },
    ],
    par: { atraso: 0.045, respostas: 7 },
  });
  // Sozinha, a leitura não tem memória: não sabe se a página manda (os relatórios do servidor ainda não contam), guarda
  // o que viu de cada relatório para a seguinte, e tem uma amostra só do atraso, que sozinha não conta.
  const visto = { quando: 100_000, perdidos: undefined, base: undefined, temBase: false };
  assert.deepEqual(leitura(r), {
    agora: 100_000,
    som: { recebidos: 5000, perdidos: 12 },
    video: { recebidos: 9000, perdidos: 30, imagens: 2500 },
    sai: { som: vai(5100), video: vai(800) },
    relatos: { 'sai-0': visto, 'sai-1': visto },
    atraso: null,
    amostras: [{ id: 'par-1:7', valor: 45 }],
  });
  // A seguinte, 2 s depois, com a memória dela: a página manda os dois tipos desde esta leitura, e os relatórios do
  // servidor que chegarem daqui em diante contam. O atraso é o menor das duas últimas amostras.
  const depois = relatorio({
    agora: 102_000,
    manda: { audio: 5200, video: 1050 },
    sai: [
      { tipo: 'audio', perda: 0.01, atraso: 0.21, ha: 500 },
      { tipo: 'video', perda: 0.04, atraso: 0.3, ha: 500 },
    ],
    par: { atraso: 0.06, respostas: 8 },
  });
  const segunda = leitura(depois, leitura(r));
  assert.deepEqual(segunda.sai, { som: vai(5200, null, 102_000), video: vai(1050, null, 102_000) });
  assert.equal(segunda.atraso, 45);
  assert.deepEqual(segunda.amostras, [
    { id: 'par-1:7', valor: 45 },
    { id: 'par-1:8', valor: 60 },
  ]);
  const terceira = leitura(
    relatorio({
      agora: 104_000,
      manda: { audio: 5300, video: 1300 },
      sai: [
        { tipo: 'audio', perda: 0.01, ha: 500 },
        { tipo: 'video', perda: 0.04, ha: 500 },
      ],
      par: { atraso: 0.05, respostas: 9 },
    }),
    segunda,
  );
  assert.deepEqual(terceira.sai, { som: vai(5300, 0.01, 102_000), video: vai(1300, 0.04, 102_000) });
  assert.equal(terceira.atraso, 50);
  // A leitura não muda a anterior.
  assert.deepEqual(segunda.amostras.length, 2);
});

test('a leitura: o que a página manda de cada tipo', () => {
  // Os pacotes mandados de cada tipo; mais de um do mesmo tipo são somados (o mediaType é o nome antigo do kind).
  const r = relatorio({
    manda: { audio: 500, video: 20 },
    outros: [{ id: 'out-video-2', type: 'outbound-rtp', mediaType: 'video', timestamp: 100_000, packetsSent: 30 }],
  });
  assert.deepEqual(leitura(r).sai, { som: vai(500), video: vai(50) });
  // A câmera desligada desde o começo: o vídeo vai sem faixa, e o contador dele é zero, e não null.
  assert.deepEqual(leitura(relatorio({ manda: { audio: 500, video: 0 } })).sai.video, vai(0));
  // Sem o contador (ou com um que não é número), o tipo fica sem ele.
  assert.deepEqual(leitura(relatorio({ manda: { audio: undefined, video: Number.NaN } })).sai, {
    som: NAO_VAI,
    video: NAO_VAI,
  });
  // A perda de cada tipo é a do relatório do servidor daquele tipo: a maior, entre os que valem. A página manda os dois
  // desde os 100 s do relatório (a segunda leitura).
  const mandando = (agora, sai) => relatorio({ agora, manda: { audio: agora / 20, video: agora / 8 }, sai });
  const comOsRelatorios = (sai) => emCadeia(mandando(98_000, []), mandando(100_000, []), mandando(110_000, sai)).sai;
  const dois = comOsRelatorios([
    { tipo: 'video', perda: 0.2 },
    { tipo: 'video', perda: 0.5, ha: 3000 },
    { tipo: 'audio', perda: 0.01 },
  ]);
  assert.deepEqual(dois, { som: vai(5500, 0.01, 100_000), video: vai(13_750, 0.5, 100_000) });
  // O relatório de um tipo que não é o som nem o vídeo não entra em nenhum.
  const outroTipo = comOsRelatorios([{ tipo: 'application', perda: 0.9 }, { tipo: undefined, perda: 0.9 }]);
  assert.deepEqual(outroTipo, { som: vai(5500, null, 100_000), video: vai(13_750, null, 100_000) });
  // A perda que não é número, ou negativa, não entra.
  const semPerda = comOsRelatorios([{ tipo: 'audio', perda: undefined }, { tipo: 'video', perda: -1 }]);
  assert.deepEqual(semPerda, { som: vai(5500, null, 100_000), video: vai(13_750, null, 100_000) });
});

// O relatório do servidor que chegou antes de a página começar a mandar não fala do que ela manda. O primeiro relatório
// do FreeSWITCH sobre o vídeo de quem entrou sem câmera diz 255/256, e fica sendo o último por uns 4 s: quem ligava a
// câmera nesse meio tempo via "Conexão ruim", com "Perda: 100%" (visto de ponta a ponta em 19/11, contra o FreeSWITCH
// de verdade).
test('a leitura: o relatório de antes de a página começar a mandar não conta', () => {
  const quaseTudo = 255 / 256;
  const r = (t, video, sai) => relatorio({ agora: 100_000 + t, manda: { audio: 50 + t / 20, video }, sai });
  // A câmera desligada: aos 3 s chega o primeiro relatório do vídeo, de nenhum pacote.
  const aos2 = emCadeia(r(0, 0, []), r(2000, 0, []));
  assert.deepEqual(aos2.sai.video, vai(0));
  // A câmera liga aos 3,5 s. A leitura dos 4 s vê os pacotes andarem: a página manda o vídeo desde ali, e o relatório
  // dos 3 s é de antes.
  const aos4 = leitura(r(4000, 30, [{ tipo: 'video', perda: quaseTudo, ha: 1000 }]), aos2);
  assert.deepEqual(aos4.sai.video, vai(30, null, 104_000));
  // Aos 6 s ele ainda é o último, e continua sendo de antes.
  const aos6 = leitura(r(6000, 180, [{ tipo: 'video', perda: quaseTudo, ha: 3000 }]), aos4);
  assert.deepEqual(aos6.sai.video, vai(180, null, 104_000));
  // O relatório seguinte, dos 7 s, já fala do que a página manda.
  const aos8 = leitura(r(8000, 330, [{ tipo: 'video', perda: 0.03, ha: 1000 }]), aos6);
  assert.deepEqual(aos8.sai.video, vai(330, 0.03, 104_000));
  // O relatório que chega no mesmo instante da leitura que viu os pacotes andarem ainda é de antes.
  const naHora = leitura(r(4000, 30, [{ tipo: 'video', perda: quaseTudo, ha: 0 }]), aos2);
  assert.deepEqual(naHora.sai.video, vai(30, null, 104_000));
  // A câmera desliga: o contador para, e a página deixa de mandar. O relatório dela, que ainda vale, não conta mais.
  const aos10 = leitura(r(10_000, 330, [{ tipo: 'video', perda: 0.3, ha: 500 }]), aos8);
  assert.deepEqual(aos10.sai.video, vai(330));
  // Ligada de novo, a conta recomeça dali: o relatório de antes de ela religar fica de fora.
  const aos12 = leitura(r(12_000, 400, [{ tipo: 'video', perda: 0.3, ha: 2500 }]), aos10);
  assert.deepEqual(aos12.sai.video, vai(400, null, 112_000));
  // O som vai o tempo todo (o microfone desligado também manda): desde a segunda leitura.
  assert.deepEqual(aos12.sai.som, vai(650, null, 102_000));
  // Sem o contador dos mandados numa das leituras (um navegador que não o dá), a página não sabe se manda: não conta
  // contra a pessoa. O contador que andou para trás também não prova que ela manda.
  const com = (antes, depois) =>
    leitura(r(4000, depois, [{ tipo: 'video', perda: 0.3 }]), emCadeia(r(0, 5, []), r(2000, antes, []))).sai.video;
  assert.deepEqual(com(10, undefined), vai(null));
  assert.deepEqual(com(undefined, 250), vai(250));
  assert.deepEqual(com(250, 10), vai(10));
  // Sem a hora no relatório, a página não sabe de quando é o que o servidor diz.
  const semHora = leitura(new Map([['o', { id: 'o', type: 'outbound-rtp', kind: 'video', packetsSent: 99 }]]), aos2);
  assert.deepEqual(semHora.sai.video, vai(99));
});

test('a leitura: o relatório do servidor com mais de 10 s não conta', () => {
  // A página manda os dois tipos desde os 60 s do relatório; a leitura é a dos 100 s.
  const mandando = (agora, sai) => relatorio({ agora, manda: { audio: agora / 20, video: agora / 8 }, sai });
  const com = (ha) =>
    emCadeia(
      mandando(58_000, []),
      mandando(60_000, []),
      mandando(100_000, [{ tipo: 'video', perda: 0.5, ha }, { tipo: 'audio', perda: 0.01, ha: 0 }]),
    ).sai;
  assert.equal(com(10_000).video.perda, 0.5);
  assert.equal(com(10_001).video.perda, null);
  assert.equal(com(10_001).som.perda, 0.01);
  // O agora é o maior timestamp do relatório (aqui, o do som), e não o do relógio da página.
  const antigo = relatorio({
    agora: 70_000,
    som: { recebidos: 1, perdidos: 0 },
    sai: [{ tipo: 'audio', perda: 0.5, ha: 20_000 }],
  });
  assert.equal(leitura(antigo).agora, 70_000);
});

test('a leitura: o atraso', () => {
  // A amostra desta leitura é a última das que ela guarda. Uma só não conta: o atraso é null.
  const amostra = (r) => leitura(r).amostras.at(-1) ?? null;
  assert.equal(leitura(relatorio({ par: { atraso: 0.045 } })).atraso, null);
  // Sem o par em uso, vale o roundTripTime do remote-inbound-rtp do som, e a amostra é a daquele relatório.
  const somDe = (ha) =>
    amostra(relatorio({ som: { recebidos: 1, perdidos: 0 }, sai: [{ tipo: 'audio', perda: 0, atraso: 0.21, ha }] }));
  assert.deepEqual(somDe(0), { id: 'som:100000', valor: 210 });
  assert.deepEqual(somDe(10_000), { id: 'som:90000', valor: 210 });
  assert.equal(somDe(10_001), null);
  // O do vídeo não serve de atraso.
  assert.equal(amostra(relatorio({ sai: [{ tipo: 'video', perda: 0, atraso: 0.3 }] })), null);
  // O par em uso vem primeiro, também quando o som tem o dele. Com a conta das respostas, a amostra é a da resposta.
  const comOsDois = relatorio({
    sai: [{ tipo: 'audio', perda: 0, atraso: 0.21 }],
    par: { atraso: 0.045, respostas: 12 },
  });
  assert.deepEqual(amostra(comOsDois), { id: 'par-1:12', valor: 45 });
  // Sem a conta das respostas (um navegador que não a dá), a página não sabe de qual resposta é a amostra.
  assert.deepEqual(amostra(relatorio({ par: { atraso: 0.045 } })), { id: null, valor: 45 });
  // O par pelo selected (o Firefox), e pelo nominated com succeeded, quando falta o transport.
  assert.equal(amostra(relatorio({ par: { atraso: 0.08, por: 'selected' } })).valor, 80);
  assert.equal(amostra(relatorio({ par: { atraso: 0.12, por: 'nominated' } })).valor, 120);
  // O par em uso sem o número (o Safari pode não dar): cai no do som.
  const semNumero = relatorio({ sai: [{ tipo: 'audio', perda: 0, atraso: 0.21 }], par: { atraso: undefined } });
  assert.equal(amostra(semNumero).valor, 210);
  // O atraso só é arredondado na tela: aqui ele fica como veio, em ms (249,9 ainda não é instável).
  assert.ok(Math.abs(amostra(relatorio({ par: { atraso: 0.2499 } })).valor - 249.9) < 1e-9);
});

// O FreeSWITCH conta um pacote perdido que não existe no fluxo que começa depois do primeiro relatório dele: o primeiro
// relatório (de nenhum pacote) diz 255/256, e o primeiro depois de a câmera ligar diz esse mesmo pacote sobre os poucos
// que chegaram (7/256, com 37 pacotes). A conta dos perdidos desde o começo (o packetsLost) não sobe: é 1 nos dois.
// Medido em 19/11, de ponta a ponta: sem isto, quem ligava a câmera 4,5 s depois de entrar via "Conexão instável".
test('a leitura: o relatório sem pacotes perdidos novos não diz perda', () => {
  const r = (t, video, sai) => relatorio({ agora: 100_000 + t, manda: { audio: 50 + t / 20, video }, sai });
  const doVideo = (perda, perdidos, ha) => ({ tipo: 'video', perda, perdidos, ha });
  // A câmera desligada, o relatório dos 3,16 s, e a câmera ligada aos 4,5 s.
  const aos4 = emCadeia(r(0, 0, []), r(2000, 0, []), r(4000, 0, [doVideo(255 / 256, 1, 840)]));
  const aos6 = leitura(r(6000, 22, [doVideo(255 / 256, 1, 2840)]), aos4);
  assert.deepEqual(aos6.sai.video, vai(22, null, 106_000));
  // O relatório dos 7,17 s chegou depois de a página começar a mandar, e diz 7/256; os perdidos continuam 1: nenhum
  // pacote novo se perdeu, e a perda dele é zero. Lido de novo aos 10 s, é o mesmo.
  const aos8 = leitura(r(8000, 52, [doVideo(7 / 256, 1, 830)]), aos6);
  assert.deepEqual(aos8.sai.video, vai(52, 0, 106_000));
  const aos10 = leitura(r(10_000, 83, [doVideo(7 / 256, 1, 2830)]), aos8);
  assert.deepEqual(aos10.sai.video, vai(83, 0, 106_000));
  // O seguinte, com zero.
  const aos12 = leitura(r(12_000, 113, [doVideo(0, 1, 770)]), aos10);
  assert.deepEqual(aos12.sai.video, vai(113, 0, 106_000));
  // Um relatório com pacotes perdidos novos (de 1 para 6) diz a perda dele, enquanto for o último.
  const aos16 = leitura(r(16_000, 173, [doVideo(0.05, 6, 800)]), aos12);
  assert.deepEqual(aos16.sai.video, vai(173, 0.05, 106_000));
  const aos18 = leitura(r(18_000, 203, [doVideo(0.05, 6, 2800)]), aos16);
  assert.deepEqual(aos18.sai.video, vai(203, 0.05, 106_000));
  // Os perdidos que diminuem (um pacote atrasado que chegou) não são perda nova.
  const aos20 = leitura(r(20_000, 233, [doVideo(0.04, 5, 800)]), aos18);
  assert.deepEqual(aos20.sai.video, vai(233, 0, 106_000));

  // O primeiro relatório que a página vê de um fluxo é só a base da conta, também com ela mandando desde antes.
  const mandando = (t, sai) => r(t, 100 + t / 10, sai);
  const primeiro = emCadeia(mandando(0, []), mandando(2000, []), mandando(4000, [doVideo(0.3, 9, 500)]));
  assert.deepEqual(primeiro.sai.video, vai(500, null, 102_000));
  const segundo = leitura(mandando(8000, [doVideo(0.3, 20, 500)]), primeiro);
  assert.deepEqual(segundo.sai.video, vai(900, 0.3, 102_000));
  // O relatório que venceu (mais de 10 s) não conta, mas continua sendo a base do seguinte.
  const venceu = leitura(mandando(20_000, [doVideo(0.3, 20, 12_500)]), segundo);
  assert.deepEqual(venceu.sai.video, vai(2100, null, 102_000));
  assert.deepEqual(leitura(mandando(22_000, [doVideo(0.1, 20, 500)]), venceu).sai.video, vai(2300, 0, 102_000));
  // Sem a conta dos perdidos (um navegador que não a dá), vale o que o relatório diz, como antes.
  const semOsPerdidos = [{ tipo: 'video', perda: 0.3, ha: 500 }];
  const semConta = emCadeia(mandando(0, []), mandando(2000, []), mandando(4000, semOsPerdidos));
  assert.deepEqual(semConta.sai.video, vai(500, 0.3, 102_000));
  // Dois fluxos do mesmo tipo: cada um com a base dele, e vale a maior perda.
  const dois = (t, a, b) =>
    mandando(t, [
      { tipo: 'video', perda: a[0], perdidos: a[1], ha: 500 },
      { tipo: 'video', perda: b[0], perdidos: b[1], ha: 400 },
    ]);
  const doisFluxos = emCadeia(
    mandando(0, []),
    mandando(2000, []),
    dois(4000, [0.5, 3], [0.5, 8]),
    dois(8000, [0.05, 5], [0.6, 8]),
  );
  assert.deepEqual(doisFluxos.sai.video, vai(900, 0.05, 102_000));
});

// O navegador guarda a última amostra do atraso até chegar a resposta seguinte (uns 2,5 s no par de endereços do
// Chromium, uns 5 s no relatório do som): duas leituras seguidas podem ver a mesma. O atraso que conta é o menor das
// duas últimas amostras diferentes: uma amostra alta sozinha, lida duas vezes, não é uma conexão ruim.
test('a leitura: o atraso que conta é o menor das duas últimas amostras', () => {
  const par = (agora, atraso, respostas) => relatorio({ agora, par: { atraso, respostas } });
  const ids = (l) => l.amostras.map((a) => a.id);
  // A mesma resposta lida de novo é a mesma amostra.
  const duas = emCadeia(par(100_000, 0.04, 3), par(102_000, 0.6, 4));
  assert.equal(duas.atraso, 40);
  const repetida = leitura(par(104_000, 0.6, 4), duas);
  assert.equal(repetida.atraso, 40);
  assert.deepEqual(ids(repetida), ['par-1:3', 'par-1:4']);
  // A resposta seguinte, também alta: agora são duas, e o atraso alto conta.
  const outraAlta = leitura(par(106_000, 0.55, 5), repetida);
  assert.equal(outraAlta.atraso, 550);
  assert.deepEqual(ids(outraAlta), ['par-1:4', 'par-1:5']);
  // Uma boa depois: o menor das duas.
  assert.equal(leitura(par(108_000, 0.04, 6), outraAlta).atraso, 40);
  // Sem a conta das respostas, cada leitura é uma amostra (também com o mesmo valor: um atraso que não muda).
  const semConta = emCadeia(par(100_000, 0.04), par(102_000, 0.04));
  assert.equal(semConta.atraso, 40);
  assert.deepEqual(ids(semConta), [null, null]);
  assert.equal(leitura(par(104_000, 0.6), semConta).atraso, 40);
  assert.equal(emCadeia(par(100_000, 0.6), par(102_000, 0.6)).atraso, 600);
  // Pelo relatório do som, a amostra é o relatório: o mesmo, lido de novo, é uma só.
  const doSom = (agora, atraso, ha) => relatorio({ agora, sai: [{ tipo: 'audio', perda: 0, atraso, ha }] });
  const umRelatorio = emCadeia(doSom(100_000, 0.04, 0), doSom(102_000, 0.6, 1000), doSom(104_000, 0.6, 3000));
  assert.equal(umRelatorio.atraso, 40);
  assert.equal(leitura(doSom(106_000, 0.7, 0), umRelatorio).atraso, 600);
  // Do par para o som (o par deixou de dar o número): é outra amostra.
  assert.deepEqual(ids(emCadeia(par(100_000, 0.04, 3), doSom(102_000, 0.05, 0))), ['par-1:3', 'som:102000']);
  // A leitura sem amostra nenhuma esquece as de antes: o atraso volta a precisar de duas.
  const sumiu = leitura(relatorio({ agora: 104_000 }), duas);
  assert.deepEqual(sumiu.amostras, []);
  assert.equal(sumiu.atraso, null);
  assert.equal(leitura(par(106_000, 0.04, 9), sumiu).atraso, null);
});

test('a leitura: o que falta e o que não é número', () => {
  assert.deepEqual(leitura(relatorio()), { agora: null, ...SEM_NADA });
  assert.deepEqual(leitura(new Map()), { agora: null, ...SEM_NADA });
  for (const semRelatorio of [null, undefined]) assert.equal(leitura(semRelatorio), null);
  // Só o som: o vídeo é null, e não zeros.
  const soOSom = leitura(relatorio({ som: { recebidos: 10, perdidos: 0 } }));
  assert.deepEqual(soOSom, { agora: 100_000, ...SEM_NADA, som: { recebidos: 10, perdidos: 0 } });
  // Um contador que não é número deixa o tipo sem número; as imagens que faltam ficam null.
  assert.equal(leitura(relatorio({ som: { recebidos: undefined, perdidos: 0 } })).som, null);
  assert.equal(leitura(relatorio({ som: { recebidos: 10, perdidos: NaN } })).som, null);
  const semImagens = leitura(relatorio({ video: { recebidos: 10, perdidos: 1 } })).video;
  assert.deepEqual(semImagens, { recebidos: 10, perdidos: 1, imagens: null });
  // Mais de um do mesmo tipo são somados (o mediaType é o nome antigo do kind).
  const dois = relatorio({
    som: { recebidos: 100, perdidos: 1 },
    outros: [
      {
        id: 'in-som-2',
        type: 'inbound-rtp',
        mediaType: 'audio',
        timestamp: 100_500,
        packetsReceived: 50,
        packetsLost: 2,
      },
    ],
  });
  assert.deepEqual(leitura(dois).som, { recebidos: 150, perdidos: 3 });
  assert.equal(leitura(dois).agora, 100_500);
  // O que não é de nenhum tipo conhecido não atrapalha.
  const estranhos = relatorio({ outros: [{ id: 'x', type: 'codec', timestamp: 5 }, { id: 'y' }] });
  assert.deepEqual(leitura(estranhos), { agora: 5, ...SEM_NADA });
});

// Uma leitura já pronta, para os testes da medida. O sai leva só o tipo que o teste diz: { som } ou { video }.
const L = (campos = {}) => ({ agora: 0, ...SEM_NADA, ...campos, sai: { ...SEM_NADA.sai, ...campos.sai } });
const som = (recebidos, perdidos = 0) => ({ recebidos, perdidos });
const video = (recebidos, perdidos = 0, imagens = recebidos / 10) => ({ recebidos, perdidos, imagens });

test('a medida: a perda do que chega', () => {
  // 100 pacotes de som novos e 10 perdidos novos: 10 em 110.
  const m = medida(L({ som: som(1000, 5) }), L({ som: som(1100, 15) }));
  assert.deepEqual(m, { perda: 10 / 110, atraso: null, nadaChegou: false });
  // Sem perda nenhuma, a perda é zero, e não null.
  assert.equal(medida(L({ som: som(1000, 5) }), L({ som: som(1100, 5) })).perda, 0);
  // Vale a maior: o som com 1%, o vídeo com 5% e a que sai com 3%.
  const maior = medida(
    L({ som: som(0), video: video(0), sai: { video: vai(0) } }),
    L({ som: som(99, 1), video: video(95, 5), sai: { video: vai(250, 0.03) } }),
  );
  assert.equal(maior.perda, 0.05);
});

test('a medida: a perda do que sai', () => {
  // A que a leitura de agora traz do som (a que o servidor diz do que a página manda): vale sozinha, e quando é a
  // maior.
  assert.equal(medida(L({ sai: { som: vai(0) } }), L({ sai: { som: vai(100, 0.03) } })).perda, 0.03);
  const comOSom = medida(
    L({ som: som(0), sai: { som: vai(1000) } }),
    L({ som: som(99, 1), sai: { som: vai(1100, 0.2) } }),
  );
  assert.equal(comOSom.perda, 0.2);
  // A maior entre a do som e a do vídeo.
  const osDois = (somDepois, videoDepois) =>
    medida(L({ sai: { som: vai(0), video: vai(0) } }), L({ sai: { som: somDepois, video: videoDepois } })).perda;
  assert.equal(osDois(vai(100, 0.01), vai(250, 0.04)), 0.04);
  assert.equal(osDois(vai(100, 0.06), vai(250, 0.04)), 0.06);
  // É a da leitura de agora, e não a da anterior.
  assert.equal(medida(L({ sai: { som: vai(0, 0.5) } }), L({ sai: { som: vai(100) } })).perda, null);
});

// O servidor de vídeo manda o relatório de volta também do que a página não manda. Com a câmera desligada, o vídeo vai
// sem faixa, e o primeiro relatório do FreeSWITCH sobre ele conta um pacote perdido, que de nenhum é 255/256: quem
// entrava sem câmera via "Conexão ruim" 5 s depois (medido em 19/11, contra o FreeSWITCH de verdade).
test('a medida: a perda que o servidor diz do que a página não manda não conta', () => {
  const quaseTudo = 255 / 256;
  const r = (t, manda, sai, som) => relatorio({ agora: 100_000 + t, som, manda, sai });
  const tres = (manda, sai) => {
    const l0 = leitura(r(0, manda(0), [], { recebidos: 1000, perdidos: 0 }));
    const l2 = leitura(r(2000, manda(1), [], { recebidos: 1100, perdidos: 0 }), l0);
    const l4 = leitura(r(4000, manda(2), sai, { recebidos: 1200, perdidos: 0 }), l2);
    return medida(l2, l4);
  };
  const relatorios = [
    { tipo: 'audio', perda: 1 / 256, ha: 500 },
    { tipo: 'video', perda: quaseTudo, ha: 500 },
  ];
  // A câmera desligada desde o começo: nenhum pacote de vídeo mandado.
  const semCamera = tres((i) => ({ audio: 1000 + 100 * i, video: 0 }), relatorios);
  assert.equal(semCamera.perda, 1 / 256);
  assert.equal(classificar(semCamera), 'boa');
  // A câmera ligada: os pacotes andam, e a perda conta.
  const ligada = tres((i) => ({ audio: 1000 + 100 * i, video: 500 + i }), relatorios);
  assert.equal(ligada.perda, quaseTudo);
  assert.equal(classificar(ligada), 'ruim');
  // O som que não anda (um navegador que parou de mandar): a perda dele não conta.
  assert.equal(tres(() => ({ audio: 700, video: 0 }), [{ tipo: 'audio', perda: 0.3, ha: 500 }]).perda, 0);
  // O tipo que não manda não tira a perda do que manda.
  const soOSom = tres((i) => ({ audio: 1000 + 100 * i, video: 0 }), [
    { tipo: 'audio', perda: 0.1, ha: 500 },
    { tipo: 'video', perda: quaseTudo, ha: 500 },
  ]);
  assert.equal(soOSom.perda, 0.1);
});

test('a medida: os contadores que não dão número', () => {
  // Os perdidos que diminuem (um pacote atrasado que chegou) contam zero.
  assert.equal(medida(L({ som: som(1000, 20) }), L({ som: som(1100, 15) })).perda, 0);
  // O contador dos recebidos que andou para trás não dá número, e não é "nada chegou".
  const paraTras = medida(L({ som: som(1000, 5) }), L({ som: som(10, 0) }));
  assert.deepEqual(paraTras, { perda: null, atraso: null, nadaChegou: false });
  // Sem pacote novo nenhum, aquele tipo não dá número: vale o outro.
  const soOVideo = medida(L({ som: som(1000), video: video(1000) }), L({ som: som(1000), video: video(1090, 10) }));
  assert.equal(soOVideo.perda, 0.1);
  // O tipo que só uma das leituras tem não entra.
  assert.equal(medida(L({ som: som(1000) }), L({ som: som(1100), video: video(100, 100) })).perda, 0);
  assert.equal(medida(L({ video: video(100) }), L({ som: som(1100, 500) })).perda, null);
  // Sem leitura anterior, não há medida.
  assert.equal(medida(null, L({ som: som(10) })), null);
  assert.equal(medida(L({ som: som(10) }), null), null);
});

test('a medida: o atraso é o da leitura de agora', () => {
  assert.equal(medida(L({ atraso: 400 }), L({ atraso: 45 })).atraso, 45);
  assert.equal(medida(L({ atraso: 400 }), L()).atraso, null);
});

test('a medida: nada chegou', () => {
  // A leitura de antes: 1.000 pacotes de som, 900 de vídeo e 90 imagens.
  const antes = L({ som: som(1000), video: video(900, 0, 90) });
  const com = (somDepois, videoDepois) => medida(antes, L({ som: somDepois, video: videoDepois }));
  // Nenhum pacote de som novo e nenhuma imagem nova.
  assert.deepEqual(com(som(1000), video(900, 0, 90)), { perda: null, atraso: null, nadaChegou: true });
  // Com o som chegando e a imagem parada, não: a imagem que para sozinha não entra na conta.
  assert.equal(com(som(1100), video(950, 0, 90)).nadaChegou, false);
  // Com a imagem chegando e o som parado, também não.
  assert.equal(com(som(1000), video(950, 0, 95)).nadaChegou, false);
  // Os pacotes de vídeo que chegam sem virar imagem, com o som parado: nada chegou para a pessoa.
  assert.equal(com(som(1000), video(950, 0, 90)).nadaChegou, true);
  // Só os tipos que as duas leituras têm; sem nenhum, é falso.
  assert.equal(medida(L({ som: som(1000) }), L({ som: som(1000) })).nadaChegou, true);
  assert.equal(medida(L({ som: som(1000) }), L({ som: som(1000), video: video(900, 0, 90) })).nadaChegou, true);
  assert.equal(medida(L(), L()).nadaChegou, false);
  assert.equal(medida(L({ som: som(1000) }), L({ video: video(900, 0, 90) })).nadaChegou, false);
  // Sem a conta das imagens (um navegador que não a dá), valem os pacotes do vídeo.
  const semImagens = (pacotesAntes, pacotesDepois) =>
    medida(
      L({ som: som(1000), video: video(pacotesAntes, 0, null) }),
      L({ som: som(1000), video: video(pacotesDepois, 0, null) }),
    ).nadaChegou;
  assert.equal(semImagens(900, 900), true);
  assert.equal(semImagens(900, 950), false);
  // O contador que andou para trás não prova que nada chegou.
  assert.equal(medida(L({ som: som(1000) }), L({ som: som(10) })).nadaChegou, false);
});

test('a tabela', () => {
  const de = (perda, atraso = null, nadaChegou = false) => classificar({ perda, atraso, nadaChegou });
  // A perda: 2% é instável, e 8% é ruim.
  assert.equal(de(0), 'boa');
  assert.equal(de(0.0199), 'boa');
  assert.equal(de(0.02), 'instavel');
  assert.equal(de(0.0799), 'instavel');
  assert.equal(de(0.08), 'ruim');
  assert.equal(de(1), 'ruim');
  // O atraso: 250 ms é instável, e 500 ms é ruim.
  assert.equal(de(null, 0), 'boa');
  assert.equal(de(null, 249.9), 'boa');
  assert.equal(de(null, 250), 'instavel');
  assert.equal(de(null, 499.9), 'instavel');
  assert.equal(de(null, 500), 'ruim');
  // Vale o pior dos dois.
  assert.equal(de(0.01, 300), 'instavel');
  assert.equal(de(0.03, 100), 'instavel');
  assert.equal(de(0.01, 600), 'ruim');
  assert.equal(de(0.1, 100), 'ruim');
  assert.equal(de(0.01, 100), 'boa');
  // Um número só decide.
  assert.equal(de(0.1, null), 'ruim');
  assert.equal(de(null, 300), 'instavel');
  // Nada chegou é ruim, com ou sem os números.
  assert.equal(de(null, null, true), 'ruim');
  assert.equal(de(0, 10, true), 'ruim');
  // Sem número nenhum, com alguma coisa chegando.
  assert.equal(de(null, null), 'semNumero');
});

// O estado mostrado depois de uma sequência de medidas, a partir de uma conta.
const depoisDe = (c, ...classes) => classes.reduce((d, classe) => passo(d, classe), c);
const mostrado = (...classes) => depoisDe(conta(), ...classes).mostrado;
// Uma conta que já mostra o estado: duas medidas dele.
const mostrando = (estado) => depoisDe(conta(), estado, estado);

test('medindo nas 2 primeiras medidas', () => {
  assert.deepEqual(conta(), { mostrado: 'medindo', ultimas: [], semNumero: 0 });
  assert.equal(mostrado('boa'), 'medindo');
  assert.equal(mostrado('boa', 'boa'), 'boa');
  assert.equal(mostrado('ruim'), 'medindo');
  // A menos ruim das duas primeiras.
  assert.equal(mostrado('boa', 'ruim'), 'boa');
  assert.equal(mostrado('ruim', 'boa'), 'boa');
  assert.equal(mostrado('instavel', 'ruim'), 'instavel');
  assert.equal(mostrado('ruim', 'ruim'), 'ruim');
  assert.equal(mostrado('instavel', 'instavel'), 'instavel');
  // O passo não muda a conta que recebe.
  const c = conta();
  passo(c, 'ruim');
  assert.deepEqual(c, conta());
});

test('piora com 2', () => {
  const boa = mostrando('boa');
  assert.equal(depoisDe(boa, 'ruim').mostrado, 'boa');
  assert.equal(depoisDe(boa, 'ruim', 'ruim').mostrado, 'ruim');
  // A menos ruim das duas; mais uma ruim, e é ruim.
  assert.equal(depoisDe(boa, 'instavel', 'ruim').mostrado, 'instavel');
  assert.equal(depoisDe(boa, 'ruim', 'instavel').mostrado, 'instavel');
  assert.equal(depoisDe(boa, 'instavel', 'ruim', 'ruim').mostrado, 'ruim');
  // Uma boa no meio: as duas últimas não são as duas piores.
  assert.equal(depoisDe(boa, 'ruim', 'boa', 'ruim').mostrado, 'boa');
  // De instável, só a ruim é pior.
  const instavel = mostrando('instavel');
  assert.equal(depoisDe(instavel, 'ruim', 'instavel').mostrado, 'instavel');
  assert.equal(depoisDe(instavel, 'ruim', 'ruim').mostrado, 'ruim');
});

test('melhora com 5', () => {
  const ruim = mostrando('ruim');
  assert.equal(depoisDe(ruim, 'boa', 'boa', 'boa', 'boa').mostrado, 'ruim');
  // De ruim, cinco boas levam direto a boa.
  assert.equal(depoisDe(ruim, 'boa', 'boa', 'boa', 'boa', 'boa').mostrado, 'boa');
  // A pior das cinco.
  assert.equal(depoisDe(ruim, 'boa', 'boa', 'instavel', 'boa', 'boa').mostrado, 'instavel');
  assert.equal(depoisDe(ruim, 'instavel', 'instavel', 'instavel', 'instavel', 'instavel').mostrado, 'instavel');
  // Uma ruim no meio recomeça a conta das cinco.
  assert.equal(depoisDe(ruim, 'boa', 'boa', 'ruim', 'boa', 'boa', 'boa', 'boa').mostrado, 'ruim');
  assert.equal(depoisDe(ruim, 'boa', 'boa', 'ruim', 'boa', 'boa', 'boa', 'boa', 'boa').mostrado, 'boa');
  // De instável para boa também são cinco.
  const instavel = mostrando('instavel');
  assert.equal(depoisDe(instavel, 'boa', 'boa', 'boa', 'boa').mostrado, 'instavel');
  assert.equal(depoisDe(instavel, 'boa', 'boa', 'boa', 'boa', 'boa').mostrado, 'boa');
  // E a que acabou de piorar não melhora com as medidas boas de antes da piora.
  const piorou = depoisDe(conta(), 'boa', 'boa', 'boa', 'boa', 'boa', 'ruim', 'ruim');
  assert.equal(piorou.mostrado, 'ruim');
  assert.equal(depoisDe(piorou, 'boa', 'boa', 'boa', 'boa').mostrado, 'ruim');
  assert.equal(depoisDe(piorou, 'boa', 'boa', 'boa', 'boa', 'boa').mostrado, 'boa');
});

test('a medida sem número não conta', () => {
  const boa = mostrando('boa');
  // Nem para piorar: a ruim, a sem número e a ruim são duas ruins seguidas.
  assert.equal(depoisDe(boa, 'ruim', 'semNumero', 'ruim').mostrado, 'ruim');
  // Sozinha, não muda nada.
  assert.equal(depoisDe(boa, 'semNumero').mostrado, 'boa');
  assert.deepEqual(depoisDe(boa, 'semNumero', 'boa'), depoisDe(boa, 'boa'));
  // Nem para melhorar: ela não é uma das cinco.
  const ruim = mostrando('ruim');
  assert.equal(depoisDe(ruim, 'boa', 'boa', 'semNumero', 'boa', 'boa').mostrado, 'ruim');
  assert.equal(depoisDe(ruim, 'boa', 'boa', 'semNumero', 'boa', 'boa', 'boa').mostrado, 'boa');
  // Duas seguidas: medindo. Depois, são precisas duas medidas com número de novo.
  const medindo = depoisDe(boa, 'semNumero', 'semNumero');
  assert.deepEqual(medindo, { mostrado: 'medindo', ultimas: [], semNumero: 2 });
  assert.equal(depoisDe(medindo, 'semNumero').mostrado, 'medindo');
  assert.equal(depoisDe(medindo, 'ruim').mostrado, 'medindo');
  assert.equal(depoisDe(medindo, 'ruim', 'ruim').mostrado, 'ruim');
  assert.equal(depoisDe(medindo, 'boa', 'semNumero', 'boa').mostrado, 'boa');
});

// ---- O critério 6, com leituras falsas: a cada 2 s, 100 pacotes de som e 250 de vídeo. ----

test('o critério 6, com leituras falsas', () => {
  let agora = 0;
  let contadores = { som: som(0), video: video(0, 0, 0) };
  // Mais uma leitura, 2 s depois, com a fração de perda nos dois.
  const ler = (perda) => {
    agora += INTERVALO_MS;
    const perdidosDoSom = Math.round(100 * perda);
    const perdidosDoVideo = Math.round(250 * perda);
    contadores = {
      som: som(contadores.som.recebidos + 100 - perdidosDoSom, contadores.som.perdidos + perdidosDoSom),
      video: video(
        contadores.video.recebidos + 250 - perdidosDoVideo,
        contadores.video.perdidos + perdidosDoVideo,
        contadores.video.imagens + 50,
      ),
    };
    return L({ agora, ...contadores, atraso: 40 });
  };
  let c = conta();
  let anterior = ler(0);
  const mais = (perda) => {
    const l = ler(perda);
    c = passo(c, classificar(medida(anterior, l)));
    anterior = l;
    return c.mostrado;
  };
  // A rede boa: medindo na primeira medida, boa na segunda.
  assert.deepEqual([mais(0), mais(0)], ['medindo', 'boa']);
  // 10% de perda: ruim em até 5 leituras (10 s) a partir da primeira com perda.
  const comPerda = [mais(0.1), mais(0.1), mais(0.1), mais(0.1), mais(0.1)];
  assert.ok(comPerda.indexOf('ruim') >= 0 && comPerda.indexOf('ruim') < 5, comPerda.join());
  assert.equal(comPerda.at(-1), 'ruim');
  // A rede boa de novo: boa em até 10 leituras (20 s).
  const semPerda = Array.from({ length: 10 }, () => mais(0));
  assert.ok(semPerda.indexOf('boa') >= 0 && semPerda.indexOf('boa') < 10, semPerda.join());
  assert.equal(semPerda.at(-1), 'boa');
  // Os tempos de verdade: a piora na segunda medida (4 s), e a melhora na quinta (10 s).
  assert.equal(comPerda.indexOf('ruim'), 1);
  assert.equal(semPerda.indexOf('boa'), 4);
});

// ---- O medidor, com o ler, o relógio e a aba de mentira. ----

/** O relógio de mentira: os depois ficam guardados, e o andar roda os que venceram, na ordem. */
function relogioFalso() {
  let agora = 0;
  let marcados = [];
  return {
    agora: () => agora,
    depois(ms, fn) {
      marcados.push({ quando: agora + ms, fn });
    },
    /** Anda o tempo, rodando o que vence, e deixa as promessas de cada um acabarem. */
    async andar(ms) {
      const fim = agora + ms;
      for (;;) {
        marcados.sort((a, b) => a.quando - b.quando);
        if (marcados.length === 0 || marcados[0].quando > fim) break;
        const { quando, fn } = marcados.shift();
        agora = quando;
        fn();
        await assentar();
      }
      agora = fim;
      await assentar();
    },
    marcados: () => marcados.length,
  };
}

/** Deixa as promessas pendentes acabarem. */
const assentar = () => new Promise((r) => setImmediate(r));

/** A bancada do medidor: as leituras que o teste dá, as medidas que o medidor devolveu, e a aba. */
function bancada() {
  const relogio = relogioFalso();
  const b = {
    relogio,
    visivel: true,
    lidas: 0,
    medidas: [],
    /** O que a próxima leitura devolve: um relatório, null, ou uma função que devolve a promessa. */
    proximo: () => relatorioQueAnda(b),
    pacotes: 0,
    perda: 0,
  };
  b.medidor = criarMedidor({
    ler: () => {
      b.lidas += 1;
      return b.proximo();
    },
    relogio,
    visivel: () => b.visivel,
    aoMedir: (m) => b.medidas.push(m),
  });
  return b;
}

/** Um relatório com mais 100 pacotes de som que o anterior, com a perda da bancada, e o atraso de 40 ms. */
function relatorioQueAnda(b) {
  b.pacotes += 100;
  b.perdidos = (b.perdidos ?? 0) + Math.round(100 * b.perda);
  return Promise.resolve(
    relatorio({ agora: b.relogio.agora(), som: { recebidos: b.pacotes, perdidos: b.perdidos }, par: { atraso: 0.04 } }),
  );
}

// O que o FreeSWITCH de verdade mandou a quem entrou com a câmera desligada, medido em 19/11 no teste de ponta a ponta:
// o primeiro relatório dele sobre o vídeo, que a página não manda, chega 3 s depois da entrada com a perda de 255/256
// (um pacote perdido de nenhum), e só é trocado por outro, com zero, segundos depois. O do som diz 1/256.
test('quem entra sem câmera vai do Medindo à Conexão boa, sem passar pela ruim', async () => {
  const b = bancada();
  b.proximo = () => {
    const t = b.relogio.agora();
    b.pacotes += 100;
    const sai = [];
    if (t >= 3000) sai.push({ tipo: 'audio', perda: t < 8000 ? 1 / 256 : 0, ha: (t - 3000) % 5000 });
    if (t >= 3000 && t < 7000) sai.push({ tipo: 'video', perda: 255 / 256, ha: t - 3000 });
    if (t >= 7000) sai.push({ tipo: 'video', perda: 0, ha: (t - 7000) % 2000 });
    return relatorio({
      agora: 100_000 + t,
      som: { recebidos: b.pacotes, perdidos: 0 },
      video: { recebidos: b.pacotes / 2, perdidos: 0, imagens: b.pacotes / 2 },
      manda: { audio: b.pacotes, video: 0 },
      sai,
      par: { atraso: 0.001 },
    });
  };
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(20_000);
  assert.equal(b.medidas.length, 10);
  assert.deepEqual([...new Set(b.medidas.map((m) => m.estado))], ['medindo', 'boa']);
  assert.deepEqual(
    b.medidas.filter((m) => m.perda >= LIMITES.perda.instavel),
    [],
  );
  // A mesma entrada com a câmera ligada (o vídeo indo) e o mesmo relatório: aí a perda é do que a pessoa manda.
  const c = bancada();
  c.proximo = () => {
    const t = c.relogio.agora();
    c.pacotes += 100;
    return relatorio({
      agora: 100_000 + t,
      som: { recebidos: c.pacotes, perdidos: 0 },
      manda: { audio: c.pacotes, video: c.pacotes * 2 },
      sai: t >= 3000 ? [{ tipo: 'video', perda: 255 / 256, ha: (t - 3000) % 2000 }] : [],
      par: { atraso: 0.001 },
    });
  };
  c.medidor.medir(true);
  await assentar();
  await c.relogio.andar(20_000);
  assert.equal(c.medidas.at(-1).estado, 'ruim');
});

test('o medidor', async () => {
  const b = bancada();
  assert.equal(b.lidas, 0);
  // A primeira leitura sai na hora do medir(true); ela é só a base, e não dá medida.
  b.medidor.medir(true);
  await assentar();
  assert.equal(b.lidas, 1);
  assert.deepEqual(b.medidas, []);
  // As outras, a cada 2.000 ms; cada medida chama o aoMedir com o estado e os números.
  await b.relogio.andar(1999);
  assert.equal(b.lidas, 1);
  await b.relogio.andar(1);
  assert.equal(b.lidas, 2);
  assert.deepEqual(b.medidas, [{ estado: 'medindo', perda: 0, atraso: 40 }]);
  await b.relogio.andar(2000);
  assert.deepEqual(b.medidas.at(-1), { estado: 'boa', perda: 0, atraso: 40 });
  // A perda de 10% aparece nos números na hora, e no estado depois de duas medidas.
  b.perda = 0.1;
  await b.relogio.andar(2000);
  assert.equal(b.medidas.at(-1).estado, 'boa');
  assert.ok(Math.abs(b.medidas.at(-1).perda - 10 / 110) < 1e-9);
  await b.relogio.andar(2000);
  assert.equal(b.medidas.at(-1).estado, 'ruim');
  assert.equal(b.lidas, 5);
  assert.equal(b.medidas.length, 4);

  // Depois do medir(false), mais nenhuma leitura e mais nenhum aoMedir.
  b.medidor.medir(false);
  await b.relogio.andar(10_000);
  assert.equal(b.lidas, 5);
  assert.equal(b.medidas.length, 4);
});

test('o medidor: a leitura que estava no ar quando ele para não vira medida', async () => {
  const b = bancada();
  b.medidor.medir(true);
  await assentar();
  // A segunda leitura fica no ar: a promessa dela só acaba depois do medir(false).
  let soltar;
  b.proximo = () => new Promise((r) => (soltar = () => r(relatorio({ som: { recebidos: 999, perdidos: 0 } }))));
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 2);
  b.medidor.medir(false);
  soltar();
  await assentar();
  assert.deepEqual(b.medidas, []);
});

test('o medidor: a leitura de uma ligação que acabou não é a base da seguinte', async () => {
  const b = bancada();
  b.medidor.medir(true);
  await assentar();
  // A segunda leitura fica no ar; a ligação cai e volta, e só então a leitura antiga chega, antes da primeira da nova.
  const normal = b.proximo;
  let soltar;
  b.proximo = () => new Promise((r) => (soltar = () => r(relatorio({ som: { recebidos: 50_000, perdidos: 0 } }))));
  await b.relogio.andar(2000);
  b.medidor.medir(false);
  let soltarANova;
  b.proximo = () => new Promise((r) => (soltarANova = () => r(relatorio({ som: { recebidos: 10, perdidos: 0 } }))));
  b.medidor.medir(true);
  await assentar();
  soltar();
  await assentar();
  soltarANova();
  await assentar();
  // A primeira leitura da ligação nova é só a base: não há medida entre as duas ligações.
  assert.deepEqual(b.medidas, []);
  b.proximo = normal;
  await b.relogio.andar(2000);
  assert.equal(b.medidas.length, 1);
});

test('o medidor: ligar de novo começa do zero', async () => {
  const b = bancada();
  b.medidor.medir(true);
  b.perda = 0.1;
  await assentar();
  await b.relogio.andar(4000);
  assert.equal(b.medidas.at(-1).estado, 'ruim');
  b.medidor.medir(false);
  // A ligação voltou: uma conta nova, e a primeira leitura na hora, de novo só de base.
  b.perda = 0;
  b.medidor.medir(true);
  await assentar();
  assert.equal(b.lidas, 4);
  assert.equal(b.medidas.length, 2);
  await b.relogio.andar(2000);
  assert.equal(b.medidas.at(-1).estado, 'medindo');
  await b.relogio.andar(2000);
  assert.equal(b.medidas.at(-1).estado, 'boa');
  // O medir(true) repetido não começa outra roda de leituras, nem zera a conta.
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 7);
  assert.equal(b.medidas.at(-1).estado, 'boa');
  // E o que sobrou do primeiro ligar não lê mais nada: uma leitura por intervalo.
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 8);
});

test('a aba escondida', async () => {
  const b = bancada();
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(4000);
  assert.equal(b.medidas.at(-1).estado, 'boa');
  assert.equal(b.lidas, 3);
  // Escondida, o medidor não lê.
  b.visivel = false;
  await b.relogio.andar(60_000);
  assert.equal(b.lidas, 3);
  assert.equal(b.medidas.length, 2);
  // Enquanto ela esteve escondida, muita coisa se perdeu: 500 pacotes perdidos de uma vez.
  b.perdidos = 500;
  // Quando ela volta, a primeira leitura não dá medida (é só a base), e o estado mostrado continua o de antes.
  b.visivel = true;
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 4);
  assert.equal(b.medidas.length, 2);
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 5);
  assert.deepEqual(b.medidas.at(-1), { estado: 'boa', perda: 0, atraso: 40 });
});

test('o ler que falha', async () => {
  const b = bancada();
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(4000);
  assert.equal(b.medidas.length, 2);
  // A promessa recusada, o relatório null, e o ler que lança: nenhum vira medida, e o medidor continua. A leitura
  // seguinte que dá certo mede contra a última que deu certo.
  const normal = b.proximo;
  const falhas = [
    () => Promise.reject(new Error('sem a ligação')),
    () => Promise.resolve(null),
    () => {
      throw new Error('o getStats não existe');
    },
  ];
  for (const [i, falha] of falhas.entries()) {
    b.proximo = falha;
    await b.relogio.andar(2000);
    assert.equal(b.medidas.length, 2 + i);
    b.proximo = normal;
    await b.relogio.andar(2000);
    assert.equal(b.medidas.length, 3 + i);
    assert.deepEqual(b.medidas.at(-1), { estado: 'boa', perda: 0, atraso: 40 });
  }
  assert.equal(b.lidas, 9);
  // O aoMedir que lança também não para o medidor.
  const c = bancada();
  let chamadas = 0;
  c.medidor = criarMedidor({
    ler: () => relatorioQueAnda(c),
    relogio: c.relogio,
    visivel: () => true,
    aoMedir: () => {
      chamadas += 1;
      throw new Error('a tela quebrou');
    },
  });
  c.medidor.medir(true);
  await assentar();
  await c.relogio.andar(6000);
  assert.equal(chamadas, 3);
});

// O mesmo começo, com a câmera ligada aos 3,5 s: o relatório dos 3 s, de antes de ela ligar, ainda é o último quando
// a página já manda o vídeo. Visto de ponta a ponta em 19/11: "Conexão ruim", com "Perda: 100%", 7 s depois da entrada.
test('quem entra sem câmera e a liga logo depois não passa pela ruim', async () => {
  const b = bancada();
  b.proximo = () => {
    const t = b.relogio.agora();
    b.pacotes += 100;
    const sai = [];
    if (t >= 3000) sai.push({ tipo: 'audio', perda: t < 8000 ? 1 / 256 : 0, perdidos: 1, ha: (t - 3000) % 5000 });
    // Os três primeiros relatórios do vídeo, como o FreeSWITCH os mandou: o de nenhum pacote, o primeiro depois de a
    // câmera ligar (o pacote que não existe, sobre os poucos que chegaram), e os de zero. Os perdidos são sempre 1.
    if (t >= 3000 && t < 7000) sai.push({ tipo: 'video', perda: 255 / 256, perdidos: 1, ha: t - 3000 });
    if (t >= 7000 && t < 11_000) sai.push({ tipo: 'video', perda: 7 / 256, perdidos: 1, ha: t - 7000 });
    if (t >= 11_000) sai.push({ tipo: 'video', perda: 0, perdidos: 1, ha: (t - 11_000) % 4000 });
    return relatorio({
      agora: 100_000 + t,
      som: { recebidos: b.pacotes, perdidos: 0 },
      video: { recebidos: b.pacotes / 2, perdidos: 0, imagens: b.pacotes / 2 },
      manda: { audio: b.pacotes, video: t < 3500 ? 0 : Math.round((t - 3500) / 66) },
      sai,
      par: { atraso: 0.001 },
    });
  };
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(20_000);
  assert.equal(b.medidas.length, 10);
  assert.deepEqual([...new Set(b.medidas.map((m) => m.estado))], ['medindo', 'boa']);
  assert.deepEqual(
    b.medidas.filter((m) => m.perda >= LIMITES.perda.instavel),
    [],
  );
});

// As respostas do par de endereços chegam a cada 2,5 s, e a página lê a cada 2 s: a resposta dos 10 s é lida aos 10 e
// aos 12 s. Uma só que demorou 600 ms não é uma conexão ruim.
test('o atraso: uma amostra alta sozinha, lida em duas leituras, não muda o estado', async () => {
  const b = bancada();
  b.proximo = () => {
    const t = b.relogio.agora();
    b.pacotes += 100;
    const respostas = Math.floor(t / 2500);
    return relatorio({
      agora: 100_000 + t,
      som: { recebidos: b.pacotes, perdidos: 0 },
      par: { atraso: respostas === 4 ? 0.6 : 0.04, respostas },
    });
  };
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(24_000);
  assert.equal(b.medidas.length, 12);
  assert.deepEqual([...new Set(b.medidas.map((m) => m.estado))], ['medindo', 'boa']);
  // E o número do cartão não mostrou a amostra sozinha. Na primeira medida só havia uma amostra (a resposta dos 0 s,
  // lida aos 0 e aos 2 s), e uma só não conta.
  assert.deepEqual([...new Set(b.medidas.map((m) => m.atraso))], [null, 40]);
});

test('o atraso: duas amostras altas seguidas pioram o estado', async () => {
  const b = bancada();
  b.proximo = () => {
    const t = b.relogio.agora();
    b.pacotes += 100;
    const respostas = Math.floor(t / 2500);
    return relatorio({
      agora: 100_000 + t,
      som: { recebidos: b.pacotes, perdidos: 0 },
      par: { atraso: respostas >= 4 ? 0.6 : 0.04, respostas },
    });
  };
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(20_000);
  // A resposta dos 10 s e a dos 12,5 s são altas: a leitura dos 14 s é a primeira que vê as duas, e a dos 16 s, a
  // segunda medida ruim.
  assert.deepEqual(
    b.medidas.map((m) => m.estado),
    ['medindo', 'boa', 'boa', 'boa', 'boa', 'boa', 'boa', 'ruim', 'ruim', 'ruim'],
  );
  assert.deepEqual(
    b.medidas.map((m) => m.atraso),
    [null, 40, 40, 40, 40, 40, 600, 600, 600, 600],
  );
});

/** A bancada com os relógios do navegador adiantados pelo salto: a página que ficou parada sem a aba avisar. */
function bancadaQuePara() {
  const b = bancada();
  b.salto = 0;
  b.proximo = () => {
    b.pacotes += 100;
    b.perdidos = (b.perdidos ?? 0) + Math.round(100 * b.perda);
    return relatorio({
      agora: b.relogio.agora() + b.salto,
      som: { recebidos: b.pacotes, perdidos: b.perdidos },
      par: { atraso: 0.04 },
    });
  };
  return b;
}

// O celular que vai para outro app pode parar a página de uma vez, sem a aba dizer que se escondeu: a leitura seguinte
// chega muito depois da anterior, com tudo o que se perdeu enquanto a página esteve parada.
test('o medidor: a leitura que chega mais de 6 s depois da anterior é só a base', async () => {
  const b = bancadaQuePara();
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(4000);
  assert.equal(b.medidas.at(-1).estado, 'boa');
  assert.equal(b.medidas.length, 2);
  // Um minuto parada, e 500 pacotes perdidos nesse minuto.
  b.salto = 60_000;
  b.perdidos += 500;
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 4);
  assert.equal(b.medidas.length, 2);
  // A seguinte mede de novo, só os 2 s dela.
  await b.relogio.andar(2000);
  assert.deepEqual(b.medidas.at(-1), { estado: 'boa', perda: 0, atraso: 40 });
  assert.equal(b.medidas.length, 3);
  // Os 6 s certos ainda são uma medida (duas leituras que falharam no meio): só mais que isso é uma pausa.
  const normal = b.proximo;
  b.proximo = () => Promise.resolve(null);
  await b.relogio.andar(4000);
  b.proximo = normal;
  await b.relogio.andar(2000);
  assert.equal(b.medidas.length, 4);
  b.proximo = () => Promise.resolve(null);
  await b.relogio.andar(6000);
  b.proximo = normal;
  await b.relogio.andar(2000);
  assert.equal(b.medidas.length, 4);
  await b.relogio.andar(2000);
  assert.equal(b.medidas.length, 5);
});

test('o medidor: depois de uma pausa, as medidas de antes não contam para piorar nem para melhorar', async () => {
  // A página parada: uma medida ruim antes, e uma depois, não são duas seguidas.
  const b = bancadaQuePara();
  b.medidor.medir(true);
  await assentar();
  await b.relogio.andar(4000);
  b.perda = 0.1;
  await b.relogio.andar(2000);
  assert.equal(b.medidas.at(-1).estado, 'boa');
  b.salto = 60_000;
  await b.relogio.andar(2000);
  assert.equal(b.medidas.length, 3);
  await b.relogio.andar(2000);
  assert.equal(b.medidas.length, 4);
  assert.equal(b.medidas.at(-1).estado, 'boa');
  // A segunda ruim de agora, sim.
  await b.relogio.andar(2000);
  assert.equal(b.medidas.at(-1).estado, 'ruim');
  // E a melhora pede cinco boas de depois da pausa: quatro de antes e uma de depois não bastam.
  b.perda = 0;
  await b.relogio.andar(8000);
  assert.equal(b.medidas.at(-1).estado, 'ruim');
  b.salto = 120_000;
  await b.relogio.andar(2000);
  await b.relogio.andar(2000);
  assert.equal(b.medidas.at(-1).estado, 'ruim');
  await b.relogio.andar(8000);
  assert.equal(b.medidas.at(-1).estado, 'boa');

  // Com a aba escondida é igual: uma ruim antes de esconder e uma depois de voltar não são duas seguidas.
  const c = bancada();
  c.medidor.medir(true);
  await assentar();
  await c.relogio.andar(4000);
  c.perda = 0.1;
  await c.relogio.andar(2000);
  assert.equal(c.medidas.at(-1).estado, 'boa');
  c.visivel = false;
  await c.relogio.andar(30_000);
  c.visivel = true;
  await c.relogio.andar(4000);
  assert.equal(c.medidas.length, 4);
  assert.equal(c.medidas.at(-1).estado, 'boa');
  await c.relogio.andar(2000);
  assert.equal(c.medidas.at(-1).estado, 'ruim');
});

// ---- Os textos do sinalizador (a seção 4.4 do desenho), letra por letra. ----

test('os textos de cada estado', () => {
  assert.deepEqual(textosDoSinal('boa'), {
    botao: 'Conexão boa',
    nome: 'Conexão boa. Ver os detalhes',
    titulo: 'Sua conexão está boa',
    explicacao: 'A imagem e o som estão chegando bem.',
    dicas: 0,
  });
  assert.deepEqual(textosDoSinal('instavel'), {
    botao: 'Conexão instável',
    nome: 'Conexão instável. Ver os detalhes',
    titulo: 'Sua conexão está instável',
    explicacao: 'A imagem ou o som podem falhar de vez em quando.',
    dicas: 2,
  });
  assert.deepEqual(textosDoSinal('ruim'), {
    botao: 'Conexão ruim',
    nome: 'Conexão ruim. Ver os detalhes',
    titulo: 'Sua conexão está ruim',
    explicacao: 'Os outros podem não ver ou ouvir você direito, e a imagem deles pode travar para você.',
    dicas: 3,
  });
  // No medindo, o nome para o leitor de tela não tem as reticências nem o "Ver os detalhes".
  assert.deepEqual(textosDoSinal('medindo'), {
    botao: 'Medindo a conexão…',
    nome: 'Medindo a conexão',
    titulo: 'Medindo a conexão…',
    explicacao: 'Os números aparecem aqui em alguns segundos.',
    dicas: 0,
  });
  // Um estado que não existe mostra o medindo.
  assert.deepEqual(textosDoSinal('otima'), textosDoSinal('medindo'));
  assert.deepEqual(textosDoSinal(undefined), textosDoSinal('medindo'));
  // Também os nomes que todo objeto tem.
  assert.deepEqual(textosDoSinal('constructor'), textosDoSinal('medindo'));
  assert.deepEqual(textosDoSinal('toString'), textosDoSinal('medindo'));
});

test('o texto do aviso de conexão ruim', () => {
  assert.equal(AVISO_DA_CONEXAO_RUIM, 'Sua conexão está ruim');
});

test('os números do cartão', () => {
  assert.equal(numerosDoCartao({ estado: 'instavel', perda: 0.04, atraso: 210 }), 'Perda: 4% · Atraso: 210 ms');
  assert.equal(numerosDoCartao({ estado: 'boa', perda: 0, atraso: 45 }), 'Perda: 0% · Atraso: 45 ms');
  assert.equal(numerosDoCartao({ estado: 'ruim', perda: 1, atraso: 2000 }), 'Perda: 100% · Atraso: 2000 ms');
  // A perda e o atraso são arredondados para o inteiro.
  assert.equal(numerosDoCartao({ estado: 'ruim', perda: 0.1249, atraso: 639.6 }), 'Perda: 12% · Atraso: 640 ms');
  assert.equal(numerosDoCartao({ estado: 'ruim', perda: 0.126, atraso: 0.4 }), 'Perda: 13% · Atraso: 0 ms');
  // O número que o navegador não dá aparece como "—".
  assert.equal(numerosDoCartao({ estado: 'instavel', perda: 0.04, atraso: null }), 'Perda: 4% · Atraso: —');
  assert.equal(numerosDoCartao({ estado: 'instavel', perda: null, atraso: 300 }), 'Perda: — · Atraso: 300 ms');
  assert.equal(numerosDoCartao({ estado: 'boa', perda: undefined, atraso: Number.NaN }), 'Perda: — · Atraso: —');
  // No medindo, o cartão não tem números, nem os da primeira medida.
  assert.equal(numerosDoCartao({ estado: 'medindo', perda: null, atraso: null }), null);
  assert.equal(numerosDoCartao({ estado: 'medindo', perda: 0, atraso: 45 }), null);
});
