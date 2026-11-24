// O painel "Participantes" da página do colega: quem espera para entrar (com o Recusar e o Aceitar), quem está na
// reunião (com o Tirar em dois cliques) e o Encerrar para todos, com a pergunta dele num diálogo. Ele desenha o que o
// cérebro (estado.js) guarda; não fala com a rede. Fica no lugar do painel do chat, com a mesma regra: ao lado dos
// quadros no PC, e cobrindo a tela onde o ponteiro é o dedo ou a janela é estreita. Os cliques nos botões (o data-botao,
// com o id da linha no data-id) chegam ao cérebro pelo ouvinte do pagina.js; o aoClique leva o que não é um clique (o
// Esc e o Voltar do aparelho). O nome de uma pessoa entra sempre como texto, e nada daqui vai ao console.
//
// Sem o canal, com a página tentando voltar (o religar, ou a entrada de novo dentro do app), as respostas ficam
// desligadas, e a linha do alto diz que os pedidos voltam. Quem deixou de cuidar da reunião vê o aviso no lugar das
// listas e do pé. Antes de a primeira lista chegar, a parte de quem está na reunião não diz zero: ela fica escondida, e
// o Encerrar para todos, desligado.
import { AVISO_SEM_CUIDAR, fraseDoEncerrar, nomeNaLista } from './colega.js';
import { podeResponder } from './estado.js';

/** O painel ao lado é do PC: a janela de 900 px ou mais, com ponteiro de mouse (a regra do painel do chat). */
const AO_LADO = '(min-width: 900px) and (pointer: fine)';

const MARCAS = [
  ['voce', 'você'],
  ['deFora', 'de fora'],
  ['tela', 'compartilhando a tela'],
];

/**
 * O painel Participantes. A raiz é o <aside class="gente">; o fundo, os elementos que ficam atrás dele quando ele cobre
 * a tela; o relogio dá o agora das frases do Encerrar para todos; o aoClique(tipo, id) leva ao cérebro o que a pessoa
 * fez fora de um clique. O diálogo do Encerrar para todos é o que o botão dele controla (o aria-controls).
 */
export function criarParticipantes({ raiz, fundo, relogio, aoClique }) {
  const um = (seletor) => raiz.querySelector(seletor);
  const meio = raiz.parentElement;
  const titulo = um('h2');
  const esperando = um('.gente-esperando');
  const rotuloDeQuemEspera = um('#gente-esperando');
  const listaDePedidos = um('.gente-pedidos');
  const cheia = um('.gente-cheia');
  const semCanal = um('.gente-sem-canal');
  const semCuidar = um('.gente-sem-cuidar');
  const dentro = um('.gente-dentro');
  const rotuloDeQuemEsta = um('#gente-dentro');
  const pe = um('.gente-pe');
  const listaDePessoas = um('.gente-pessoas');
  const encerrar = um('[data-botao="encerrar"]');
  const dialogo = raiz.ownerDocument.getElementById(encerrar.getAttribute('aria-controls'));
  const frases = dialogo.querySelector('.encerrar-frases');
  const aoLado = window.matchMedia(AO_LADO);

  let aberto = false;
  let desenhada = null; // a lista, a pergunta e o canal do último desenho: {lista, tirando, desligadas}
  const linhas = { pedidos: new Map(), pessoas: new Map() }; // o id → {li, chave}
  let ids = 0; // o número dos ids dos nomes, para o aria-describedby

  // ---- Ao lado ou cobrindo, como o painel do chat. ----

  // O modo, o painel à vista ou não, e o que fica atrás dele. A área dos quadros abre espaço com a classe com-gente (a
  // do chat é outra). Cobrindo a tela, o que está atrás sai do teclado e dos leitores de tela; o fundo é o mesmo do
  // chat, e este painel só mexe nele quando ele mesmo passa a cobrir ou deixa de cobrir: fechado, ele não desfaz o
  // inert que o chat aberto pôs.
  let cobria = false;

  function arrumar() {
    const modo = aoLado.matches ? 'lado' : 'cobre';
    raiz.dataset.modo = modo;
    raiz.hidden = !aberto;
    meio.classList.toggle('com-gente', aberto && modo === 'lado');
    const cobre = aberto && modo === 'cobre';
    if (cobre !== cobria) {
      for (const el of fundo) el.inert = cobre;
      cobria = cobre;
    }
    acertarOHistorico();
  }

  // Cobrindo a tela, o painel parece outra tela, e o Voltar do aparelho tem de fechá-lo, e não sair da página (que é
  // sair da reunião): ele ganha uma entrada no histórico do navegador, que o Voltar desfaz (o popstate). Fechado de
  // outro jeito, ou passando para o lado, é o painel que desfaz a entrada dele. É o mesmo jeito do chat, com uma
  // entrada só dele.
  let entrada = false; // há uma entrada do painel no histórico
  let voltando = false; // o painel pediu o history.back(), e o popstate dele ainda não chegou

  function acertarOHistorico() {
    if (voltando) return; // o popstate acerta de novo quando chegar
    const cobrindo = aberto && raiz.dataset.modo === 'cobre';
    if (cobrindo && !entrada) {
      try {
        window.history.pushState({ participantesDaReuniao: true }, '');
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
    if (!entrada) return; // um popstate que não é do painel
    entrada = false;
    if (aberto) aoClique('fecharParticipantes');
  });

  // A janela que cruza os 900 px com o painel aberto: o foco que ficaria atrás do painel que cobre vai ao título dele.
  aoLado.addEventListener?.('change', () => {
    arrumar();
    if (aberto && raiz.dataset.modo === 'cobre' && !raiz.contains(document.activeElement)) titulo.focus();
  });

  // O aviso inteiro, letra por letra, é o que o leitor de tela também ouve: ele vem do colega.js, sempre como texto.
  semCuidar.textContent = AVISO_SEM_CUIDAR;

  // ---- As linhas. ----

  function elemento(tag, classe, texto) {
    const el = document.createElement(tag);
    el.className = classe;
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  function botao(classe, qual, id, texto) {
    const b = elemento('button', classe, texto);
    b.type = 'button';
    b.dataset.botao = qual;
    b.dataset.id = id;
    return b;
  }

  // Quem espera: o nome e os dois botões, que dizem de quem são ao leitor de tela (o aria-describedby). O cartão recebe
  // o foco do Ver os pedidos.
  function linhaDoPedido(li, p) {
    const nome = elemento('bdi', 'gente-pedido-nome', nomeNaLista(p.nome));
    nome.id = `gente-nome-${++ids}`;
    const botoes = elemento('div', 'gente-pedido-botoes');
    const recusar = botao('gente-botao gente-recusar', 'recusar', p.id, 'Recusar');
    const aceitar = botao('gente-botao gente-aceitar', 'aceitar', p.id, 'Aceitar');
    for (const b of [recusar, aceitar]) b.setAttribute('aria-describedby', nome.id);
    botoes.append(recusar, aceitar);
    li.className = 'gente-pedido';
    li.tabIndex = -1;
    li.replaceChildren(nome, botoes);
  }

  // Quem está na reunião: o nome, as marcas e o Tirar (a própria pessoa não o tem); ou, com a pergunta, "Tirar
  // <Nome>?" com o Voltar e o Tirar. O Voltar leva a pergunta ao leitor de tela, porque é ele que recebe o foco.
  function linhaDaPessoa(li, p, perguntando) {
    li.className = 'gente-pessoa';
    if (perguntando) {
      const pergunta = elemento('p', 'gente-pergunta', `Tirar ${nomeNaLista(p.nome)}?`);
      pergunta.id = `gente-pergunta-${++ids}`;
      const botoes = elemento('div', 'gente-pergunta-botoes');
      const voltar = botao('gente-botao gente-nao-tirar', 'naoTirar', p.id, 'Voltar');
      voltar.setAttribute('aria-describedby', pergunta.id);
      botoes.append(voltar, botao('gente-botao gente-tirar-mesmo', 'tirarMesmo', p.id, 'Tirar'));
      li.replaceChildren(pergunta, botoes);
      return;
    }
    const quem = elemento('span', 'gente-quem');
    quem.append(elemento('bdi', 'gente-nome', nomeNaLista(p.nome)));
    for (const [campo, marca] of MARCAS) if (p[campo]) quem.append(elemento('span', 'gente-marca', marca));
    li.replaceChildren(quem);
    if (p.voce) return;
    const tirar = botao('gente-tirar', 'tirar', p.id, 'Tirar');
    tirar.setAttribute('aria-label', `Tirar ${nomeNaLista(p.nome)} da reunião`);
    li.append(tirar);
  }

  // A lista da tela fica igual à do cérebro, pelo id de cada linha e na ordem dele: a linha nova é criada, a que mudou
  // (a chave dela) é desenhada de novo no lugar, e a que saiu é tirada. A linha que não mudou fica como está, com o
  // foco que tiver.
  function acertarAsLinhas(ul, mapa, itens, chaveDe, desenharALinha) {
    const vistos = new Set();
    let lugar = ul.firstElementChild;
    for (const item of itens) {
      vistos.add(item.id);
      const chave = chaveDe(item);
      let linha = mapa.get(item.id);
      if (!linha) {
        linha = { li: document.createElement('li'), chave: null };
        mapa.set(item.id, linha);
      }
      if (linha.chave !== chave) {
        desenharALinha(linha.li, item);
        linha.chave = chave;
      }
      if (linha.li === lugar) lugar = lugar.nextElementSibling;
      else ul.insertBefore(linha.li, lugar);
    }
    for (const [id, linha] of mapa) {
      if (vistos.has(id)) continue;
      linha.li.remove();
      mapa.delete(id);
    }
  }

  // As respostas de cada linha (o Aceitar, o Recusar, o Tirar e o Tirar da pergunta) ficam desligadas sem o canal. O
  // Voltar da pergunta não é uma resposta: fica ligado.
  function desligarAsRespostas(desligadas) {
    for (const b of raiz.querySelectorAll('.gente-lista button[data-botao]')) {
      if (b.dataset.botao !== 'naoTirar') b.disabled = desligadas;
    }
  }

  function desenharAsListas(lista, tirando, desligadas) {
    if (desenhada?.lista === lista && desenhada.tirando === tirando && desenhada.desligadas === desligadas) return;
    desenhada = { lista, tirando, desligadas };
    const { pedidos, participantes } = lista;
    esperando.hidden = pedidos.length === 0;
    rotuloDeQuemEspera.textContent = `ESPERANDO PARA ENTRAR · ${pedidos.length}`;
    acertarAsLinhas(listaDePedidos, linhas.pedidos, pedidos, (p) => p.nome, linhaDoPedido);
    dentro.hidden = participantes.length === 0;
    rotuloDeQuemEsta.textContent = `NA REUNIÃO · ${participantes.length}`;
    acertarAsLinhas(
      listaDePessoas,
      linhas.pessoas,
      participantes,
      (p) => JSON.stringify([p.nome, p.voce, p.deFora, p.tela, p.id === tirando]),
      (li, p) => linhaDaPessoa(li, p, p.id === tirando),
    );
    desligarAsRespostas(desligadas);
  }

  // ---- O Encerrar para todos. ----

  // A pergunta é um diálogo modal: o resto da página sai do teclado e dos leitores de tela enquanto ele está aberto. O
  // Tab e o Shift+Tab dão a volta entre os botões dele, sem sair para o navegador.
  function desenharOEncerrar(e, aberta) {
    if (aberta) {
      const n = e.lista.participantes.length;
      frases.textContent = fraseDoEncerrar(n, e.reuniao?.tipo, e.colega?.valeAte ?? null, relogio.agora()).join(' ');
      if (!dialogo.open) dialogo.showModal();
    } else if (dialogo.open) {
      dialogo.close();
    }
  }

  dialogo.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === 'Escape') {
      // O Esc é o Voltar: o diálogo fecha pelo cérebro, e nada mais na página trata esse Esc.
      ev.preventDefault();
      aoClique('naoEncerrar');
      return;
    }
    if (ev.key !== 'Tab') return;
    const botoes = [...dialogo.querySelectorAll('button')];
    const i = botoes.indexOf(document.activeElement);
    const proximo = ev.shiftKey ? (i <= 0 ? botoes.length - 1 : i - 1) : (i + 1) % botoes.length;
    ev.preventDefault();
    botoes[proximo].focus();
  });
  // O diálogo que o navegador fecha sozinho (o Voltar do aparelho, por exemplo) também é o Voltar. O que fecha pelo
  // cérebro chega aqui com a pergunta já desfeita, e o naoEncerrar não muda nada.
  dialogo.addEventListener('close', () => aoClique('naoEncerrar'));

  // O Esc dentro do painel fecha o painel, e só ele: o evento fica marcado como tratado.
  raiz.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    aoClique('fecharParticipantes');
  });

  // ---- O que o pagina.js chama. ----

  /**
   * Desenha o painel e a pergunta do Encerrar para todos com o estado do cérebro. São só do colega, na tela da reunião.
   * O foco que estava numa linha que o desenho tirou fica no painel.
   */
  function desenhar(e) {
    const doColega = e.colega !== null && e.tela === 'reuniao';
    const tinhaOFoco = raiz.contains(document.activeElement);
    const abrir = doColega && e.gente;
    if (abrir !== aberto) {
      aberto = abrir;
      arrumar();
    }
    // Sem o canal, com a página tentando voltar; quem deixou de cuidar tem o aviso, e não a linha.
    const desligadas = doColega && !podeResponder(e);
    semCanal.hidden = !desligadas || e.semCuidar;
    semCuidar.hidden = !(doColega && e.semCuidar);
    pe.hidden = doColega && e.semCuidar;
    encerrar.disabled = desligadas || e.lista.participantes.length === 0;
    desenharAsListas(e.lista, e.tirando, desligadas);
    cheia.hidden = !e.cheiaAoAceitar;
    desenharOEncerrar(e, doColega && e.encerrando);
    if (tinhaOFoco && aberto && !raiz.contains(document.activeElement) && !dialogo.open) focar();
  }

  /**
   * O foco vai ao título do painel; com o alvo, ao que o cérebro pediu: o primeiro de quem espera (cartao), o
   * Encerrar para todos (encerrar), o Voltar da pergunta dele (naoEncerrar), e, na linha do id, o Tirar (tirar) ou o
   * Voltar da pergunta "Tirar <Nome>?" (naoTirar). O que não está na tela deixa o foco no título.
   */
  function focar(alvo, id) {
    if (alvo === 'naoEncerrar') {
      if (dialogo.open) dialogo.querySelector('[data-botao="naoEncerrar"]').focus();
      return;
    }
    if (!aberto) return;
    const el = {
      cartao: () => listaDePedidos.firstElementChild,
      encerrar: () => encerrar,
      tirar: () => linhas.pessoas.get(id)?.li.querySelector('[data-botao="tirar"]'),
      naoTirar: () => linhas.pessoas.get(id)?.li.querySelector('[data-botao="naoTirar"]'),
    }[alvo]?.();
    (el ?? titulo).focus();
  }

  arrumar();
  return { desenhar, focar };
}
