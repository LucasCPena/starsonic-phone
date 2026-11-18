// O palco da reunião: a página recebe um vídeo só, o mosaico com todo mundo, e o servidor diz onde cada pessoa está
// nele (a mensagem palco). Este módulo é o cérebro dos quadros, um por pessoa, recortados do mosaico: ele lê o palco,
// junta o palco com o vídeo pelo tamanho da imagem (sincronizar), decide quem fica aumentado quando o palco muda, onde
// cada quadro fica na tela (arrumar) e o pedaço do mosaico que vai a cada um (recortar).
//
// É puro: sem DOM, sem rede, sem relógio e sem importar nada. O tempo chega como o agora de cada chamada. Ele nunca
// muda o que recebe: cada resultado é um objeto novo.
//
// A regra que manda em tudo: ninguém pode ver um rosto com o nome de outra pessoa. Numa troca de layout, o palco novo
// chega antes da imagem nova (a rede pode levar 1 s ou mais), e por isso os quadros só são desenhados quando a imagem
// tem o tamanho do palco. E quem acaba de ficar com a célula de quem saiu mostra o fundo escuro com o nome por um
// tempo, porque a imagem dessa célula ainda pode ser a de quem saiu.

/** O tempo que o vídeo precisa ter o tamanho do palco antes de os quadros aparecerem, em ms. */
export const ESPERA_DO_TAMANHO_MS = 600;
/** O tempo em que o quadro de quem acabou de entrar num palco do mesmo tamanho mostra o fundo escuro, em ms. */
export const ESPERA_DO_QUADRO_NOVO_MS = 1000;
/** Sem palco (ou com o vídeo de outro tamanho) por esse tempo, a página mostra o mosaico inteiro, em ms. */
export const PRAZO_SEM_PALCO_MS = 3000;
/** O que o recorte de uma câmera tira de cada lado da célula, em pontos do mosaico: a borda do vizinho. */
export const MARGEM_DO_RECORTE = 2;

// Os limites do palco, os mesmos do chat.
const LARGURA = [16, 7680];
const ALTURA = [16, 4320];
const MAX_QUADROS = 13;
const MIN_LADO = 16;
const MAX_NOME = 200;

const inteiroEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/** A mensagem do canal vira o palco {largura, altura, quadros}, ou null se ela não vale. */
export function lerPalco(m) {
  if (!m || typeof m !== 'object') return null;
  const { largura, altura, quadros } = m;
  if (!inteiroEntre(largura, ...LARGURA) || !inteiroEntre(altura, ...ALTURA)) return null;
  if (!Array.isArray(quadros) || quadros.length > MAX_QUADROS) return null;
  const lidos = [];
  for (const q of quadros) {
    const lido = lerQuadro(q, largura, altura);
    if (!lido) return null;
    lidos.push(lido);
  }
  return { largura, altura, quadros: lidos };
}

// lerQuadro: a cópia do quadro só com os campos conhecidos, ou null se ele não vale ou não cabe no mosaico.
function lerQuadro(q, largura, altura) {
  if (!q || typeof q !== 'object') return null;
  const { quem, nome, x, y, l, a } = q;
  if (typeof quem !== 'string' || typeof nome !== 'string' || [...nome].length > MAX_NOME) return null;
  if (!inteiroEntre(l, MIN_LADO, largura) || !inteiroEntre(a, MIN_LADO, altura)) return null;
  if (!inteiroEntre(x, 0, largura - l) || !inteiroEntre(y, 0, altura - a)) return null;
  return { quem, nome, voce: q.voce === true, tela: q.tela === true, semCamera: q.semCamera === true, x, y, l, a };
}

/** A chave de um quadro do palco: 'tela:<quem>' ou 'cam:<quem>'. A do Você é 'voce'. */
export function chaveDe(quadro) {
  if (quadro.tela) return `tela:${quadro.quem}`;
  return quadro.voce ? 'voce' : `cam:${quadro.quem}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// A sincronia. O "visto" é o palco que a página usa. A memória guarda:
// - recebido: o último palco recebido (o mesmo objeto chega em toda chamada enquanto ele não muda);
// - semPalcoDesde: desde quando não há palco (o começo da sincronia, ou quando ele sumiu);
// - video e videoDesde: o tamanho do vídeo e o agora da chamada que viu esse tamanho;
// - visto, e o pendente: o palco de outro tamanho, que espera o vídeo deixar o tamanho do visto;
// - entradas: chave → agora, das chaves que entraram no visto por um palco do mesmo tamanho.

/** A memória da sincronia, no começo da ligação. */
export function sincroniaInicial(agora) {
  return {
    recebido: null,
    semPalcoDesde: agora,
    video: null,
    videoDesde: agora,
    visto: null,
    pendente: null,
    entradas: {},
  };
}

const mesmoVideo = (v, w) => (v === null || w === null ? v === w : v.l === w.l && v.a === w.a);
const mesmoTamanho = (video, palco) => video.l === palco.largura && video.a === palco.altura;
const chavesDe = (palco) => palco.quadros.map(chaveDe);

/** Junta o palco com o vídeo. O video é {l, a}, ou null sem imagem ainda. */
export function sincronizar(mem, { palco, video, agora }) {
  const m = { ...mem, recebido: palco };
  if (!mesmoVideo(video, mem.video)) {
    m.video = video === null ? null : { l: video.l, a: video.a };
    m.videoDesde = agora;
  }

  if (palco === null) {
    // Sem palco, nada do que se viu vale: um palco que volte é como o primeiro.
    if (mem.recebido !== null) m.semPalcoDesde = agora;
    m.visto = null;
    m.pendente = null;
    m.entradas = {};
    const falta = m.semPalcoDesde + PRAZO_SEM_PALCO_MS - agora;
    if (falta > 0) return resultado(m, 'espera', [], falta);
    return resultado(m, 'mosaico', [], null);
  }

  if (palco !== mem.recebido) {
    if (m.visto && palco.largura === m.visto.largura && palco.altura === m.visto.altura) {
      // Do mesmo tamanho, ele toma o lugar do visto na hora. Quem não estava no visto entra agora; um palco de outro
      // tamanho que esperava ficou velho.
      const antes = new Set(chavesDe(m.visto));
      const entradas = {};
      for (const chave of chavesDe(palco)) {
        if (!antes.has(chave)) entradas[chave] = agora;
        else if (chave in m.entradas) entradas[chave] = m.entradas[chave];
      }
      m.visto = palco;
      m.pendente = null;
      m.entradas = entradas;
    } else {
      m.pendente = palco;
    }
  }

  // O de outro tamanho espera enquanto o vídeo tem o tamanho do visto. Ele vira o visto sem as entradas: a espera do
  // tamanho já cobre a troca da imagem.
  if (m.pendente && (!m.visto || !m.video || !mesmoTamanho(m.video, m.visto))) {
    m.visto = m.pendente;
    m.pendente = null;
    m.entradas = {};
  }

  const todas = chavesDe(m.visto);
  if (!m.video) return resultado(m, 'espera', todas, null);
  const ha = agora - m.videoDesde;
  if (!mesmoTamanho(m.video, m.visto)) {
    if (ha >= PRAZO_SEM_PALCO_MS) return resultado(m, 'mosaico', [], null);
    return resultado(m, 'espera', todas, PRAZO_SEM_PALCO_MS - ha);
  }
  if (ha < ESPERA_DO_TAMANHO_MS) return resultado(m, 'espera', todas, ESPERA_DO_TAMANHO_MS - ha);
  const esperando = [];
  let proximo = null;
  for (const chave of todas) {
    if (!(chave in m.entradas)) continue;
    const falta = m.entradas[chave] + ESPERA_DO_QUADRO_NOVO_MS - agora;
    if (falta > 0) {
      esperando.push(chave);
      proximo = proximo === null ? falta : Math.min(proximo, falta);
    }
  }
  return resultado(m, 'quadros', esperando, proximo);
}

const resultado = (mem, modo, esperando, proximo) => ({ mem, modo, palco: mem.visto, esperando, proximo });

// ---------------------------------------------------------------------------------------------------------------------
// Quem fica aumentado.

const chaveDaTela = (palco) => {
  const tela = palco?.quadros.find((q) => q.tela);
  return tela ? chaveDe(tela) : null;
};

/** Quem fica aumentado depois de o palco mudar. */
export function aoMudarOPalco(aumentado, antes, depois) {
  if (aumentado === null) return null;
  // Uma tela que aparece ou some (ou a de outra pessoa no lugar) muda o que é o grande.
  if (chaveDaTela(antes) !== chaveDaTela(depois)) return null;
  if (!depois || !depois.quadros.some((q) => !q.tela && chaveDe(q) === aumentado)) return null;
  return aumentado;
}

// ---------------------------------------------------------------------------------------------------------------------
// A arrumação. Os x e y dos quadros da faixa são relativos ao retângulo dela (ela rola); os dos outros, à área.

const ESPACO_PC = 8;
const ESPACO_EM_PE = 6;
const AFASTAR_DO_GRANDE = 10;
const CANTO_PC = 16;
const CANTO_EM_PE = 10;
const FAIXA_EM_PE = { l: 128, a: 72 };
const GIRE = 28;

/** Onde fica cada quadro. A area é {l, a}, em px. */
export function arrumar({ palco, area, emPe, aumentado }) {
  const quadros = palco ? palco.quadros : [];
  const outros = quadros.filter((q) => !q.tela && !q.voce).map(daCamera);
  const telaDoPalco = quadros.find((q) => q.tela);
  const tela = telaDoPalco ? daTela(telaDoPalco) : null;
  const voce = doVoce(quadros.find((q) => !q.tela && q.voce));
  const aumentada = outros.find((q) => q.chave === aumentado) ?? null;
  const grande = aumentada ?? tela;

  if (!grande) return emPe ? gradeEmPe(outros, voce, area) : gradePC(outros, voce, area);
  const voltar = aumentada ? (tela ? 'voltarParaATela' : 'verTodos') : null;
  if (emPe && !aumentada) return telaEmPe(tela, outros, voce, area);
  // Na faixa: a tela, quando uma câmera está aumentada durante o compartilhamento; os outros que não estão grandes; e
  // o Você por último.
  const naFaixa = [...(aumentada && tela ? [tela] : []), ...outros.filter((q) => q !== aumentada), voce];
  const rotulo = aumentada ? (tela ? 'A tela e as outras pessoas' : 'As outras pessoas') : 'As pessoas';
  const arrumado = emPe ? comFaixaEmPe(grande, naFaixa, area) : comFaixaPC(grande, naFaixa, area);
  return {
    modo: 'grande',
    grande: grande.chave,
    voltar,
    gire: null,
    faixa: { ...arrumado.faixa, rotulo },
    quadros: arrumado.quadros,
  };
}

const daCamera = (q) => ({
  chave: chaveDe(q),
  tipo: 'camera',
  quem: q.quem,
  nome: q.nome,
  semCamera: q.semCamera,
  recorte: {
    x: q.x + MARGEM_DO_RECORTE,
    y: q.y + MARGEM_DO_RECORTE,
    l: q.l - 2 * MARGEM_DO_RECORTE,
    a: q.a - 2 * MARGEM_DO_RECORTE,
  },
  corte: 'cobrir',
});
const daTela = (q) => ({
  chave: chaveDe(q),
  tipo: 'tela',
  quem: q.quem,
  nome: q.nome,
  semCamera: q.semCamera,
  recorte: { x: q.x, y: q.y, l: q.l, a: q.a },
  corte: 'inteiro',
});
// O Você vem da câmera própria (a página o desenha, não o mosaico); sem quadro dele no palco, ele entra assim mesmo.
const doVoce = (q) => ({
  chave: 'voce',
  tipo: 'voce',
  quem: q ? q.quem : null,
  nome: q ? q.nome : '',
  semCamera: q ? q.semCamera : false,
  recorte: null,
  corte: 'cobrir',
});

// posto: o quadro no lugar, com os números inteiros. O grande e o Você nunca são botão.
function posto(quadro, papel, botao, { x, y, l, a }) {
  const { recorte, corte, ...resto } = quadro;
  return {
    ...resto,
    papel,
    botao: botao && quadro.tipo !== 'voce' && papel !== 'grande',
    x: Math.round(x),
    y: Math.round(y),
    l: Math.round(l),
    a: Math.round(a),
    recorte: recorte && { ...recorte },
    corte,
  };
}

const retangulo = ({ x, y, l, a }) => ({ x: Math.round(x), y: Math.round(y), l: Math.round(l), a: Math.round(a) });
const semGrande = (quadros) => ({ modo: 'grade', grande: null, voltar: null, gire: null, faixa: null, quadros });

// caber: o maior quadro que cabe em l×a com a proporção entre 4:3 e 2:1.
function caber(l, a) {
  if (l / a > 2) return { l: 2 * a, a };
  if (l / a < 4 / 3) return { l, a: (l * 3) / 4 };
  return { l, a };
}

// ladoALado: n quadros do mesmo tamanho em linhas de c, com o espaço entre eles; cada linha no centro da largura, e o
// bloco no centro da altura.
function ladoALado(n, c, tamanho, area, espaco) {
  const linhas = Math.ceil(n / c);
  const bloco = linhas * tamanho.a + espaco * (linhas - 1);
  const y0 = (area.a - bloco) / 2;
  const lugares = [];
  for (let i = 0; i < n; i++) {
    const linha = Math.floor(i / c);
    const naLinha = Math.min(c, n - linha * c);
    const x0 = (area.l - (naLinha * tamanho.l + espaco * (naLinha - 1))) / 2;
    lugares.push({ x: x0 + (i % c) * (tamanho.l + espaco), y: y0 + linha * (tamanho.a + espaco), ...tamanho });
  }
  return lugares;
}

// lugaresNaGradePC: vale o número de colunas que dá o quadro de maior área; no empate, o menor.
function lugaresNaGradePC(n, area) {
  let melhor = null;
  for (let c = 1; c <= n; c++) {
    const linhas = Math.ceil(n / c);
    const tamanho = caber((area.l - ESPACO_PC * (c - 1)) / c, (area.a - ESPACO_PC * (linhas - 1)) / linhas);
    if (!melhor || tamanho.l * tamanho.a > melhor.tamanho.l * melhor.tamanho.a) melhor = { c, tamanho };
  }
  return ladoALado(n, melhor.c, melhor.tamanho, area, ESPACO_PC);
}

function gradePC(outros, voce, area) {
  if (outros.length === 0) return semGrande([posto(voce, 'grade', false, lugaresNaGradePC(1, area)[0])]);
  const botao = outros.length >= 2;
  const lugares = lugaresNaGradePC(outros.length, area);
  const l = Math.min(208, Math.max(96, Math.round(0.17 * area.l)));
  const a = (l * 9) / 16;
  const canto = { x: area.l - CANTO_PC - l, y: area.a - CANTO_PC - a, l, a };
  return semGrande([...outros.map((q, i) => posto(q, 'grade', botao, lugares[i])), posto(voce, 'canto', false, canto)]);
}

// emColunas: o celular em pé. Cada quadro ocupa a célula inteira; com duas colunas e um número ímpar, o último ocupa a
// linha inteira.
function emColunas(n, colunas, regiao) {
  const linhas = Math.ceil(n / colunas);
  const l = (regiao.l - ESPACO_EM_PE * (colunas - 1)) / colunas;
  const a = (regiao.a - ESPACO_EM_PE * (linhas - 1)) / linhas;
  const lugares = [];
  for (let i = 0; i < n; i++) {
    const y = regiao.y + Math.floor(i / colunas) * (a + ESPACO_EM_PE);
    if (colunas === 2 && n % 2 === 1 && i === n - 1) lugares.push({ x: regiao.x, y, l: regiao.l, a });
    else lugares.push({ x: regiao.x + (i % colunas) * (l + ESPACO_EM_PE), y, l, a });
  }
  return lugares;
}

function gradeEmPe(outros, voce, area) {
  const toda = { x: 0, y: 0, l: area.l, a: area.a };
  if (outros.length === 0) return semGrande([posto(voce, 'grade', false, toda)]);
  const botao = outros.length >= 2;
  const lugares = emColunas(outros.length, outros.length <= 3 ? 1 : 2, toda);
  const l = outros.length === 1 ? 92 : 84;
  const a = (l * 4) / 3;
  const canto = { x: area.l - CANTO_EM_PE - l, y: area.a - CANTO_EM_PE - a, l, a };
  return semGrande([...outros.map((q, i) => posto(q, 'grade', botao, lugares[i])), posto(voce, 'canto', false, canto)]);
}

// telaEmPe: a tela em cima, com a largura toda; o aviso de girar; e as pessoas embaixo, em duas colunas.
function telaEmPe(tela, outros, voce, area) {
  const alturaDaTela = Math.round((area.l * 9) / 16);
  const gire = { x: 0, y: alturaDaTela + ESPACO_EM_PE, l: area.l, a: GIRE };
  const topo = gire.y + GIRE + ESPACO_EM_PE;
  const embaixo = [...outros, voce];
  const lugares = emColunas(embaixo.length, 2, { x: 0, y: topo, l: area.l, a: area.a - topo });
  return {
    modo: 'grande',
    grande: tela.chave,
    voltar: null,
    gire,
    faixa: null,
    quadros: [
      posto(tela, 'grande', false, { x: 0, y: 0, l: area.l, a: alturaDaTela }),
      ...embaixo.map((q, i) => posto(q, 'grade', true, lugares[i])),
    ],
  };
}

// comFaixaPC: a faixa na coluna da direita, com os quadros 16:9 um embaixo do outro. O tamanho de cada um é inteiro, e
// o passo da faixa é esse tamanho mais o espaço. O grande ocupa o que sobra à esquerda: a tela inteira, e a câmera com
// a regra da proporção, no centro.
function comFaixaPC(grande, naFaixa, area) {
  const l = Math.min(228, Math.max(132, Math.round(0.185 * area.l)));
  const a = Math.round((l * 9) / 16);
  const sobra = { l: area.l - l - AFASTAR_DO_GRANDE, a: area.a };
  const tamanho = grande.tipo === 'tela' ? sobra : caber(sobra.l, sobra.a);
  const lugar = { x: (sobra.l - tamanho.l) / 2, y: (sobra.a - tamanho.a) / 2, ...tamanho };
  return {
    faixa: { eixo: 'y', ...retangulo({ x: area.l - l, y: 0, l, a: area.a }) },
    quadros: [
      posto(grande, 'grande', false, lugar),
      ...naFaixa.map((q, i) => posto(q, 'faixa', true, { x: 0, y: i * (a + ESPACO_PC), l, a })),
    ],
  };
}

// comFaixaEmPe: o grande em cima, inteiro, e a faixa embaixo, uma linha de quadros de 128x72.
function comFaixaEmPe(grande, naFaixa, area) {
  const { l, a } = FAIXA_EM_PE;
  const alturaDoGrande = area.a - a - ESPACO_EM_PE;
  return {
    faixa: { eixo: 'x', ...retangulo({ x: 0, y: area.a - a, l: area.l, a }) },
    quadros: [
      posto(grande, 'grande', false, { x: 0, y: 0, l: area.l, a: alturaDoGrande }),
      ...naFaixa.map((q, i) => posto(q, 'faixa', true, { x: i * (l + ESPACO_EM_PE), y: 0, l, a })),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// O recorte.

/** O pedaço do mosaico que vai ao quadro, e onde ele cai dentro do quadro. */
export function recortar(recorte, tamanho, corte) {
  const escalaL = tamanho.l / recorte.l;
  const escalaA = tamanho.a / recorte.a;
  if (corte === 'inteiro') {
    // A célula inteira, sem cortar nada: o que sobra no quadro fica vazio, no centro.
    const escala = Math.min(escalaL, escalaA);
    const dl = recorte.l * escala;
    const da = recorte.a * escala;
    const dx = (tamanho.l - dl) / 2;
    const dy = (tamanho.a - da) / 2;
    return { sx: recorte.x, sy: recorte.y, sl: recorte.l, sa: recorte.a, dx, dy, dl, da };
  }
  // O cobrir enche o quadro e corta o que sobra da célula, no centro.
  const escala = Math.max(escalaL, escalaA);
  const sl = tamanho.l / escala;
  const sa = tamanho.a / escala;
  return {
    sx: recorte.x + (recorte.l - sl) / 2,
    sy: recorte.y + (recorte.a - sa) / 2,
    sl,
    sa,
    dx: 0,
    dy: 0,
    dl: tamanho.l,
    da: tamanho.a,
  };
}
