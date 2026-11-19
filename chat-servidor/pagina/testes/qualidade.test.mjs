// Os testes da conta do sinalizador de qualidade (qualidade.js): a leitura do getStats, a medida entre duas leituras, a
// tabela dos estados, as regras de piorar e melhorar, e o medidor, com o relatório, o relógio e a aba de mentira.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INTERVALO_MS,
  LIMITES,
  VALIDADE_DO_RELATORIO_MS,
  classificar,
  conta,
  criarMedidor,
  leitura,
  medida,
  passo,
} from '../../internal/pagina/estatico/qualidade.js';

// ---- O relatório de mentira: um Map com os objetos do getStats, como o RTCStatsReport. ----

/**
 * O relatório de uma leitura. agora: o timestamp dos objetos; som e video: os contadores do inbound-rtp de cada tipo
 * ({recebidos, perdidos, imagens}); sai: os remote-inbound-rtp ({tipo, perda, atraso (em s), ha (ms atrás)}); par: o
 * par de endereços em uso ({atraso (em s), por: 'transport' | 'selected' | 'nominated'}).
 */
function relatorio({ agora = 100_000, som = null, video = null, sai = [], par = null, outros = [] } = {}) {
  const r = new Map();
  const por = (o) => r.set(o.id, o);
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

const SEM_NADA = { som: null, video: null, perdaQueSai: null, atraso: null };

test('os valores da spec', () => {
  assert.equal(INTERVALO_MS, 2000);
  assert.equal(VALIDADE_DO_RELATORIO_MS, 10000);
  assert.deepEqual(LIMITES, { perda: { instavel: 0.02, ruim: 0.08 }, atraso: { instavel: 250, ruim: 500 } });
  assert.ok(Object.isFrozen(LIMITES));
});

test('a leitura', () => {
  const r = relatorio({
    agora: 100_000,
    som: { recebidos: 5000, perdidos: 12 },
    video: { recebidos: 9000, perdidos: 30, imagens: 2500 },
    sai: [
      { tipo: 'audio', perda: 0.01, atraso: 0.21 },
      { tipo: 'video', perda: 0.04, atraso: 0.3 },
    ],
    par: { atraso: 0.045 },
  });
  assert.deepEqual(leitura(r), {
    agora: 100_000,
    som: { recebidos: 5000, perdidos: 12 },
    video: { recebidos: 9000, perdidos: 30, imagens: 2500 },
    perdaQueSai: 0.04,
    atraso: 45,
  });
});

test('a leitura: o relatório do servidor com mais de 10 s não conta', () => {
  const com = (ha) =>
    leitura(relatorio({ sai: [{ tipo: 'video', perda: 0.5, ha }, { tipo: 'audio', perda: 0.01, ha: 0 }] })).perdaQueSai;
  assert.equal(com(10_000), 0.5);
  assert.equal(com(10_001), 0.01);
  // Todos velhos: não há a perda do que sai. (O agora vem do som, que é de agora.)
  const soVelho = relatorio({ som: { recebidos: 1, perdidos: 0 }, sai: [{ tipo: 'audio', perda: 0.5, ha: 10_001 }] });
  assert.equal(leitura(soVelho).perdaQueSai, null);
  // O agora é o maior timestamp do relatório (aqui, o do som), e não o do relógio da página.
  const antigo = relatorio({
    agora: 70_000,
    som: { recebidos: 1, perdidos: 0 },
    sai: [{ tipo: 'audio', perda: 0.5, ha: 20_000 }],
  });
  assert.equal(leitura(antigo).agora, 70_000);
  assert.equal(leitura(antigo).perdaQueSai, null);
});

test('a leitura: o atraso', () => {
  // Sem o par em uso, vale o roundTripTime do remote-inbound-rtp do som.
  const somDe = (ha) => {
    const r = relatorio({ som: { recebidos: 1, perdidos: 0 }, sai: [{ tipo: 'audio', perda: 0, atraso: 0.21, ha }] });
    return leitura(r).atraso;
  };
  assert.equal(somDe(0), 210);
  assert.equal(somDe(10_000), 210);
  assert.equal(somDe(10_001), null);
  // O do vídeo não serve de atraso.
  assert.equal(leitura(relatorio({ sai: [{ tipo: 'video', perda: 0, atraso: 0.3 }] })).atraso, null);
  // O par em uso vem primeiro, também quando o som tem o dele.
  const comOsDois = relatorio({ sai: [{ tipo: 'audio', perda: 0, atraso: 0.21 }], par: { atraso: 0.045 } });
  assert.equal(leitura(comOsDois).atraso, 45);
  // O par pelo selected (o Firefox), e pelo nominated com succeeded, quando falta o transport.
  assert.equal(leitura(relatorio({ par: { atraso: 0.08, por: 'selected' } })).atraso, 80);
  assert.equal(leitura(relatorio({ par: { atraso: 0.12, por: 'nominated' } })).atraso, 120);
  // O par em uso sem o número (o Safari pode não dar): cai no do som.
  const semNumero = relatorio({ sai: [{ tipo: 'audio', perda: 0, atraso: 0.21 }], par: { atraso: undefined } });
  assert.equal(leitura(semNumero).atraso, 210);
  // O atraso só é arredondado na tela: aqui ele fica como veio, em ms (249,9 ainda não é instável).
  assert.ok(Math.abs(leitura(relatorio({ par: { atraso: 0.2499 } })).atraso - 249.9) < 1e-9);
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
  // A perda que não é número, ou negativa, não entra.
  const semPerda = relatorio({ sai: [{ tipo: 'audio', perda: undefined }, { tipo: 'video', perda: -1 }] });
  assert.equal(leitura(semPerda).perdaQueSai, null);
  // O que não é de nenhum tipo conhecido não atrapalha.
  const estranhos = relatorio({ outros: [{ id: 'x', type: 'codec', timestamp: 5 }, { id: 'y' }] });
  assert.deepEqual(leitura(estranhos), { agora: 5, ...SEM_NADA });
});

// Uma leitura já pronta, para os testes da medida.
const L = (campos = {}) => ({ agora: 0, ...SEM_NADA, ...campos });
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
    L({ som: som(0), video: video(0) }),
    L({ som: som(99, 1), video: video(95, 5), perdaQueSai: 0.03 }),
  );
  assert.equal(maior.perda, 0.05);
  // A que sai vale sozinha, e quando é a maior.
  assert.equal(medida(L(), L({ perdaQueSai: 0.03 })).perda, 0.03);
  assert.equal(medida(L({ som: som(0) }), L({ som: som(99, 1), perdaQueSai: 0.2 })).perda, 0.2);
  // A que sai é a da leitura de agora, e não a da anterior.
  assert.equal(medida(L({ perdaQueSai: 0.5 }), L()).perda, null);
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
  // A promessa recusada, o relatório null, e o ler que lança: nenhum vira medida, e o medidor continua.
  const normal = b.proximo;
  b.proximo = () => Promise.reject(new Error('sem a ligação'));
  await b.relogio.andar(2000);
  b.proximo = () => Promise.resolve(null);
  await b.relogio.andar(2000);
  b.proximo = () => {
    throw new Error('o getStats não existe');
  };
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 6);
  assert.equal(b.medidas.length, 2);
  // A leitura seguinte que dá certo mede contra a última que deu certo.
  b.proximo = normal;
  await b.relogio.andar(2000);
  assert.equal(b.lidas, 7);
  assert.equal(b.medidas.length, 3);
  assert.deepEqual(b.medidas.at(-1), { estado: 'boa', perda: 0, atraso: 40 });
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
