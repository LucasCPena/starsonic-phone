// As ligações da página com o servidor de vídeo (docs/video-agente.md, seção 6), como as do cliente mínimo do e2e
// (video-servidor/e2e/cliente/cliente.js): cada ligação é um UA do JsSIP só para ela, sem registro, com o From e o nome
// neutros (pagina, porque o FreeSWITCH escreve o nome do canal nos avisos dele), o cabeçalho X-Starsonic-Senha e o
// TURN do aceito. A principal manda a câmera e o som e recebe a reunião: o mosaico vai para o #mosaico, e o som para o
// #som. A da tela só manda.
//
// A interface:
// - criarLigacoes(aoEvento) devolve {ligar, desligar, trocarCamera, trocarMicrofone};
// - ligar({qual, senha, acesso, fluxo}): o qual é 'principal' ou 'tela'; o acesso, o turn e o video do aceito; o fluxo,
//   o MediaStream da câmera e do microfone (o do midia.js). A escolha da pessoa vem nele: uma faixa de câmera viva quer
//   dizer a câmera ligada, e nenhuma, o vídeo sem faixa (o quadro de quem está sem câmera); o microfone desligado é a
//   faixa com o enabled falso, e o aparelho sem acesso não tem faixa. Sem microfone, a ligação manda o silêncio do
//   midia.js;
// - as respostas voltam pelo aoEvento: {tipo:'ligacao', qual, o}, com o o confirmada, terminou, semConexao ou falhou
//   (este com o codigo da resposta SIP, ou 0 sem ela), e {tipo:'cameraTrocada', ok}, a resposta a todo trocarCamera;
// - depois do desligar de uma ligação, nada dela chega ao cérebro.
//
// Os fins: o falhou e o terminou dizem que a ligação acabou, e o UA para junto. O semConexao diz que o WSS caiu com a
// ligação confirmada: ela ainda existe, e desce com o desligar (o terminate da sessão, que manda o BYE, e o stop do
// UA). O WSS que cai antes da ligação confirmada, ou que não abre em PRAZO_CONEXAO_MS, é o falhou.
//
// A câmera desligada é o vídeo nos dois sentidos, sem faixa: a página recebe o mosaico e não manda imagem nenhuma. O
// mod_conference não dá quadro a quem só recebe o vídeo (o recvonly: ele não conta nem como quem tem vídeo nem como
// quem tem o quadro sem câmera), e a pessoa sumiria do mosaico; com o vídeo nos dois sentidos e sem imagem, ele põe,
// depois de 5 s sem imagem, o quadro de #1B2333 com o nome (o video-no-video-avatar), e a imagem que volta o tira.
// Assim, a oferta sem câmera tem o vídeo sem faixa, e trocar a câmera na reunião é só trocar a faixa, sem renegociar:
// desligá-la é o replaceTrack(null) e a faixa parada (a luz apaga); ligá-la, um getUserMedia só de vídeo e o
// replaceTrack. O RTCP e o ICE continuam no caminho do vídeo, e a ligação não cai pelo tempo sem mídia.
//
// Com a ligação no ar, a câmera é dela, e o fluxo continua o mesmo objeto: a câmera desligada para e sai dele na hora,
// e a ligada de novo entra nele antes de ir à ligação, para o ligar de uma volta ver a câmera como ela está. A troca
// que acaba depois de a ligação descer fica de fora (a faixa que chega tarde para): na conexão caída, a câmera volta a
// ser do midia.js, que a acerta com a escolha. O microfone desligado é o mute do JsSIP, que põe o enabled falso e o
// guarda: sem ele, um re-INVITE do servidor (a espera e a volta dela) acenderia a faixa.
//
// A faixa que a principal manda e que acaba sozinha (o aparelho saiu, ou outro programa o tomou): a câmera vai ao
// caminho da câmera desligada, sem o cameraTrocada, e o silêncio toma o lugar do microfone, para o RTP continuar. O
// midia.js tira a faixa dele do fluxo e diz ao cérebro que o aparelho falta; a câmera que a ligação pegou de volta ele
// só vigia quando a conexão caída a devolve, e até lá quem faz isso por ela é a ligação.
//
// A coleta dos candidatos: o JsSIP só manda o INVITE quando ela acaba, e um TURN que não responde pelo UDP (a rede que
// o bloqueia) a segura por 40 s, mais que os 30 s da senha. A oferta sai com o primeiro candidato do TURN, ou
// PRAZO_COLETA_MS depois do primeiro candidato, o que vier antes.
//
// Nada daqui vai ao console: o INVITE leva a senha, e o acesso, as credenciais do TURN. O debug do JsSIP, que
// escreveria as mensagens SIP no console, fica desligado desde antes do primeiro UA.
import { faixaDoSilencio } from './midia.js';

/** O WSS do vídeo que não abre nesse prazo: a ligação falhou, em ms. */
const PRAZO_CONEXAO_MS = 10000;
/** A coleta dos candidatos sem a resposta do TURN, antes do INVITE, em ms. */
const PRAZO_COLETA_MS = 5000;

const viva = (faixa) => faixa?.readyState === 'live';

// O TURN do aceito (seção 4 do contrato do vídeo), como o RTCPeerConnection o pede.
const servidoresIce = (turn) =>
  turn?.urls?.length ? [{ urls: turn.urls, username: turn.usuario, credential: turn.senha }] : [];

// O código da resposta SIP que fez a ligação falhar, ou 0 sem ela (o WSS que caiu, o prazo).
const codigoSip = (mensagem) => (typeof mensagem?.status_code === 'number' ? mensagem.status_code : 0);

// O transceiver de um tipo de mídia ('audio' ou 'video') da ligação.
const transceiver = (l, tipo) => l.sessao?.connection?.getTransceivers().find((t) => t.receiver.track.kind === tipo);

/** As ligações com o JsSIP (o jssip.js põe o window.JsSIP). */
export function criarLigacoes(aoEvento) {
  window.JsSIP?.debug.disable();
  const ligacoes = new Map(); // o qual → a ligação de agora
  const mosaico = document.getElementById('mosaico');
  const som = document.getElementById('som');

  // O evento da ligação: só antes do desligar dela, e um fim só (o falhou, o terminou ou o semConexao).
  function avisar(l, o, codigo) {
    if (!l.viva || l.fim) return;
    if (o === 'confirmada') {
      l.confirmada = true;
      aoEvento({ tipo: 'ligacao', qual: l.qual, o });
      return;
    }
    l.fim = true;
    if (o !== 'semConexao') encerrar(l);
    aoEvento(o === 'falhou' ? { tipo: 'ligacao', qual: l.qual, o, codigo } : { tipo: 'ligacao', qual: l.qual, o });
  }

  // Para tudo da ligação sem avisar: o BYE (ou o CANCEL) da sessão, o UA, os prazos e a cópia do silêncio. As faixas do
  // fluxo ficam: elas são do midia.js, e o ligar de uma volta as usa.
  function encerrar(l) {
    clearTimeout(l.prazoConexao);
    clearTimeout(l.prazoColeta);
    for (const esquecer of l.vigias.splice(0)) esquecer();
    try {
      l.sessao?.terminate();
    } catch {
      // a sessão já tinha acabado
    }
    try {
      l.ua?.stop();
    } catch {
      // o UA já tinha parado
    }
    l.silencio?.stop();
  }

  function ligar({ qual, senha, acesso, fluxo }) {
    desligar(qual); // a anterior, que acabou sozinha, ainda está guardada
    const l = {
      qual,
      fluxo,
      viva: true, // até o desligar
      fim: false, // o fim já foi avisado
      confirmada: false,
      ua: null,
      sessao: null,
      silencio: null, // a cópia do silêncio que a ligação manda
      vigias: [], // o que esquece cada faixa vigiada
      fila: Promise.resolve(), // as trocas da câmera, uma de cada vez
      prazoConexao: 0,
      prazoColeta: 0,
      pronta: null, // o ready da coleta de agora, do JsSIP
    };
    ligacoes.set(qual, l);
    try {
      const { JsSIP } = window;
      const destino = JsSIP.URI.parse(acesso.video.uri);
      if (!destino) throw new TypeError('a uri do vídeo não vale');
      l.ua = new JsSIP.UA({
        sockets: [new JsSIP.WebSocketInterface(acesso.video.wss)],
        uri: `sip:pagina@${destino.host}`,
        display_name: 'pagina',
        register: false,
      });
      l.ua.on('connected', () => {
        if (!l.viva || l.fim || l.sessao) return;
        clearTimeout(l.prazoConexao);
        chamar(l, senha, acesso);
      });
      // O WSS que cai: com a ligação confirmada, ela ainda existe; antes, ela falhou.
      l.ua.on('disconnected', () => avisar(l, l.confirmada ? 'semConexao' : 'falhou', 0));
      l.prazoConexao = setTimeout(() => avisar(l, 'falhou', 0), PRAZO_CONEXAO_MS);
      l.ua.start();
    } catch {
      avisar(l, 'falhou', 0);
    }
  }

  // A chamada, com o WSS aberto. A principal manda e recebe o som e o vídeo; o que não tem faixa vai sem ela.
  function chamar(l, senha, acesso) {
    const principal = l.qual === 'principal';
    const microfone = l.fluxo?.getAudioTracks().find(viva);
    const camera = l.fluxo?.getVideoTracks().find(viva);
    if (!microfone) l.silencio = faixaDoSilencio();
    const mandar = new MediaStream([microfone ?? l.silencio, camera].filter(Boolean));
    const opcoes = {
      mediaStream: mandar,
      extraHeaders: [`X-Starsonic-Senha: ${senha}`],
      pcConfig: { iceServers: servidoresIce(acesso.turn) },
      eventHandlers: {
        peerconnection: ({ peerconnection }) => {
          if (principal) receber(l, peerconnection);
        },
        // Depois das faixas e antes da oferta.
        connecting: () => {
          if (!principal) return;
          const pc = l.sessao.connection;
          for (const tipo of ['audio', 'video']) {
            if (!transceiver(l, tipo)) pc.addTransceiver(tipo, { direction: 'sendrecv' });
          }
        },
        icecandidate: ({ candidate, ready }) => coletar(l, candidate, ready),
        confirmed: () => avisar(l, 'confirmada'),
        ended: () => avisar(l, 'terminou'),
        failed: ({ message }) => avisar(l, 'falhou', codigoSip(message)),
      },
    };
    // A da tela só manda: o som e o vídeo sem a direção de receber.
    if (!principal) opcoes.rtcOfferConstraints = { offerToReceiveAudio: false, offerToReceiveVideo: false };
    try {
      l.sessao = l.ua.call(acesso.video.uri, opcoes);
    } catch {
      avisar(l, 'falhou', 0);
      return;
    }
    if (microfone && !microfone.enabled) l.sessao.mute({ audio: true });
    if (principal) {
      if (microfone) vigiar(l, microfone);
      if (camera) vigiar(l, camera);
    }
  }

  // A reunião que chega. O primeiro play() do #som nasceu no clique do Pedir para entrar; um play() fora de um gesto
  // que o navegador recuse não importa, porque o autoplay do elemento o toca.
  function receber(l, pc) {
    pc.addEventListener('track', ({ track }) => {
      if (!l.viva) return;
      if (track.kind === 'video') {
        mosaico.srcObject = new MediaStream([track]);
      } else if (track.kind === 'audio') {
        som.srcObject = new MediaStream([track]);
        som.play()?.catch(() => {});
      }
    });
  }

  // O candidato do TURN já basta, e a oferta sai; sem ele, ela sai no fim do prazo, contado do primeiro candidato.
  function coletar(l, candidato, pronta) {
    if (candidato.type === 'relay') {
      pronta();
      return;
    }
    if (l.pronta === pronta) return;
    l.pronta = pronta;
    clearTimeout(l.prazoColeta);
    l.prazoColeta = setTimeout(pronta, PRAZO_COLETA_MS);
  }

  function vigiar(l, faixa) {
    const acabou = () => acabouSozinha(l, faixa);
    faixa.addEventListener('ended', acabou, { once: true });
    l.vigias.push(() => faixa.removeEventListener('ended', acabou));
  }

  // O aparelho que acaba sozinho durante a ligação (o ended, que o stop() da página não dá).
  function acabouSozinha(l, faixa) {
    if (!l.viva || l.fim) return;
    if (faixa.kind === 'audio') {
      l.silencio ??= faixaDoSilencio();
      transceiver(l, 'audio')
        ?.sender.replaceTrack(l.silencio)
        .catch(() => {});
      l.sessao.unmute({ audio: true }); // o silêncio não tem o que desligar
      return;
    }
    // A câmera que a ligação pegou de volta ainda está no fluxo: o midia.js não a vigia.
    if (l.fluxo?.getVideoTracks().includes(faixa)) {
      l.fluxo.removeTrack(faixa);
      const mic = l.fluxo.getAudioTracks().some(viva) ? 'ligado' : 'indisponivel';
      aoEvento({ tipo: 'midia', mic, cam: 'indisponivel' });
    }
    l.fila = l.fila.then(() => apagarACamera(l)).catch(() => {});
  }

  // Desligar a câmera: a faixa para e sai do fluxo na hora (a luz apaga, e uma volta já a vê desligada), e o vídeo
  // fica sem faixa.
  async function apagarACamera(l) {
    const t = transceiver(l, 'video');
    t?.sender.track?.stop();
    for (const faixa of l.fluxo?.getVideoTracks() ?? []) {
      faixa.stop();
      l.fluxo.removeTrack(faixa);
    }
    await t?.sender.replaceTrack(null);
  }

  // Ligar a câmera: um getUserMedia só de vídeo. A faixa nova entra no fluxo, vigiada, antes de ir à ligação: a
  // conexão que cair no meio deixa a câmera ligada para a volta. A que chega depois de a ligação descer para: a câmera,
  // então, já é do midia.js. A ligação no ar que recusa a faixa a para, e a câmera volta a desligada (o ok falso).
  async function acenderACamera(l) {
    const [faixa] = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks();
    const t = transceiver(l, 'video');
    if (!l.viva || l.fim || !t) {
      faixa.stop();
      throw new Error('a ligação acabou');
    }
    l.fluxo?.addTrack(faixa);
    vigiar(l, faixa);
    try {
      await t.sender.replaceTrack(faixa);
    } catch (erro) {
      if (l.viva && !l.fim) {
        faixa.stop();
        l.fluxo?.removeTrack(faixa);
      }
      throw erro;
    }
  }

  function desligar(qual) {
    const l = ligacoes.get(qual);
    if (!l) return;
    ligacoes.delete(qual);
    l.viva = false;
    encerrar(l);
  }

  // A resposta a uma troca da câmera vai só enquanto a ligação dela não desceu: a de uma que desceu responderia à troca
  // da próxima. A câmera que não liga (outro programa a tomou, por exemplo) é o ok falso.
  function trocarCamera(ligada) {
    const l = ligacoes.get('principal');
    if (!l?.confirmada || l.fim) {
      setTimeout(() => aoEvento({ tipo: 'cameraTrocada', ok: false }), 0);
      return;
    }
    const responder = (ok) => {
      if (l.viva && !l.fim) aoEvento({ tipo: 'cameraTrocada', ok });
    };
    l.fila = l.fila
      .then(() => (ligada ? acenderACamera(l) : apagarACamera(l)))
      .then(
        () => responder(true),
        () => responder(false),
      );
  }

  function trocarMicrofone(ligado) {
    const sessao = ligacoes.get('principal')?.sessao;
    if (!sessao) return;
    if (ligado) sessao.unmute({ audio: true });
    else sessao.mute({ audio: true });
  }

  return { ligar, desligar, trocarCamera, trocarMicrofone };
}
