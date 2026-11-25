// A camada da tela da página da reunião. Ela desenha o estado do cérebro (estado.js), com os quadros da reunião
// (quadros.js), o painel do chat (painel.js) e o sinalizador de qualidade (qualidade.js), transforma os cliques, o
// nome, as mensagens e as medidas da ligação em eventos, e roda os efeitos com os adaptadores: a rede (rede.js), a
// mídia (midia.js), as ligações (ligacao.js) e o relógio. Os eventos que um efeito dá entram numa fila e passam pelo
// cérebro um de cada vez, depois dos efeitos do evento de agora. Nada do estado nem dos efeitos vai ao console: eles
// levam o bilhete, as senhas, as credenciais do TURN, a chave de volta e as mensagens do chat. As medidas do
// sinalizador também não vão a lugar nenhum fora da página. Na página do colega, ela desenha também a entrada dele, o
// botão Participantes, o cartão do pedido e o painel Participantes (participantes.js); os nomes entram sempre como
// texto. No Windows, ela desenha a tela "o app ou o navegador" (a escolha), com o link do app para o código do endereço.
// Dentro do iframe do app (o app.js), ela leva as mensagens dele ao cérebro, manda o que o cérebro avisa e o estado
// (o paraOApp) quando ele muda, dá ao midia.js os nomes dos aparelhos do app, e o link do chat da reunião vai ao app,
// que o abre no navegador padrão, em vez de abrir uma janela. O passe, os nomes e as origens não vão ao console. Na
// pausa, ela cala o som da reunião (o calar) e, na pausa que chega pelo canal, mostra o cartão dela, um diálogo modal.
import {
  TEXTO_DO_LINK_VENCIDO,
  TEXTO_SEM_CUIDAR,
  TITULO_DO_LINK_VENCIDO,
  TITULO_SEM_CUIDAR,
  iniciais,
  rotuloDoBotao,
  tituloDoCartao,
} from './colega.js';
import { cabecalho, inicial, nomeValido, paraOApp, podeEscrever, podeResponder, quando, transicao } from './estado.js';
import { contagem as numeroDoBotao, dito, escreveu, falha, nomeDoBotao, numaLinha } from './mensagens.js';
import { criarPainel } from './painel.js';
import { criarParticipantes } from './participantes.js';
import { criarQuadros } from './quadros.js';
import { AVISO_DA_CONEXAO_RUIM, criarMedidor, numerosDoCartao, textosDoSinal } from './qualidade.js';

/** A espera do ligar da principal pela câmera que a pessoa acabou de ligar e que ainda está sendo pedida, em ms. */
const PRAZO_DA_CAMERA_MS = 3000;

/** Quantos avisos a região que os leitores de tela anunciam guarda: ao entrar mais um, o mais velho sai. */
const MAX_AVISOS = 4;

// Os cliques que levam à reunião: o silêncio do midia.js nasce, ou acorda, dentro deles. O entrar é o do colega.
const DE_ENTRAR = new Set(['pedir', 'entrar', 'entrarDeNovo', 'tentarDeNovo']);

// A seção que cada tela do cérebro mostra. O pedindo já é a espera: o pedido saiu, e o Desistir vale nele. O
// carregando não mostra nenhuma.
const SECAO = {
  escolha: 'escolha',
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
 * adaptadores, que recebem a função que leva os eventos ao cérebro; o relogio é {agora(), depois(ms, fn)}; o passe,
 * opcional, é o que a página recebeu para reconhecer o colega (sem ele, a página é a de quem é de fora); o windows,
 * opcional, diz que o navegador está no Windows (a tela "o app ou o navegador"); e o app, opcional, é a fábrica da
 * conversa com o app ({dentro, mandar}, o app.js), que recebe a função que leva os eventos ao cérebro.
 */
export function iniciar(raiz, servicos) {
  const um = (seletor) => raiz.querySelector(seletor);
  const todos = (seletor) => [...raiz.querySelectorAll(seletor)];

  const secoes = new Map(todos('[data-tela]').map((s) => [s.dataset.tela, s]));
  const carregando = um('.carregando');
  const nome = um('#nome');
  const pedir = um('[data-botao="pedir"]');
  const entrar = um('[data-botao="entrar"]');
  const campoDoNome = nome.closest('.campo');
  const colegaNaEntrada = um('.colega');
  const som = um('#som');
  const anuncio = um('[data-campo="anuncio"]');
  const contagem = um('[data-aviso="tentativas"] [data-botao="tentarDeNovo"]');
  const compartilhar = um('.controle-compartilhar');
  const botaoChat = um('[data-botao="chat"]');
  const numeroDoChat = botaoChat.querySelector('.contagem');
  const raizDoPainel = um('.painel');
  const avisoCurto = um('.aviso-curto');
  const botaoParticipantes = um('[data-botao="participantes"]');
  const numeroDeParticipantes = botaoParticipantes.querySelector('.contagem');
  const cartaoDoPedido = um('.pedido');
  const avisoSemCuidar = um('.sem-cuidar');
  const raizDaGente = um('.gente');
  // A frase do aviso curto do servidor de vídeo que não respondeu é o título do aviso semServidor.
  const servidorNaoRespondeu = um('[data-aviso="semServidor"] h1').textContent;
  const sinal = um('.sinal');
  const botaoDoSinal = um('.sinal-botao');
  const cartaoDoSinal = um('.sinal-cartao');
  const cartaoDaPausa = um('#pausa');
  const voltarDaPausa = cartaoDaPausa.querySelector('[data-botao="voltarDaPausa"]');
  // O Compartilhar a tela só existe onde o navegador tem a captura da tela.
  const temCaptura = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  // O Abrir no app da escolha é um link para o app, com o código do endereço (/r/<código>) escrito como o servidor o
  // escreve: em minúsculas e sem os espaços. O servidor abre a reunião também com o código em maiúsculas, e o app só
  // aceita o código exato.
  let codigo = location.pathname.split('/')[2] ?? '';
  try {
    codigo = decodeURIComponent(codigo);
  } catch {
    // o código malformado fica como veio, e o app não o aceita
  }
  codigo = codigo.toLowerCase().replace(/[ \t\n\r]/g, '');
  um('[data-link="app"]').setAttribute('href', `starsonic://reuniao/${encodeURIComponent(codigo)}`);

  let estado = inicial();
  const fila = [];
  let rodando = false;
  let indoEmbora = false; // o pagehide: a página vai embora, e nada mais chega ao cérebro

  // Todo evento chega ao cérebro com a hora em que nasceu (o agora): é a hora das mensagens do chat.
  function despachar(evento) {
    if (indoEmbora) return;
    fila.push({ ...evento, agora: relogio.agora() });
    if (rodando) return; // um evento dado por um efeito entra depois dos efeitos de agora
    rodando = true;
    try {
      while (fila.length > 0) {
        const foco = document.activeElement;
        const { estado: novo, efeitos } = transicao(estado, fila.shift());
        estado = novo;
        // O desenho que lança não leva os efeitos do evento (a senha de um voltou, por exemplo).
        try {
          desenhar(estado);
        } catch {
          console.error('desenhar'); // só a palavra: o estado e o palco levam segredos e nomes
        }
        avisarOEstado();
        for (const efeito of efeitos) rodar(efeito);
        manterOFoco(foco);
      }
    } finally {
      rodando = false;
    }
  }

  // O botão com o foco que o desenho escondeu, desligou ou pôs dentro de um inert (o Tentar de novo do aviso de acesso
  // que deu certo, ou um quadro embaixo do cartão da conexão caída, por exemplo) leva o foco ao título da tela: sem
  // isso, ele cairia no começo da página. O que estava no painel do chat (o campo que o canal caído desligou), com o
  // painel ainda aberto, deixa o foco no painel; o do painel Participantes, também.
  function manterOFoco(foco) {
    const agora = document.activeElement;
    if (!foco || foco === document.body || (agora !== foco && agora !== document.body)) return;
    if (!(foco.closest('[hidden]') || foco.disabled || foco.closest('[inert]'))) return;
    if (raizDoPainel.contains(foco) && !raizDoPainel.hidden) painel.focar();
    else if (raizDaGente.contains(foco) && !raizDaGente.hidden) gente.focar();
    else tituloVisivel()?.focus();
  }

  const rede = servicos.rede(despachar);
  const midia = servicos.midia(despachar);
  const ligacao = servicos.ligacao(despachar);
  const app = servicos.app ? servicos.app(despachar) : { dentro: false, mandar() {} };
  const { relogio } = servicos;

  // O estado vai ao app quando muda, e nunca antes de a página carregar.
  let estadoAvisado = null;
  function avisarOEstado() {
    if (!app.dentro) return;
    const agora = paraOApp(estado);
    if (agora === null || (agora.fase === estadoAvisado?.fase && agora.microfone === estadoAvisado?.microfone)) return;
    estadoAvisado = agora;
    app.mandar('estado', agora);
  }
  const quadros = criarQuadros({ raiz: um('.palco'), relogio });
  const painel = criarPainel({
    raiz: raizDoPainel,
    fundo: todos('.reuniao-topo, .palco, .controles'),
    toque: () => window.matchMedia('(pointer: coarse)').matches,
    aoEscrever: (texto) => despachar({ tipo: 'escrever', texto }),
    aoReenviar: (n) => despachar({ tipo: 'reenviar', n }),
    aoFechar: () => despachar({ tipo: 'clique', botao: 'fecharChat' }),
  });
  // O painel Participantes, no lugar do chat, com o mesmo fundo. Os botões dele chegam ao cérebro pelo ouvinte dos
  // cliques; o aoClique leva o Esc e o Voltar do aparelho.
  const gente = criarParticipantes({
    raiz: raizDaGente,
    fundo: todos('.reuniao-topo, .palco, .controles'),
    relogio,
    aoClique: (botao) => despachar({ tipo: 'clique', botao }),
  });
  // O sinalizador de qualidade mede a ligação principal (os números dela, do navegador), só com a aba à vista, e cada
  // medida vai ao cérebro. O desenho o liga e desliga.
  const medidor = criarMedidor({
    ler: () => ligacao.numeros(),
    relogio,
    visivel: () => document.visibilityState === 'visible',
    aoMedir: (medida) => despachar({ tipo: 'qualidade', ...medida }),
  });

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
        rede.abrir(efeito.abertura, efeito.corpo);
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
        ligar(efeito);
        break;
      case 'desligar':
        cancelarOLigar(efeito.qual);
        ligacao.desligar(efeito.qual);
        break;
      case 'trocarCamera':
        // Com o nome, a troca do aparelho: o midia.js já tem o nome novo, do desenho.
        ligacao.trocarCamera(efeito.ligada, efeito.nome !== undefined);
        break;
      case 'trocarMicrofone':
        ligacao.trocarMicrofone(efeito.ligado, efeito.nome !== undefined);
        break;
      case 'pararCaptura':
        midia.pararCaptura();
        break;
      case 'focar':
        // Sem alvo, o título da tela; com ele, o que o colega usa: o botão Participantes, ou o que está no painel.
        if (efeito.alvo === undefined) tituloVisivel()?.focus();
        else if (efeito.alvo === 'participantes') botaoParticipantes.focus();
        else gente.focar(efeito.alvo, efeito.id);
        break;
      case 'focarOCampo':
        painel.focar();
        break;
      case 'focarOChat':
        botaoChat.focus();
        break;
      case 'focarOSinal':
        botaoDoSinal.focus();
        break;
      case 'dizer':
        dizer(efeito.texto);
        break;
      case 'calar':
        som.muted = efeito.calado;
        break;
      case 'avisarApp': {
        const { tipo, ...campos } = efeito.m;
        app.mandar(tipo, campos);
        break;
      }
    }
  }

  // O ligar não leva o mic nem a cam: a escolha da pessoa está no fluxo. A câmera ligada é uma faixa de câmera viva
  // nele (nenhuma é o vídeo sem faixa), e o microfone desligado é a faixa dele com o enabled falso. A câmera que a
  // pessoa acabou de ligar (ou que a conexão caída devolveu) pode ainda estar sendo pedida: a principal a espera, até
  // PRAZO_DA_CAMERA_MS, para a oferta concordar com o botão, e o desligar dela, nesse meio-tempo, cancela o ligar
  // (nada dele chega ao cérebro). A da tela leva a captura da tela, e nunca a câmera nem o microfone.
  const adiados = new Map(); // o qual → o ligar que espera a câmera: {vale}

  function ligar({ qual, senha }) {
    cancelarOLigar(qual);
    const { acesso } = estado; // o do efeito; o fluxo é o da hora de ligar
    if (qual === 'tela') {
      ligacao.ligar({ qual, senha, acesso, fluxo: midia.captura() });
      return;
    }
    const comOFluxo = () => ligacao.ligar({ qual, senha, acesso, fluxo: midia.fluxo() });
    if (!midia.cameraPedida()) {
      comOFluxo();
      return;
    }
    const adiado = { vale: true };
    adiados.set(qual, adiado);
    const prazo = new Promise((r) => relogio.depois(PRAZO_DA_CAMERA_MS, r));
    Promise.race([cameraRespondida(), prazo]).then(() => {
      if (!adiado.vale) return;
      adiados.delete(qual);
      try {
        comOFluxo();
      } catch {
        console.error('A página não conseguiu rodar o efeito ligar.'); // só o tipo, como no rodar
      }
    });
  }

  // Até nenhum pedido da câmera correr: o que responde pede outro quando a escolha mudou enquanto ele esperava.
  async function cameraRespondida() {
    for (let pedido = midia.cameraPedida(); pedido; pedido = midia.cameraPedida()) await pedido;
  }

  function cancelarOLigar(qual) {
    const adiado = adiados.get(qual);
    if (!adiado) return;
    adiado.vale = false;
    adiados.delete(qual);
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
    // A faixa do passe que não valeu, no alto da escolha e da entrada de quem é de fora.
    for (const f of todos('[data-faixa="semColega"]')) f.hidden = !e.semColega;
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
    // A escolha diz o tipo e, embaixo do título, o dia e a hora da marcada. (A reunião de teste não chega a ela.)
    const marcada = reuniao.tipo === 'marcada';
    for (const t of todos('[data-campo="tipo"]')) texto(t, marcada ? 'Reunião marcada' : sobretitulo);
    for (const d of todos('[data-campo="dia"]')) {
      texto(d, marcada ? quando(reuniao.inicio, agora) : '');
      d.closest('.escolha-dia').hidden = !marcada;
    }
  }

  function desenharEntrada(e) {
    if (nome.value !== e.nome) nome.value = e.nome;
    const valido = nomeValido(e.nome);
    pedir.disabled = !(e.tela === 'entrada' && valido);
    // O colega não digita o nome: ele vê quem é, e entra pelo Entrar.
    const { colega } = e;
    campoDoNome.hidden = colega !== null;
    pedir.hidden = colega !== null;
    colegaNaEntrada.hidden = colega === null;
    entrar.hidden = colega === null;
    entrar.disabled = !(e.tela === 'entrada' && colega !== null);
    if (colega !== null) {
      texto(colegaNaEntrada.querySelector('.colega-nome'), colega.nome);
      texto(colegaNaEntrada.querySelector('.colega-iniciais'), iniciais(colega.nome));
    }
    um('[data-dica="semNome"]').hidden = valido || colega !== null;
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

  // O Microfone e a Câmera de todas as telas, e as prévias da câmera. A mídia segue a escolha da pessoa; com a ligação
  // no ar (na reunião, sem a conexão caída), a câmera é da ligação. Na conexão caída, a Câmera só muda o estado, e o
  // midia.js põe a escolha no fluxo, que o ligar da volta lê.
  function desenharMidia(e) {
    for (const b of todos('[data-botao="microfone"]')) alternar(b, e.mic);
    for (const b of todos('[data-botao="camera"]')) alternar(b, e.cam);
    const imagem = { ligado: 'ligada', desligado: 'desligada' }[e.cam] ?? 'indisponivel';
    for (const i of todos('[data-imagem]')) i.dataset.imagem = imagem;
    const reuniao = e.tela !== 'reuniao' ? 'fora' : e.reconectando > 0 ? 'caiu' : 'noAr';
    midia.escolher(e.mic, e.cam, reuniao);
    midia.aparelhos(e.aparelhos);
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
    // Embaixo do cartão da conexão caída, os quadros e os botões de voltar ficam fora do teclado; os controles, não.
    const caiu = e.tela === 'reuniao' && e.reconectando > 0;
    um('.caiu').hidden = !caiu;
    for (const el of todos('.palco > .quadros, .palco > .voltar')) el.inert = caiu;
    quadros.desenhar({
      naReuniao: e.tela === 'reuniao',
      noAr: e.principal === 'noAr',
      palco: e.palco,
      cam: e.cam,
      fluxo: midia.fluxo(),
    });
    // O Compartilhar a tela só vale com o canal aberto e a ligação no ar: o canal abrindo e o voltando contam como
    // fechados, e a conexão caída também.
    compartilhar.hidden = !temCaptura || compartilhando;
    compartilhar.disabled = !(e.canal === 'aberto' && e.reconectando === 0) || e.pausa !== null;
    um('[data-botao="pararDeCompartilhar"]').hidden = !compartilhando;
    desenharOChat(e);
    desenharOColega(e);
    desenharOSinal(e);
    desenharOAvisoCurto(e);
    desenharAPausa(e);
  }

  // O cartão da pausa que chegou pelo canal: um diálogo modal, com o foco no Voltar para a reunião. O resto da página
  // sai do teclado e dos leitores de tela enquanto ele está aberto; o que o leitor de tela ouve é o cérebro que diz.
  function desenharAPausa(e) {
    const aberto = e.tela === 'reuniao' && e.pausa?.origem === 'canal';
    if (aberto && !cartaoDaPausa.open) {
      cartaoDaPausa.showModal();
      voltarDaPausa.focus();
    } else if (!aberto && cartaoDaPausa.open) {
      const tinhaOFoco = cartaoDaPausa.contains(document.activeElement);
      cartaoDaPausa.close();
      // O foco volta ao que o tinha antes do cartão; sem ele, ao título da tela.
      if (tinhaOFoco && document.activeElement === document.body) tituloVisivel()?.focus();
    }
  }

  // O que é só do colega na reunião: o botão Participantes (apertado com o painel aberto, e o número de quem espera), o
  // painel e o cartão do pedido. O cartão sai com o painel aberto, que mostra os pedidos, e embaixo do cartão da
  // conexão caída. Quem deixou de cuidar da reunião tem, no lugar dele e com a mesma regra, o aviso; sem o canal, com a
  // página tentando voltar, o Aceitar e o Recusar ficam desligados (o Ver os pedidos, não: ele só abre o painel).
  function desenharOColega(e) {
    gente.desenhar(e);
    const doColega = e.colega !== null && e.tela === 'reuniao';
    const pedidos = doColega ? e.lista.pedidos : [];
    const n = pedidos.length;
    botaoParticipantes.hidden = !doColega;
    botaoParticipantes.setAttribute('aria-pressed', doColega && e.gente ? 'true' : 'false');
    // O número é só o desenho; o nome do botão diz quantas pessoas querem entrar.
    texto(numeroDeParticipantes, numeroDoBotao(n));
    numeroDeParticipantes.hidden = n === 0;
    if (n > 0) botaoParticipantes.setAttribute('aria-label', rotuloDoBotao(pedidos));
    else botaoParticipantes.removeAttribute('aria-label');

    const atras = e.gente || e.reconectando > 0;
    avisoSemCuidar.hidden = !(doColega && e.semCuidar) || atras;
    // O motivo do aviso é o link que deixou de valer, ou o de sempre; o nome da região segue o título.
    const titulo = e.linkVenceu ? TITULO_DO_LINK_VENCIDO : TITULO_SEM_CUIDAR;
    texto(avisoSemCuidar.querySelector('.sem-cuidar-titulo'), titulo);
    texto(avisoSemCuidar.querySelector('.sem-cuidar-texto'), e.linkVenceu ? TEXTO_DO_LINK_VENCIDO : TEXTO_SEM_CUIDAR);
    cartaoDoPedido.hidden = n === 0 || atras;
    // As respostas desligadas, na tela da reunião, com a conexão de pé e algo para responder à vista (o painel aberto
    // ou um pedido esperando): o leitor de tela ouve por quê, uma vez a cada vez que isso começa. Com a conexão
    // caída, quem fala é o aviso da queda; quem deixou de cuidar ouve o aviso dele; fora da reunião, recomeça.
    const mudas = doColega && !podeResponder(e) && !e.semCuidar && e.reconectando === 0 && (e.gente || n > 0);
    if (mudas && !respostasDitas) dizer(textoDasRespostas);
    respostasDitas = mudas;
    if (cartaoDoPedido.hidden) return;
    // Com um pedido, o Recusar e o Aceitar dele; com mais, o Ver os pedidos.
    const so = n === 1;
    texto(cartaoDoPedido.querySelector('.pedido-titulo'), tituloDoCartao(pedidos));
    cartaoDoPedido.querySelector('.pedido-texto').hidden = !so;
    cartaoDoPedido.querySelector('.pedido-cheia').hidden = !e.cheiaAoAceitar;
    for (const b of cartaoDoPedido.querySelectorAll('[data-botao="recusar"], [data-botao="aceitar"]')) {
      b.hidden = !so;
      b.disabled = !podeResponder(e);
      b.dataset.id = pedidos[0].id;
    }
    cartaoDoPedido.querySelector('[data-botao="verPedidos"]').hidden = so;
  }

  // O n da última mensagem do chat que a página já viu na tela da reunião: as de outras pessoas depois dela são ditas.
  let ultimaVista = 0;
  // As mensagens da própria pessoa que não foram (o n de cada uma) e que o leitor de tela já ouviu; e se ele já ouviu
  // que o chat aberto está sem o canal.
  let falhasDitas = new Set();
  let semCanalDito = false;
  const textoSemCanal = um('.painel-sem-canal').textContent;
  // Se o leitor de tela já ouviu que as respostas do colega estão desligadas, e o texto disso (o do painel).
  let respostasDitas = false;
  const textoDasRespostas = um('.gente-sem-canal').textContent;

  // O chat: o botão apertado com o painel aberto, o número das mensagens novas, o painel com as mensagens do cérebro,
  // e o que o leitor de tela ouve.
  function desenharOChat(e) {
    const naReuniao = e.tela === 'reuniao';
    const chatAberto = naReuniao && e.chat.aberto;
    const novas = naReuniao ? e.chat.naoLidas : 0;
    botaoChat.setAttribute('aria-pressed', chatAberto ? 'true' : 'false');
    // O número é só o desenho (até 9, e 9+); o nome do botão diz o número de verdade.
    texto(numeroDoChat, numeroDoBotao(novas));
    numeroDoChat.hidden = novas === 0;
    if (novas > 0) botaoChat.setAttribute('aria-label', nomeDoBotao(novas));
    else botaoChat.removeAttribute('aria-label');
    painel.desenhar({
      aberto: chatAberto,
      mensagens: e.chat.mensagens,
      podeEscrever: podeEscrever(e),
      naReuniao,
    });

    // O leitor de tela ouve a mensagem mais nova de outra pessoa que ainda não foi dita, com o chat aberto ou fechado.
    if (!naReuniao) {
      falhasDitas = new Set();
      semCanalDito = false;
      return;
    }
    const { mensagens } = e.chat;
    for (let i = mensagens.length - 1; i >= 0 && mensagens[i].n > ultimaVista; i--) {
      if (mensagens[i].voce) continue;
      dizer(dito(mensagens[i]));
      break;
    }
    if (mensagens.length > 0) ultimaVista = Math.max(ultimaVista, mensagens[mensagens.length - 1].n);
    // A mensagem da própria pessoa que não foi: ele ouve o que a tela mostra embaixo dela, uma vez, também com o chat
    // fechado. Sem isso, quem não vê a tela acha que a mensagem saiu.
    const falhas = mensagens.filter((m) => m.voce && m.situacao === 'naoEnviada');
    const nova = falhas.findLast((m) => !falhasDitas.has(m.n));
    falhasDitas = new Set(falhas.map((m) => m.n));
    if (nova) dizer(falha(nova.motivo));
    // O chat aberto sem o canal: o campo está desligado, e ele ouve por quê, uma vez a cada vez que isso começa. Com a
    // conexão caída, quem fala é o aviso da queda.
    const parado = chatAberto && !podeEscrever(e) && e.reconectando === 0;
    if (parado && !semCanalDito) dizer(textoSemCanal);
    semCanalDito = parado;
  }

  // O sinalizador de qualidade: o medidor ligado com a ligação principal no ar, o botão no estado mostrado (o desenho,
  // o texto e o nome para o leitor de tela) e o cartão dele, com a explicação, as dicas do estado e os números da
  // última medida.
  function desenharOSinal(e) {
    medidor.medir(e.tela === 'reuniao' && e.principal === 'noAr');
    const { estado } = e.qualidade;
    const textos = textosDoSinal(estado);
    const aberto = e.tela === 'reuniao' && e.cartao;
    botaoDoSinal.dataset.estado = estado;
    botaoDoSinal.setAttribute('aria-label', textos.nome);
    botaoDoSinal.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    texto(botaoDoSinal.querySelector('.sinal-texto'), textos.botao);
    cartaoDoSinal.hidden = !aberto;
    cartaoDoSinal.dataset.estado = estado;
    texto(cartaoDoSinal.querySelector('.sinal-titulo'), textos.titulo);
    texto(cartaoDoSinal.querySelector('.sinal-explicacao'), textos.explicacao);
    // As três dicas estão na página, na ordem: cada estado mostra as primeiras.
    const dicas = cartaoDoSinal.querySelector('.sinal-dicas');
    dicas.hidden = textos.dicas === 0;
    for (const [i, dica] of [...dicas.children].entries()) dica.hidden = i >= textos.dicas;
    const numeros = numerosDoCartao(e.qualidade);
    const pe = cartaoDoSinal.querySelector('.sinal-numeros');
    pe.hidden = numeros === null;
    texto(pe, numeros ?? '');
  }

  // O n do último aviso de conexão ruim que o leitor de tela ouviu.
  let conexaoDita = 0;

  // O aviso curto, um por vez: o da mensagem nova (quem escreveu, o texto numa linha e o Abrir o chat), o da conexão
  // que virou ruim (uma linha só e o Ver os detalhes) ou, na página do colega, o do servidor de vídeo que não respondeu
  // a uma resposta dela (uma linha só, sem botão). O da conexão é dito ao leitor de tela, uma vez; as mensagens, quem
  // diz é o desenho do chat; o do servidor, o cérebro.
  function desenharOAvisoCurto(e) {
    const aviso = e.tela === 'reuniao' ? e.avisoCurto : null;
    avisoCurto.hidden = aviso === null;
    if (aviso === null) return;
    const daMensagem = aviso.tipo === 'mensagem';
    const daConexao = aviso.tipo === 'conexao';
    avisoCurto.dataset.tipo = aviso.tipo;
    const quem = avisoCurto.querySelector('.aviso-curto-quem');
    quem.hidden = !daMensagem;
    texto(quem, daMensagem ? escreveu(aviso) : '');
    const linha = daMensagem ? numaLinha(aviso.texto) : daConexao ? AVISO_DA_CONEXAO_RUIM : servidorNaoRespondeu;
    texto(avisoCurto.querySelector('.aviso-curto-linha'), linha);
    avisoCurto.querySelector('[data-botao="abrirChat"]').hidden = !daMensagem;
    avisoCurto.querySelector('[data-botao="verDetalhes"]').hidden = !daConexao;
    if (daConexao && aviso.n !== conexaoDita) {
      conexaoDita = aviso.n;
      dizer(AVISO_DA_CONEXAO_RUIM);
    }
  }

  // Tudo o que a página diz ao leitor de tela entra na região que ele anuncia, como um trecho próprio (um span, com o
  // texto como texto) no fim dela. Os trechos de antes ficam, para um aviso não atropelar o outro, e o mesmo texto dito
  // de novo é um trecho novo, anunciado de novo. A região guarda os MAX_AVISOS mais novos: ao entrar mais um, o mais
  // velho sai. Um texto vazio não é dito.
  function dizer(oQue) {
    if (oQue === '') return;
    const trecho = document.createElement('span');
    trecho.textContent = oQue;
    anuncio.append(trecho);
    while (anuncio.childElementCount > MAX_AVISOS) anuncio.firstElementChild.remove();
  }

  // A mudança de tela (e do aviso) também é dita, como a conexão caída.
  function anunciar(secao, e) {
    const caiu = e.tela === 'reuniao' && e.reconectando > 0;
    if (caiu && !anunciado.caiu) {
      dizer(um('.caiu h2').textContent);
    } else if (secao !== anunciado.secao || e.aviso !== anunciado.aviso) {
      dizer(tituloVisivel()?.textContent ?? '');
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

  // O botão com o data-id (o Aceitar e o Recusar do cartão do pedido e do painel Participantes, e o Tirar de cada linha
  // dele) leva o id ao cérebro.
  raiz.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-botao]');
    if (!b) return;
    const { botao, id } = b.dataset;
    if (botao === 'pedir' || botao === 'entrar') tocarOSom();
    if (DE_ENTRAR.has(botao)) midia.despertar();
    despachar(id === undefined ? { tipo: 'clique', botao } : { tipo: 'clique', botao, id });
  });
  // O Compartilhar a tela não é um clique do cérebro: a captura nasce nele (o desenho, item 4: o Safari e o Firefox só
  // a deixam dentro do gesto), e o cérebro recebe a resposta, o telaCapturada. O silêncio da ligação da tela acorda
  // junto, antes: os dois saem dentro do clique, antes de qualquer coisa assíncrona.
  compartilhar.addEventListener('click', () => {
    midia.despertar();
    midia.capturarTela();
  });
  // O cartão do sinalizador fecha com o Esc, antes de tudo o que o Esc faz na reunião (o chat que fecha, o quadro
  // aumentado que volta): o ouvinte roda na captura e marca o evento como tratado, e os outros o deixam passar. O
  // clique fora do sinalizador também fecha o cartão, sem tirar do clique o que ele faz: quem decide é o estado de
  // antes dele, e por isso o ouvinte também roda na captura.
  document.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
      if (!estado.cartao) return;
      ev.preventDefault();
      despachar({ tipo: 'clique', botao: 'fecharCartao' });
    },
    true,
  );
  document.addEventListener(
    'click',
    (ev) => {
      if (estado.cartao && !sinal.contains(ev.target)) despachar({ tipo: 'clique', botao: 'fecharCartao' });
    },
    true,
  );
  // Dentro do app, o link do chat da reunião não abre nada aqui (nem navega, nem abre outra janela): ele vai ao app,
  // que o abre no navegador padrão. O clique do meio também.
  if (app.dentro) {
    const levarOLink = (ev) => {
      const a = ev.target.closest?.('a[href]');
      if (!a || !raizDoPainel.contains(a) || (ev.type === 'auxclick' && ev.button !== 1)) return;
      ev.preventDefault();
      app.mandar('link', { url: a.href });
    };
    raizDoPainel.addEventListener('click', levarOLink);
    raizDoPainel.addEventListener('auxclick', levarOLink);
  }
  // O cartão da pausa só fecha pelo Voltar para a reunião: o Esc não faz nada, e o Tab e o Shift+Tab ficam no botão.
  // O que o navegador fechar sozinho abre de novo, enquanto a pausa valer.
  cartaoDaPausa.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key !== 'Escape' && ev.key !== 'Tab') return;
    ev.preventDefault();
    voltarDaPausa.focus();
  });
  cartaoDaPausa.addEventListener('cancel', (ev) => ev.preventDefault());
  cartaoDaPausa.addEventListener('close', () => desenharAPausa(estado));
  nome.addEventListener('input', () => despachar({ tipo: 'nome', valor: nome.value }));
  // O Enter no nome é o Pedir para entrar; o que confirma uma composição (o IME) não conta.
  nome.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === 'Enter' && !pedir.disabled) pedir.click();
  });

  // O primeiro play() do som nasce no clique do Pedir para entrar (ou do Entrar do colega), antes de tudo: o Safari do
  // iPhone só toca depois de um gesto, e o som da reunião chega sem outro toque. Sem o som ainda, ele pode recusar, e
  // a recusa não importa.
  function tocarOSom() {
    som.play()?.catch(() => {});
  }

  // A aba que fecha sem o Sair (ou a página que sai): as duas ligações descem, e o BYE de cada uma sai pelo WSS dela,
  // ainda aberto; o canal fecha. Sem isso, os colegas veriam a pessoa até o servidor de vídeo dar pela falta da mídia.
  // Os efeitos rodam sem o cérebro, e o que os adaptadores derem depois fica de fora: a página está indo embora. A que
  // volta do cache do navegador (o voltar dele) carrega de novo, do começo.
  window.addEventListener('pagehide', () => {
    indoEmbora = true;
    quadros.parar();
    rodar({ tipo: 'desligar', qual: 'principal' });
    rodar({ tipo: 'desligar', qual: 'tela' });
    rodar({ tipo: 'fecharCanal' });
  });
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) location.reload();
  });

  desenhar(estado);
  despachar({ tipo: 'comecar', passe: servicos.passe ?? null, windows: servicos.windows === true, noApp: app.dentro });
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
