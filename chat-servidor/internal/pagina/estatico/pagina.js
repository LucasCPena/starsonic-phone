// A camada da tela da página da reunião. Ela desenha o estado do cérebro (estado.js), transforma os cliques e o nome em
// eventos, e roda os efeitos com os adaptadores: a rede (rede.js), a mídia (midia.js), as ligações (ligacao.js) e o
// relógio. Os eventos que um efeito dá entram numa fila e passam pelo cérebro um de cada vez, depois dos efeitos do
// evento de agora. Nada do estado nem dos efeitos vai ao console: eles levam o bilhete, as senhas, as credenciais do
// TURN e a chave de volta.
import { cabecalho, inicial, nomeValido, quando, transicao } from './estado.js';

// A seção que cada tela do cérebro mostra. O pedindo já é a espera: o pedido saiu, e o Desistir vale nele. O
// carregando não mostra nenhuma.
const SECAO = {
  entrada: 'entrada',
  pedindo: 'aguardando',
  aguardando: 'aguardando',
  naoComecou: 'naoComecou',
  entrando: 'entrando',
  reuniao: 'reuniao',
  aviso: 'aviso',
};

/**
 * Começa a página. A raiz é o elemento com as telas (o body). Os serviços: rede, midia e ligacao são as fábricas dos
 * adaptadores, que recebem a função que leva os eventos ao cérebro; o relogio é {agora(), depois(ms, fn)}.
 */
export function iniciar(raiz, servicos) {
  const um = (seletor) => raiz.querySelector(seletor);
  const todos = (seletor) => [...raiz.querySelectorAll(seletor)];

  const secoes = new Map(todos('[data-tela]').map((s) => [s.dataset.tela, s]));
  const carregando = um('.carregando');
  const nome = um('#nome');
  const pedir = um('[data-botao="pedir"]');
  const som = um('#som');
  const anuncio = um('[data-campo="anuncio"]');
  const contagem = um('[data-aviso="tentativas"] [data-botao="tentarDeNovo"]');
  const compartilhar = um('.controle-compartilhar');
  // O Compartilhar a tela só existe onde o navegador tem a captura da tela.
  const temCaptura = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  let estado = inicial();
  const fila = [];
  let rodando = false;

  function despachar(evento) {
    fila.push(evento);
    if (rodando) return; // um evento dado por um efeito entra depois dos efeitos de agora
    rodando = true;
    try {
      while (fila.length > 0) {
        const foco = document.activeElement;
        const { estado: novo, efeitos } = transicao(estado, fila.shift());
        estado = novo;
        desenhar(estado);
        for (const efeito of efeitos) rodar(efeito);
        manterOFoco(foco);
      }
    } finally {
      rodando = false;
    }
  }

  // O botão com o foco que o desenho escondeu ou desligou (o Tentar de novo do aviso de acesso que deu certo, por
  // exemplo) leva o foco ao título da tela: sem isso, ele cairia no começo da página.
  function manterOFoco(foco) {
    const agora = document.activeElement;
    if (!foco || foco === document.body || (agora !== foco && agora !== document.body)) return;
    if (foco.closest('[hidden]') || foco.disabled) tituloVisivel()?.focus();
  }

  const rede = servicos.rede(despachar);
  const midia = servicos.midia(despachar);
  const ligacao = servicos.ligacao(despachar);
  const { relogio } = servicos;

  function rodar(efeito) {
    try {
      executar(efeito);
    } catch {
      console.error(`A página não conseguiu rodar o efeito ${efeito.tipo}.`); // só o tipo: o efeito leva segredos
    }
  }

  function executar(efeito) {
    switch (efeito.tipo) {
      case 'abrir':
        rede.abrir(efeito.abertura);
        break;
      case 'abrirCanal':
        rede.abrirCanal(efeito.bilhete);
        break;
      case 'mandar':
        rede.mandar(efeito.m);
        break;
      case 'fecharCanal':
        rede.fecharCanal();
        break;
      case 'esperar':
        relogio.depois(efeito.ms, () => despachar({ tipo: 'tempo', chave: efeito.chave }));
        break;
      case 'pedirMidia':
        midia.pedir();
        break;
      case 'pararMidia':
        midia.parar();
        break;
      case 'ligar':
        // O ligar não leva o mic nem a cam: a escolha da pessoa está no fluxo (o enabled das faixas).
        ligacao.ligar({ qual: efeito.qual, senha: efeito.senha, acesso: estado.acesso, fluxo: midia.fluxo() });
        break;
      case 'desligar':
        ligacao.desligar(efeito.qual);
        break;
      case 'trocarCamera':
        ligacao.trocarCamera(efeito.ligada);
        break;
      case 'trocarMicrofone':
        ligacao.trocarMicrofone(efeito.ligado);
        break;
      case 'pararCaptura':
        break; // a captura da tela (o clique do Compartilhar a tela) ainda não existe: não há o que parar
      case 'focar':
        tituloVisivel()?.focus();
        break;
    }
  }

  // ---- O desenho: uma seção só, com o cabeçalho, os botões e os avisos do estado. ----

  // O que foi anunciado por último: a seção, o aviso e a conexão caída.
  let anunciado = { secao: null, aviso: null, caiu: false };

  function desenhar(e) {
    const secao = SECAO[e.tela] ?? null;
    for (const [nomeDaSecao, s] of secoes) s.hidden = nomeDaSecao !== secao;
    carregando.hidden = e.tela !== 'carregando';
    raiz.classList.toggle('na-reuniao', secao === 'reuniao');

    if (e.reuniao) desenharCabecalho(e.reuniao);
    for (const n of todos('[data-campo="nome"]')) texto(n, e.nome.trim());
    desenharEntrada(e);
    desenharMidia(e);
    desenharAvisos(e);
    desenharReuniao(e);
    anunciar(secao, e);
  }

  function desenharCabecalho(reuniao) {
    const agora = relogio.agora();
    const { sobretitulo, titulo } = cabecalho(reuniao, agora);
    // A linha da espera: o título e, na marcada, o quando.
    const linha = reuniao.tipo === 'marcada' ? `${titulo} · ${quando(reuniao.inicio, agora)}` : titulo;
    for (const s of todos('[data-campo="sobretitulo"]')) texto(s, sobretitulo);
    for (const t of todos('[data-campo="titulo"]')) texto(t, titulo);
    for (const l of todos('[data-campo="linha"]')) texto(l, linha);
  }

  function desenharEntrada(e) {
    if (nome.value !== e.nome) nome.value = e.nome;
    const valido = nomeValido(e.nome);
    pedir.disabled = !(e.tela === 'entrada' && valido);
    um('[data-dica="semNome"]').hidden = valido;
    um('#nome-recusado').hidden = !e.nomeRecusado;
    if (e.nomeRecusado) nome.setAttribute('aria-invalid', 'true');
    else nome.removeAttribute('aria-invalid');
    nome.setAttribute('aria-describedby', e.nomeRecusado ? 'nome-ajuda nome-recusado' : 'nome-ajuda');

    const semMic = e.mic === 'indisponivel';
    const semCam = e.cam === 'indisponivel';
    um('.aviso-acesso').hidden = !(semMic || semCam);
    um('[data-dica="escolha"]').hidden = semMic && semCam;
    um('[data-dica="semPermissao"]').hidden = !(semMic && semCam);
    um('[data-dica="semCamera"]').hidden = !semCam;
  }

  // O Microfone e a Câmera de todas as telas, e as prévias da câmera. A mídia segue a escolha da pessoa; na reunião, a
  // câmera é da ligação.
  function desenharMidia(e) {
    for (const b of todos('[data-botao="microfone"]')) alternar(b, e.mic);
    for (const b of todos('[data-botao="camera"]')) alternar(b, e.cam);
    const imagem = { ligado: 'ligada', desligado: 'desligada' }[e.cam] ?? 'indisponivel';
    for (const i of todos('[data-imagem]')) i.dataset.imagem = imagem;
    midia.escolher(e.mic, e.cam, e.tela === 'reuniao');
  }

  function desenharAvisos(e) {
    for (const a of todos('[data-aviso]')) a.hidden = a.dataset.aviso !== e.aviso;
    // O tentativas conta os segundos, e só depois o Tentar de novo liga.
    const contando = e.esperarSegundos > 0;
    contagem.disabled = contando;
    contagem.querySelector('[data-contagem="contando"]').hidden = !contando;
    contagem.querySelector('[data-contagem="pronto"]').hidden = contando;
    texto(contagem.querySelector('[data-campo="segundos"]'), String(e.esperarSegundos));
  }

  function desenharReuniao(e) {
    const compartilhando = e.telaCompartilhada !== 'nenhuma';
    um('.selo-tela').hidden = e.telaCompartilhada !== 'noAr';
    um('.selo-gravado').hidden = e.telaCompartilhada === 'noAr';
    um('.caiu').hidden = !(e.tela === 'reuniao' && e.reconectando > 0);
    // O Compartilhar a tela só vale com o canal aberto e a ligação no ar: o canal abrindo e o voltando contam como
    // fechados, e a conexão caída também.
    compartilhar.hidden = !temCaptura || compartilhando;
    compartilhar.disabled = !(e.canal === 'aberto' && e.reconectando === 0);
    um('[data-botao="pararDeCompartilhar"]').hidden = !compartilhando;
  }

  // A mudança de tela (e do aviso) vai para a região que os leitores de tela anunciam, como a conexão caída.
  function anunciar(secao, e) {
    const caiu = e.tela === 'reuniao' && e.reconectando > 0;
    if (caiu && !anunciado.caiu) {
      texto(anuncio, um('.caiu h2').textContent);
    } else if (secao !== anunciado.secao || e.aviso !== anunciado.aviso) {
      texto(anuncio, tituloVisivel()?.textContent ?? '');
    }
    anunciado = { secao, aviso: e.aviso, caiu };
  }

  // O título da tela que aparece (no aviso, o do aviso de agora).
  function tituloVisivel() {
    const secao = [...secoes.values()].find((s) => !s.hidden);
    if (!secao) return null;
    return [...secao.querySelectorAll('h1')].find((h) => !h.closest('[hidden]')) ?? null;
  }

  // ---- Os cliques e o nome viram eventos. ----

  raiz.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-botao]');
    if (!b) return;
    if (b.dataset.botao === 'pedir') tocarOSom();
    despachar({ tipo: 'clique', botao: b.dataset.botao });
  });
  nome.addEventListener('input', () => despachar({ tipo: 'nome', valor: nome.value }));
  // O Enter no nome é o Pedir para entrar; o que confirma uma composição (o IME) não conta.
  nome.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === 'Enter' && !pedir.disabled) pedir.click();
  });

  // O primeiro play() do som nasce no clique do Pedir para entrar, antes de tudo: o Safari do iPhone só toca depois de
  // um gesto, e o som da reunião chega sem outro toque. Sem o som ainda, ele pode recusar, e a recusa não importa.
  function tocarOSom() {
    som.play()?.catch(() => {});
  }

  desenhar(estado);
  despachar({ tipo: 'comecar' });
}

// O texto do elemento, mudado só quando é outro.
function texto(el, valor) {
  if (el.textContent !== valor) el.textContent = valor;
}

// O Microfone ou a Câmera: apertado ligado, solto desligado, e desligado sem o aparelho.
function alternar(b, valor) {
  b.setAttribute('aria-pressed', valor === 'ligado' ? 'true' : 'false');
  b.disabled = valor === 'indisponivel';
}
