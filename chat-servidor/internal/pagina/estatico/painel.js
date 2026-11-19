// O painel do chat da reunião (docs/chat-protocolo.md, seção 10): a lista das mensagens, o campo de escrever, o teclado
// e a rolagem. Ele desenha o que o cérebro (estado.js) guarda e devolve o que a pessoa faz pelas funções que recebe; não
// fala com a rede. Fica ao lado dos quadros no PC, e cobre a tela onde o ponteiro é o dedo ou a janela é estreita. O
// texto de uma pessoa (a mensagem e o nome) entra sempre como texto: num nó de texto, ou pelo textContent, e nunca como
// HTML. Nada daqui vai ao console.
import { falha, hora, partes, quem, textoLimpo } from './mensagens.js';

/** O painel ao lado é do PC: a janela de 900 px ou mais, com ponteiro de mouse. Nos outros casos, ele cobre a tela. */
const AO_LADO = '(min-width: 900px) and (pointer: fine)';
/** A lista acompanha o fim quando está a até 80 px dele. */
const PERTO_DO_FIM = 80;
/** O campo cresce com o texto até 120 px de altura, e depois rola por dentro. */
const MAX_DO_CAMPO = 120;

/**
 * O painel do chat. A raiz é o <aside class="painel">; o fundo, os elementos que ficam atrás dele quando ele cobre a
 * tela (o alto da reunião, a área dos quadros e os controles); o toque diz se o ponteiro é o dedo. O aoEscrever(texto),
 * o aoReenviar(n) e o aoFechar() levam ao cérebro o que a pessoa fez.
 */
export function criarPainel({ raiz, fundo, toque, aoEscrever, aoReenviar, aoFechar }) {
  const um = (seletor) => raiz.querySelector(seletor);
  const meio = raiz.parentElement;
  const titulo = um('h2');
  const lista = um('.painel-lista');
  const vazio = um('.painel-vazio');
  const mensagens = um('.painel-mensagens');
  const semCanal = um('.painel-sem-canal');
  const campo = um('.painel-campo');
  const enviar = um('.painel-enviar');
  const aoLado = window.matchMedia(AO_LADO);

  let aberto = false;
  let podeEscrever = false;
  let desenhadas = null; // a lista do último desenho: a mesma lista não é acertada de novo
  const itens = new Map(); // o n de cada mensagem da tela → {li, m}
  let colada = true; // a lista está no fim, ou perto dele: ela acompanha o que muda de tamanho
  let perdeuOFoco = false; // o desenho tirou da tela o que tinha o foco

  // ---- Ao lado ou cobrindo. ----

  // O modo, o painel à vista ou não, e o que fica atrás dele. Cobrindo a tela, o que está atrás sai do teclado e dos
  // leitores de tela.
  function arrumar() {
    const modo = aoLado.matches ? 'lado' : 'cobre';
    raiz.dataset.modo = modo;
    raiz.hidden = !aberto;
    meio.classList.toggle('com-painel', aberto && modo === 'lado');
    for (const el of fundo) el.inert = aberto && modo === 'cobre';
    seguirAJanela();
    crescer();
    acertarOHistorico();
  }

  // Cobrindo a tela, o chat parece outra tela, e o Voltar do aparelho (o botão do Android, o gesto do iPhone) tem de
  // fechá-lo, e não sair da página, que é sair da reunião. Por isso o chat que cobre a tela ganha uma entrada no
  // histórico do navegador: o Voltar a desfaz (o popstate), e o painel fecha. Fechado de outro jeito (a seta, o Esc, o
  // fim da reunião), ou passando para o lado, é o painel que desfaz a entrada dele. Ao lado dos quadros ele não é outra
  // tela, e não mexe no histórico.
  let entrada = false; // há uma entrada do chat no histórico
  let voltando = false; // o painel pediu o history.back(), e o popstate dele ainda não chegou

  function acertarOHistorico() {
    if (voltando) return; // o popstate acerta de novo quando chegar
    const cobrindo = aberto && raiz.dataset.modo === 'cobre';
    if (cobrindo && !entrada) {
      try {
        window.history.pushState({ chatDaReuniao: true }, '');
        entrada = true;
      } catch {
        // o navegador que não deixa: o Voltar continua saindo da página, como antes
      }
    } else if (!cobrindo && entrada) {
      entrada = false;
      voltando = true;
      window.history.back();
    }
  }

  window.addEventListener('popstate', () => {
    if (voltando) {
      voltando = false;
      acertarOHistorico();
      return;
    }
    if (!entrada) return; // um popstate que não é do chat
    entrada = false;
    if (aberto) aoFechar();
  });

  // Cobrindo a tela, o painel fica com a parte visível da janela: o teclado da tela não muda a janela, e sim essa
  // parte (o visualViewport), e sem isso o campo ficaria atrás dele. Com a tela aproximada pelos dedos, não: o painel
  // ficaria do tamanho do pedaço que a pessoa olha.
  function seguirAJanela() {
    const v = window.visualViewport;
    const segue = aberto && raiz.dataset.modo === 'cobre' && Boolean(v) && !(v.scale > 1.01);
    raiz.style.top = segue ? `${v.offsetTop}px` : '';
    raiz.style.height = segue ? `${v.height}px` : '';
    raiz.style.bottom = segue ? 'auto' : '';
  }

  // A janela que cruza os 900 px, com o chat aberto ou não. O que a pessoa escrevia fica, e o foco que ficaria atrás
  // do painel que cobre a tela vai ao título dele. (A lista que estava no fim continua nele: ela muda de tamanho.)
  function aoMudarOModo() {
    arrumar();
    if (aberto && raiz.dataset.modo === 'cobre' && !raiz.contains(document.activeElement)) titulo.focus();
  }

  // ---- A rolagem. ----

  const falta = () => lista.scrollHeight - lista.scrollTop - lista.clientHeight;

  function irAoFim() {
    lista.scrollTop = lista.scrollHeight;
    colada = true;
  }

  // ---- A lista. ----

  // O link mostra o endereço como ele é: escrito da esquerda para a direita, à parte da direção do resto da frase (um
  // sinal de direção antes dele, na mensagem, não muda a ordem das letras do endereço).
  function link(endereco) {
    const a = document.createElement('a');
    a.dir = 'ltr';
    a.href = endereco;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = endereco;
    return a;
  }

  // Uma mensagem nova: quem escreveu e a hora, e o balão, com o texto em partes (o texto e os links).
  function criar(m) {
    const li = document.createElement('li');
    li.className = 'mensagem';
    li.dataset.mensagem = String(m.n);
    li.dataset.de = m.voce ? 'voce' : 'outro';
    const cabeca = document.createElement('p');
    cabeca.className = 'mensagem-quem';
    const nome = document.createElement('bdi');
    nome.className = 'mensagem-nome';
    nome.textContent = quem(m);
    const quando = document.createElement('span');
    quando.className = 'mensagem-hora';
    quando.textContent = ` · ${hora(m.hora)}`;
    cabeca.append(nome, quando);
    const balao = document.createElement('p');
    balao.className = 'mensagem-texto';
    balao.dir = 'auto';
    for (const p of partes(m.texto)) balao.append(p.link ? link(p.link) : document.createTextNode(p.texto));
    li.append(cabeca, balao);
    return li;
  }

  // O que muda numa mensagem depois de criada: a situação e, na que não foi, o motivo e o Tentar de novo.
  function acertar(li, m) {
    li.dataset.situacao = m.situacao;
    let aviso = li.querySelector('.mensagem-falha');
    let botao = li.querySelector('.mensagem-reenviar');
    if (m.situacao !== 'naoEnviada') {
      if (botao && botao === document.activeElement) perdeuOFoco = true;
      aviso?.remove();
      botao?.remove();
      return;
    }
    if (!aviso) {
      aviso = document.createElement('p');
      aviso.className = 'mensagem-falha';
      botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'mensagem-reenviar';
      botao.dataset.reenviar = String(m.n);
      botao.textContent = 'Tentar de novo';
      li.append(aviso, botao);
    }
    aviso.textContent = falha(m.motivo);
    botao.disabled = !podeEscrever;
  }

  // A lista da tela fica igual à do cérebro, pelo n de cada mensagem: a que entra é criada, a que muda de situação é
  // mudada no lugar, e a que saiu é tirada. Devolve se entrou uma mensagem da própria pessoa.
  function acertarALista(doCerebro) {
    if (doCerebro === desenhadas) return false;
    desenhadas = doCerebro;
    let minhaNova = false;
    const vistos = new Set();
    let lugar = mensagens.firstElementChild; // o elemento que está onde a próxima mensagem deve ficar
    for (const m of doCerebro) {
      vistos.add(m.n);
      let item = itens.get(m.n);
      if (!item) {
        item = { li: criar(m), m: null };
        itens.set(m.n, item);
        if (m.voce) minhaNova = true;
      }
      if (item.m !== m) {
        acertar(item.li, m);
        item.m = m;
      }
      if (item.li === lugar) lugar = lugar.nextElementSibling;
      else mensagens.insertBefore(item.li, lugar);
    }
    for (const [n, item] of itens) {
      if (vistos.has(n)) continue;
      if (item.li.contains(document.activeElement)) perdeuOFoco = true;
      item.li.remove();
      itens.delete(n);
    }
    vazio.hidden = doCerebro.length > 0;
    mensagens.hidden = doCerebro.length === 0;
    return minhaNova;
  }

  // ---- O campo de escrever. ----

  // O campo cresce com o texto, até MAX_DO_CAMPO, e depois rola por dentro. Vazio, ou com o painel fora da vista (sem
  // medida), ele fica com a altura do estilo.
  function crescer() {
    if (campo.value === '' || !aberto) {
      campo.style.height = '';
      campo.removeAttribute('data-rola');
      return;
    }
    campo.style.height = 'auto';
    const altura = campo.scrollHeight + (campo.offsetHeight - campo.clientHeight);
    campo.style.height = `${Math.min(altura, MAX_DO_CAMPO)}px`;
    campo.toggleAttribute('data-rola', altura > MAX_DO_CAMPO);
  }

  // O botão de mandar só liga com o canal e com um texto que vale.
  function acertarOEnviar() {
    enviar.disabled = !podeEscrever || textoLimpo(campo.value) === null;
  }

  function esvaziar() {
    campo.value = '';
    crescer();
    acertarOEnviar();
  }

  // O texto que vale sai, e o campo esvazia: a mensagem já aparece na lista, e o cérebro nunca a perde.
  function mandar() {
    const texto = campo.value;
    if (campo.disabled || textoLimpo(texto) === null) return;
    esvaziar();
    aoEscrever(texto);
  }

  // ---- O que a pessoa faz. ----

  campo.addEventListener('input', () => {
    crescer();
    acertarOEnviar();
  });
  // O Enter manda, e o Shift+Enter pula linha. Onde o ponteiro é o dedo, o Enter pula linha, e quem manda é o botão. O
  // Enter que confirma uma composição (o IME) é do teclado, e não da página.
  campo.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || ev.keyCode === 229) return;
    if (toque()) return;
    ev.preventDefault();
    mandar();
  });
  // Depois do botão, o foco volta ao campo: o teclado do celular não desce.
  enviar.addEventListener('click', () => {
    mandar();
    campo.focus();
  });
  mensagens.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-reenviar]');
    if (b && !b.disabled) aoReenviar(Number(b.dataset.reenviar));
  });
  // O Esc dentro do painel fecha o chat, e só ele: o evento fica marcado como tratado, e os quadros não voltam à grade
  // junto. O Esc que cancela uma composição é do teclado.
  raiz.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    aoFechar();
  });

  // A lista que a pessoa rola: no fim, ou perto dele, ela acompanha; mais para cima, fica onde está. Com o painel
  // fechado não há o que medir.
  lista.addEventListener('scroll', () => {
    if (aberto) colada = falta() <= PERTO_DO_FIM;
  });
  // A lista que muda de tamanho (o campo que cresce, o teclado do celular, a janela) continua no fim, se estava nele.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (aberto && colada) irAoFim();
    }).observe(lista);
  }
  aoLado.addEventListener?.('change', aoMudarOModo);
  window.visualViewport?.addEventListener('resize', seguirAJanela);
  window.visualViewport?.addEventListener('scroll', seguirAJanela);

  // ---- O que o pagina.js chama. ----

  /**
   * Desenha o chat: o painel aberto ou não, as mensagens do cérebro, e se a pessoa pode escrever (o canal). Fora da
   * reunião, o que ela escrevia e não mandou some.
   */
  function desenhar(d) {
    const abriu = d.aberto && !aberto;
    const mudou = d.aberto !== aberto;
    // Só a lista que muda puxa a rolagem, e ela é medida antes da mudança.
    const acompanha = aberto && d.aberto && d.mensagens !== desenhadas && falta() <= PERTO_DO_FIM;
    aberto = d.aberto;
    const podia = podeEscrever;
    podeEscrever = d.podeEscrever;
    if (mudou) arrumar();

    const minhaNova = acertarALista(d.mensagens);
    if (podia !== podeEscrever) {
      for (const b of mensagens.querySelectorAll('.mensagem-reenviar')) b.disabled = !podeEscrever;
    }
    campo.disabled = !podeEscrever;
    semCanal.hidden = podeEscrever;
    if (!d.naReuniao && campo.value !== '') esvaziar();
    acertarOEnviar();

    if (aberto && (abriu || acompanha || minhaNova)) irAoFim();
    if (perdeuOFoco) {
      perdeuOFoco = false;
      focar();
    }
  }

  /** O foco vai ao campo de escrever; na tela de toque, ou com o campo desligado, ao título do painel. */
  function focar() {
    if (!aberto) return;
    if (toque() || campo.disabled) titulo.focus();
    else campo.focus();
  }

  arrumar();
  return { desenhar, focar };
}
