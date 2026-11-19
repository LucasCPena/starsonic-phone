// Os quadros da reunião: a camada da tela que desenha um quadro por pessoa, recortado do mosaico que a página recebe.
// O vídeo do mosaico (#mosaico) continua tocando, fora da vista; cada quadro de pessoa ou de tela é um <canvas> pintado
// com o pedaço dele, e o Você é um <video> mudo com a câmera própria. Toda a geometria e toda a sincronia são do
// palco.js: daqui sai só o DOM. A cada imagem do mosaico, o sincronizar diz se os quadros valem (o tamanho da imagem é
// o do palco), quem espera com o fundo escuro, e o arrumar diz onde cada um fica. O tempo é sempre o do relógio da
// página. Nada do palco vai ao console: ele leva os nomes.
import { aoMudarOPalco, arrumar, chaveDe, recortar, sincroniaInicial, sincronizar } from './palco.js';

const SVG = 'http://www.w3.org/2000/svg';
/** O canvas tem o tamanho do quadro vezes o devicePixelRatio, até este. */
const MAX_PIXELS_POR_PONTO = 2;
/** O botão de voltar fica a esta distância do canto do quadro grande, em px. */
const AFASTAR_DO_GRANDE = 14;
/** A maior largura da moldura do mosaico inteiro, em px (a de antes do palco). */
const MAIOR_MOSAICO_INTEIRO = 1120;

// Os textos: as etiquetas e os nomes ditos. A tela "minha" é a de quem a compartilha (o voce dela no palco).
const nomeDe = (q) => (q.nome === '' ? 'Participante' : q.nome);

function etiquetaDe(q, minha) {
  if (q.tipo === 'voce') return 'Você';
  if (q.tipo === 'tela') return minha ? 'A sua tela' : `Tela de ${nomeDe(q)}`;
  return nomeDe(q);
}

function nomeDito(q, { minha, semCamera }) {
  if (q.tipo === 'voce') return 'A sua câmera';
  const nome = nomeDe(q);
  if (q.tipo === 'tela') {
    if (q.botao) return minha ? 'Aumentar a sua tela' : `Aumentar a tela de ${nome}`;
    return minha ? 'A sua tela' : `A tela de ${nome}`;
  }
  if (q.botao) {
    return semCamera ? `Aumentar o quadro de ${nome}, que está com a câmera desligada` : `Aumentar a câmera de ${nome}`;
  }
  return semCamera ? `${nome}, com a câmera desligada` : `A câmera de ${nome}`;
}

/** Os quadros da reunião. O relogio é o da página: {agora(), depois(ms, fn)}. */
export function criarQuadros({ raiz, relogio }) {
  const mosaico = raiz.querySelector('#mosaico');
  const moldura = raiz.querySelector('.moldura');
  const lugar = raiz.querySelector('.quadros');
  const gire = raiz.querySelector('.gire');
  const voltar = new Map([...raiz.querySelectorAll('[data-voltar]')].map((b) => [b.dataset.voltar, b]));
  // O título da reunião: o lugar do foco que a arrumação tirou da tela, como no pagina.js.
  const titulo = raiz.closest('[data-tela]')?.querySelector('h1[tabindex="-1"]') ?? null;

  // O que o pagina.js deu no último desenho.
  let naReuniao = false;
  let palco = null;
  let cam = 'ligado';
  let fluxo = null;
  // A sincronia: a memória do sincronizar (null fora dela), o tamanho da última imagem e o último resultado.
  let mem = null;
  let video = null;
  let visto = null; // {modo, palco, esperando}: o último resultado, que fica parado fora da sincronia
  let palcoVisto = null; // o palco do último resultado, para o aoMudarOPalco (ele fica entre uma ligação e outra)
  let aumentado = null;
  let pedido = null; // o requestVideoFrameCallback (ou o requestAnimationFrame) que espera a próxima imagem
  let alvo = null; // o agora em que o relogio.depois marcado avalia de novo
  let vez = 0; // a vez do depois marcado: o de uma vez que passou fica de fora
  // Os quadros na tela: chave → {el, q, canvas, video, mostra, solto}; a faixa; e a última arrumação.
  const quadros = new Map();
  let faixa = null;
  let arrumado = null;
  let faixasDoVoce = null; // as faixas de câmera vivas que o <video> do Você recebeu

  // ---- A sincronia: o sincronizar a cada imagem, e o depois que o proximo pede. ----

  function comecarASincronia() {
    mem = sincroniaInicial(relogio.agora());
    video = null;
    visto = null;
    alvo = null;
    vez++;
    esperarAImagem();
  }

  // Fora da sincronia (a conexão caiu), a tela fica como estava, por baixo do cartão da conexão caída.
  function pararASincronia() {
    mem = null;
    alvo = null;
    vez++;
    if (pedido === null) return;
    if (typeof mosaico.cancelVideoFrameCallback === 'function') mosaico.cancelVideoFrameCallback(pedido);
    else cancelAnimationFrame(pedido);
    pedido = null;
  }

  // O tamanho da imagem é o do requestVideoFrameCallback; sem ele, o do elemento, lido a cada requestAnimationFrame.
  function esperarAImagem() {
    if (typeof mosaico.requestVideoFrameCallback === 'function') {
      pedido = mosaico.requestVideoFrameCallback((_, imagem) => aoVerAImagem({ l: imagem.width, a: imagem.height }));
    } else {
      pedido = requestAnimationFrame(() => {
        const { videoWidth: l, videoHeight: a } = mosaico;
        aoVerAImagem(l > 0 && a > 0 ? { l, a } : null);
      });
    }
  }

  // A próxima imagem é pedida sempre, mesmo quando esta lança: sem ela, os quadros parariam até a próxima ligação.
  function aoVerAImagem(tamanho) {
    pedido = null;
    if (mem === null) return;
    try {
      if (tamanho !== null) video = tamanho;
      mostrarOsSoltos();
      avaliar();
      pintar();
    } finally {
      if (mem !== null) esperarAImagem();
    }
  }

  // Quem o sincronizar soltou da espera antes desta imagem passa a mostrar o vídeo com ela. Uma imagem de antes do fim
  // da espera (o vídeo parado, numa rede ruim) ainda pode ser a de quem estava na célula antes.
  function mostrarOsSoltos() {
    for (const quadro of quadros.values()) {
      if (!quadro.solto) continue;
      quadro.solto = false;
      quadro.mostra = 'video';
      quadro.el.dataset.mostra = 'video';
    }
  }

  // O sincronizar com o palco e a imagem de agora. A tela é arrumada de novo quando o modo, o palco visto ou os que
  // esperam mudam; o aumentado passa pelo aoMudarOPalco a cada palco visto novo.
  function avaliar() {
    const agora = relogio.agora();
    const r = sincronizar(mem, { palco, video, agora });
    mem = r.mem;
    marcar(r.proximo === null ? null : agora + r.proximo);
    const novo = { modo: r.modo, palco: r.palco, esperando: r.esperando };
    if (visto && novo.modo === visto.modo && novo.palco === visto.palco && mesmas(novo.esperando, visto.esperando)) {
      return;
    }
    if (novo.palco !== palcoVisto) aumentado = aoMudarOPalco(aumentado, palcoVisto, novo.palco);
    palcoVisto = novo.palco;
    visto = novo;
    arrumarATela();
  }

  function marcar(quando) {
    if (quando === alvo) return;
    alvo = quando;
    const minha = ++vez;
    if (quando === null) return;
    relogio.depois(Math.max(0, quando - relogio.agora()), () => {
      if (minha !== vez || mem === null) return;
      alvo = null;
      avaliar();
    });
  }

  // ---- A arrumação: os quadros no lugar que o arrumar dá. ----

  // Antes do primeiro resultado da sincronia, os quadros mostram o fundo escuro.
  function oQueSeVe() {
    if (visto) return visto;
    return { modo: 'espera', palco, esperando: palco ? palco.quadros.map(chaveDe) : [] };
  }

  function arrumarATela() {
    if (!naReuniao) return;
    const { modo, palco: p, esperando } = oQueSeVe();
    const emPe = window.innerWidth <= 600 && window.innerHeight > window.innerWidth;
    // O foco antes de mexer no DOM: o elemento que sai da página o leva junto.
    const foco = focoAntes();
    raiz.dataset.modo = modo;
    raiz.toggleAttribute('data-em-pe', emPe);
    // O mosaico fora da vista fica fora dos leitores de tela: os quadros já dizem quem está nele.
    if (modo === 'mosaico') moldura.removeAttribute('aria-hidden');
    else moldura.setAttribute('aria-hidden', 'true');
    if (modo === 'mosaico') {
      tirarTudo();
      medirAMoldura();
      devolverOFoco(foco);
      return;
    }
    // Fora do mosaico inteiro, a largura dele sairia por cima do 1 px da regra que esconde a moldura.
    moldura.style.width = '';
    const area = { l: raiz.clientWidth, a: raiz.clientHeight };
    arrumado = arrumar({ palco: p, area, emPe, aumentado });
    const doPalco = p?.quadros ?? [];
    const minhas = new Set(doPalco.filter((q) => q.tela && q.voce).map(chaveDe));
    const semCamera = new Set(doPalco.filter((q) => q.semCamera).map(chaveDe));
    const espera = new Set(esperando);
    porAFaixa(arrumado.faixa);
    const vistos = new Set();
    const filhos = { area: [], faixa: [] };
    for (const q of arrumado.quadros) {
      vistos.add(q.chave);
      const quadro = porOQuadro(q, mostraDe(q, semCamera, espera), minhas.has(q.chave));
      filhos[q.papel === 'faixa' ? 'faixa' : 'area'].push(quadro.el);
    }
    for (const [chave, quadro] of quadros) {
      if (!vistos.has(chave)) {
        quadro.el.remove();
        quadros.delete(chave);
      }
    }
    ordenar(lugar, faixa ? [...filhos.area, faixa] : filhos.area);
    if (faixa) ordenar(faixa, filhos.faixa);
    porOVoltar(arrumado);
    porOGire(arrumado.gire);
    devolverOFoco(foco);
    pintar();
  }

  // O mosaico inteiro: a moldura com o maior 16:9 que cabe na área, até MAIOR_MOSAICO_INTEIRO; a altura é a do
  // aspect-ratio. A largura vem da medida da área, e não das unidades do container: um navegador as deixou em zero.
  function medirAMoldura() {
    const l = raiz.clientWidth;
    const a = raiz.clientHeight;
    moldura.style.width = l > 0 && a > 0 ? `${Math.floor(Math.min(l, MAIOR_MOSAICO_INTEIRO, (a * 16) / 9))}px` : '';
  }

  // O foco de antes da arrumação, só quando ele está no palco (o dos controles nunca é tocado): o elemento, o quadro
  // dele e quem era o grande.
  function focoAntes() {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !raiz.contains(el)) return null;
    return { el, chave: el.dataset.quadro ?? null, grande: arrumado?.grande ?? null };
  }

  // Depois da arrumação, o foco que estava no palco continua num lugar que faz sentido, e nunca no body: o mesmo
  // elemento, se ele ainda está na tela e é botão (o que só mudou de lugar o perdeu, e volta); senão, o quadro de quem
  // era o grande, se ele é botão; senão, o quadro da mesma pessoa, se ele é botão; senão, o título da reunião.
  function devolverOFoco(foco) {
    if (foco === null) return;
    const botaoNaTela = (el) => el?.tagName === 'BUTTON' && el.isConnected && !el.disabled && !el.closest('[hidden]');
    const destino = [
      foco.el,
      quadros.get(foco.grande)?.el,
      quadros.get(foco.chave)?.el,
    ].find(botaoNaTela) ?? titulo;
    if (destino && document.activeElement !== destino) destino.focus({ preventScroll: true });
  }

  // O Você mostra a câmera própria, pelo cam da página (e não pelo semCamera do palco).
  function mostraDe(q, semCamera, espera) {
    if (q.tipo === 'voce') return cam === 'ligado' ? 'video' : 'sem-camera';
    if (q.tipo === 'camera' && semCamera.has(q.chave)) return 'sem-camera';
    return espera.has(q.chave) ? 'espera' : 'video';
  }

  // A faixa: um grupo com o nome dito dela, que rola no eixo dela.
  function porAFaixa(f) {
    if (!f) {
      faixa?.remove();
      faixa = null;
      return;
    }
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.className = 'faixa';
      faixa.setAttribute('role', 'group');
    }
    faixa.dataset.eixo = f.eixo;
    if (faixa.getAttribute('aria-label') !== f.rotulo) faixa.setAttribute('aria-label', f.rotulo);
    posicionar(faixa, f);
  }

  // Os filhos na ordem dada, mexendo só nos que estão fora dela. O elemento com o foco que muda de lugar o perde: quem
  // chama o devolve.
  function ordenar(pai, filhos) {
    let antes = pai.firstChild;
    for (const filho of filhos) {
      if (filho === antes) {
        antes = antes.nextSibling;
        continue;
      }
      pai.insertBefore(filho, antes);
    }
    while (antes) {
      const proximo = antes.nextSibling;
      antes.remove();
      antes = proximo;
    }
  }

  // ---- Um quadro: criar, mudar e tirar. ----

  function porOQuadro(q, mostra, minha) {
    let quadro = quadros.get(q.chave);
    const elemento = q.botao ? 'BUTTON' : 'DIV';
    let esperava = false; // o quadro trocado leva a espera do que sai
    if (quadro && (quadro.el.tagName !== elemento || quadro.q.tipo !== q.tipo)) {
      esperava = quadro.mostra === 'espera';
      quadro.el.remove();
      quadros.delete(q.chave);
      quadro = null;
    }
    if (!quadro) {
      quadro = criarOQuadro(q);
      quadro.solto = esperava;
      quadros.set(q.chave, quadro);
    }
    mudarOQuadro(quadro, q, mostra, minha);
    return quadro;
  }

  function criarOQuadro(q) {
    const el = document.createElement(q.botao ? 'button' : 'div');
    el.className = q.tipo === 'tela' ? 'quadro quadro-tela' : 'quadro';
    el.dataset.quadro = q.chave;
    if (q.botao) el.type = 'button';
    else el.setAttribute('role', 'img');
    const quadro = { el, q, canvas: null, video: null, mostra: null, solto: false, nome: null, centro: null };
    if (q.tipo === 'voce') {
      quadro.video = document.createElement('video');
      quadro.video.muted = true;
      quadro.video.autoplay = true;
      quadro.video.playsInline = true;
      quadro.video.setAttribute('muted', '');
      quadro.video.setAttribute('playsinline', '');
      el.append(quadro.video);
      faixasDoVoce = null;
    } else {
      quadro.canvas = document.createElement('canvas');
      el.append(quadro.canvas);
    }
    quadro.centro = document.createElement('span');
    quadro.centro.className = 'quadro-centro';
    quadro.centro.append(document.createElement('span'));
    const etiqueta = document.createElement('span');
    etiqueta.className = 'etiqueta';
    if (q.tipo === 'tela') etiqueta.append(icone('i-tela'));
    quadro.nome = document.createElement('span');
    etiqueta.append(quadro.nome);
    el.append(quadro.centro, etiqueta);
    if (q.botao) {
      const pilula = document.createElement('span');
      pilula.className = 'pilula';
      pilula.setAttribute('aria-hidden', 'true');
      const texto = document.createElement('span');
      texto.textContent = 'Aumentar';
      pilula.append(icone('i-aumentar'), texto);
      el.append(pilula);
    }
    return quadro;
  }

  // O quadro que sai da espera continua nela, solto, até a próxima imagem do mosaico (o mostrarOsSoltos): nem o
  // relógio, nem um desenho do estado, nem a janela que muda de tamanho o pintam com a imagem de antes.
  function mudarOQuadro(quadro, q, mostra, minha) {
    const { el } = quadro;
    quadro.q = q;
    if (el.dataset.papel !== q.papel) el.dataset.papel = q.papel;
    const solto = mostra === 'video' && (quadro.mostra === 'espera' || quadro.solto);
    quadro.solto = solto;
    if (solto) mostra = 'espera';
    if (quadro.mostra !== mostra) {
      quadro.mostra = mostra;
      el.dataset.mostra = mostra;
      if (mostra !== 'video') limpar(quadro);
    }
    const etiqueta = etiquetaDe(q, minha);
    texto(quadro.nome, etiqueta);
    texto(quadro.centro.firstChild, etiqueta);
    const dito = nomeDito(q, { minha, semCamera: mostra === 'sem-camera' });
    if (el.getAttribute('aria-label') !== dito) el.setAttribute('aria-label', dito);
    posicionar(el, q);
    if (quadro.canvas) medirOCanvas(quadro, q);
    if (quadro.video) alimentarOVoce(quadro);
  }

  // O canvas com o tamanho do quadro vezes o devicePixelRatio (até 2). Mudar o tamanho o apaga: ele é pintado de novo.
  function medirOCanvas(quadro, q) {
    const escala = Math.min(MAX_PIXELS_POR_PONTO, window.devicePixelRatio || 1);
    const l = Math.round(q.l * escala);
    const a = Math.round(q.a * escala);
    if (quadro.canvas.width !== l) quadro.canvas.width = l;
    if (quadro.canvas.height !== a) quadro.canvas.height = a;
  }

  // O <video> do Você recebe o fluxo de novo quando as faixas de câmera vivas dele mudam: a faixa que entra num fluxo
  // que ele já mostra sai esticada no Chromium.
  function alimentarOVoce(quadro) {
    const vivas = (fluxo?.getVideoTracks() ?? [])
      .filter((f) => f.readyState === 'live')
      .map((f) => f.id)
      .join(' ');
    if (quadro.video.srcObject === fluxo && vivas === faixasDoVoce) return;
    faixasDoVoce = vivas;
    quadro.video.srcObject = fluxo;
  }

  function tirarTudo() {
    for (const { el } of quadros.values()) el.remove();
    quadros.clear();
    faixa?.remove();
    faixa = null;
    arrumado = null;
    faixasDoVoce = null;
    for (const b of voltar.values()) b.hidden = true;
    gire.hidden = true;
  }

  // ---- O botão de voltar e o aviso de girar. ----

  function porOVoltar(a) {
    const grande = a.quadros.find((q) => q.papel === 'grande');
    for (const [qual, b] of voltar) {
      const aparece = a.voltar === qual && grande !== undefined;
      b.hidden = !aparece;
      if (!aparece) continue;
      b.style.left = `${grande.x + AFASTAR_DO_GRANDE}px`;
      b.style.top = `${grande.y + AFASTAR_DO_GRANDE}px`;
    }
  }

  function porOGire(g) {
    gire.hidden = g === null;
    if (g) posicionar(gire, g);
  }

  // ---- A pintura: só os quadros que mostram o vídeo, com o pedaço do mosaico de cada um. ----

  function pintar() {
    if (visto?.modo !== 'quadros' || !visto.palco) return;
    // A imagem que o elemento tem agora precisa ser do tamanho do palco: uma de outro tamanho, que ainda não passou
    // pelo sincronizar, mostraria uma pessoa no quadro de outra.
    if (mosaico.videoWidth !== visto.palco.largura || mosaico.videoHeight !== visto.palco.altura) return;
    for (const quadro of quadros.values()) {
      const { q, canvas } = quadro;
      if (!canvas || quadro.mostra !== 'video' || !q.recorte) continue;
      if (canvas.width === 0 || canvas.height === 0) continue;
      const { sx, sy, sl, sa, dx, dy, dl, da } = recortar(q.recorte, { l: canvas.width, a: canvas.height }, q.corte);
      if (dl <= 0 || da <= 0) continue;
      // Sem contexto (o limite de memória dos canvas do Safari), esse quadro fica sem esta pintura, e os outros não.
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      if (q.corte === 'inteiro') ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(mosaico, sx, sy, sl, sa, dx, dy, dl, da);
    }
  }

  // O quadro que deixa de mostrar o vídeo fica sem a última imagem: o fundo escuro aparece no lugar dela.
  function limpar({ canvas }) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ---- Os cliques, o Esc e o foco. ----

  // O clique num quadro que é botão aumenta (a tela da faixa volta a ser a grande). O foco vai ao botão de voltar; sem
  // ele, ao quadro de quem estava grande.
  lugar.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-quadro]');
    if (!b || !arrumado) return;
    const q = arrumado.quadros.find((x) => x.chave === b.dataset.quadro);
    if (!q) return;
    trocarOAumentado(q.tipo === 'tela' ? null : q.chave);
  });

  for (const b of voltar.values()) b.addEventListener('click', () => trocarOAumentado(null));

  // O Esc só age na reunião, com uma câmera aumentada, e deixa o resto do teclado da página em paz.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || !naReuniao || !arrumado?.voltar) return;
    ev.preventDefault();
    trocarOAumentado(null);
  });

  function trocarOAumentado(novo) {
    const antes = aumentado;
    if (novo === antes) return;
    aumentado = novo;
    arrumarATela();
    if (!arrumado) return;
    if (arrumado.voltar) {
      voltar.get(arrumado.voltar)?.focus();
    } else if (antes !== null) {
      const el = quadros.get(antes)?.el;
      if (el?.tagName === 'BUTTON') el.focus();
    }
  }

  // ---- A área que muda de tamanho e o celular que gira. ----

  if (typeof ResizeObserver === 'function') new ResizeObserver(() => arrumarATela()).observe(raiz);
  window.addEventListener('resize', () => arrumarATela());

  // Fora da reunião (a página saiu dela, ou vai embora), a sincronia para, e os quadros e o aumentado saem. O
  // ResizeObserver e os ouvintes do resize e do keydown ficam pela vida da página: fora da reunião, eles não fazem nada.
  function sair() {
    naReuniao = false;
    pararASincronia();
    visto = null;
    palcoVisto = null;
    aumentado = null;
    tirarTudo();
    moldura.style.width = '';
  }

  return {
    desenhar(e) {
      if (!e.naReuniao) {
        if (naReuniao) sair();
        return;
      }
      naReuniao = true;
      palco = e.palco;
      cam = e.cam;
      fluxo = e.fluxo;
      if (e.noAr && mem === null) comecarASincronia();
      else if (!e.noAr && mem !== null) pararASincronia();
      if (mem !== null) avaliar();
      arrumarATela();
    },
    parar: sair,
  };
}

function posicionar(el, { x, y, l, a }) {
  const s = el.style;
  const lado = (n) => `${n}px`;
  if (s.left !== lado(x)) s.left = lado(x);
  if (s.top !== lado(y)) s.top = lado(y);
  if (s.width !== lado(l)) s.width = lado(l);
  if (s.height !== lado(a)) s.height = lado(a);
}

function icone(id) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

// O texto do elemento, mudado só quando é outro.
function texto(el, valor) {
  if (el.textContent !== valor) el.textContent = valor;
}

const mesmas = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
