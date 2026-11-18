// O cliente mínimo das reuniões, só para o teste de ponta a ponta (video-servidor/e2e): entra pela página do chat
// (docs/chat-protocolo.md, seção 10) e liga ao servidor de vídeo pelo /sip, com o JsSIP (docs/video-agente.md, seção 6).
// Não é a página de verdade, que é da etapa 1b. Fica em window.cliente.
//
// Toda ligação manda som (a seção 6 do contrato): a da câmera manda o microfone falso, e a da tela, um silêncio
// gerado. O JsSIP vai sem iceServers: no teste não há TURN, e o JsSIP espera os candidatos antes do INVITE.
'use strict';

(() => {
  const video = document.getElementById('video');
  const audio = document.getElementById('audio');
  const quadro = document.createElement('canvas');
  const pincel = quadro.getContext('2d', { willReadFrequently: true });

  const estado = {
    mensagens: [], // as do canal da página, na ordem em que chegaram
    canal: null, // o WebSocket da página
    acesso: null, // o Acesso com que a câmera ligou (o da tela usa o mesmo wss e a mesma uri)
    camera: null, // a ligação da câmera
    tela: null, // a ligação da tela compartilhada
    local: null, // a câmera e o microfone falsos
    analisador: null, // o AnalyserNode do som recebido
    fonte: null, // o que liga o som recebido ao analisador
  };

  let som = null;
  /** O AudioContext da página, já rodando (sem gesto: o teste abre o Chromium com o autoplay liberado). */
  function contextoDeSom() {
    som ??= (async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      return ctx;
    })();
    return som;
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /** A câmera e o microfone falsos, uma vez só. O som vai sem os filtros do navegador, que apagariam um tom constante. */
  async function midiaLocal() {
    estado.local ??= await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: true,
    });
    return estado.local;
  }

  /** Liga o vídeo e o som recebidos aos elementos da página e ao analisador. */
  async function receber(faixas) {
    const fluxo = new MediaStream(faixas);
    video.srcObject = fluxo;
    audio.srcObject = fluxo;
    video.play().catch(() => {});
    audio.play().catch(() => {});
    const somRecebido = faixas.find((f) => f.kind === 'audio');
    if (!somRecebido) return;
    const ctx = await contextoDeSom();
    if (!estado.analisador) {
      estado.analisador = ctx.createAnalyser();
      estado.analisador.fftSize = 8192;
      estado.analisador.smoothingTimeConstant = 0.5;
    }
    estado.fonte?.disconnect();
    estado.fonte = ctx.createMediaStreamSource(new MediaStream([somRecebido]));
    estado.fonte.connect(estado.analisador);
  }

  /**
   * Uma ligação ao servidor de vídeo: um UA do JsSIP só para ela, sem registro, e com o From e o nome neutros
   * (pagina), porque o FreeSWITCH escreve o nome do canal nos avisos dele. Com receber falso, as duas faixas só vão
   * (a tela). Volta quando o INVITE sai; a ligação diz depois se confirmou e como terminou.
   */
  function chamar(acesso, fluxo, receberMidia) {
    return new Promise((pronta, falhou) => {
      const destino = JsSIP.URI.parse(acesso.video.uri);
      if (!destino) {
        falhou(new Error(`a uri do vídeo não vale: ${acesso.video.uri}`));
        return;
      }
      const ua = new JsSIP.UA({
        sockets: [new JsSIP.WebSocketInterface(acesso.video.wss)],
        uri: `sip:pagina@${destino.host}`,
        display_name: 'pagina',
        register: false,
      });
      const ligacao = { ua, sessao: null, confirmada: false, fim: null };
      let terminar;
      let confirmar;
      ligacao.terminada = new Promise((r) => {
        terminar = r;
      });
      ligacao.confirmacao = new Promise((r) => {
        confirmar = r;
      });
      const acabou = (e) => {
        if (ligacao.fim) return;
        const codigo = e.message && typeof e.message.status_code === 'number' ? e.message.status_code : null;
        ligacao.fim = { codigo, causa: String(e.cause), originador: String(e.originator) };
        confirmar(false);
        terminar(ligacao.fim);
        ua.stop();
      };
      const semConexao = setTimeout(() => {
        ua.stop();
        falhou(new Error(`o WebSocket ${acesso.video.wss} não conectou em 10 s`));
      }, 10_000);
      ua.once('connected', () => {
        clearTimeout(semConexao);
        const faixasRecebidas = [];
        const opcoes = {
          extraHeaders: acesso.senha ? [`X-Starsonic-Senha: ${acesso.senha}`] : [],
          mediaStream: fluxo,
          eventHandlers: {
            peerconnection: ({ peerconnection }) => {
              if (!receberMidia) return;
              peerconnection.addEventListener('track', (ev) => {
                const i = faixasRecebidas.findIndex((f) => f.kind === ev.track.kind);
                if (i >= 0) faixasRecebidas.splice(i, 1);
                faixasRecebidas.push(ev.track);
                receber([...faixasRecebidas]).catch((erro) => console.error(`o som recebido: ${erro.message}`));
              });
            },
            confirmed: () => {
              ligacao.confirmada = true;
              confirmar(true);
            },
            ended: acabou,
            failed: acabou,
          },
        };
        if (!receberMidia) opcoes.rtcOfferConstraints = { offerToReceiveAudio: false, offerToReceiveVideo: false };
        ligacao.sessao = ua.call(acesso.video.uri, opcoes);
        pronta(ligacao);
      });
      ua.start();
    });
  }

  /** O abrir, o canal e o pedir (seção 10 do protocolo). Com o aceito, o cliente liga com o Acesso dele. Devolve o
   * bilhete do abrir, que o teste anota para conferir os registros. */
  async function entrarPelaPagina({ chat, codigo, nome }) {
    const r = await fetch(`${chat}/api/v1/pagina/reunioes/${encodeURIComponent(codigo)}`, { method: 'POST' });
    if (r.status !== 200) throw new Error(`o abrir respondeu ${r.status}`);
    const { bilhete } = await r.json();
    const canal = new WebSocket(`${chat.replace(/^http/, 'ws')}/api/v1/pagina/canal?bilhete=${encodeURIComponent(bilhete)}`);
    estado.canal = canal;
    canal.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      estado.mensagens.push(m);
      if (m.tipo === 'aceito') {
        ligar(m).catch((erro) => console.error(`o ligar depois do aceito falhou: ${erro.message}`));
      }
    });
    await new Promise((ok, falha) => {
      canal.addEventListener('open', ok, { once: true });
      canal.addEventListener('close', () => falha(new Error('o canal da página fechou antes de abrir')), { once: true });
    });
    canal.send(JSON.stringify({ tipo: 'pedir', nome }));
    return { bilhete };
  }

  /** A ligação da câmera, com o wss e a uri do Acesso, o X-Starsonic-Senha (quando o Acesso tem a senha) e a câmera e
   * o microfone falsos. Volta quando o INVITE sai. */
  async function ligar(acesso) {
    const local = await midiaLocal();
    await contextoDeSom();
    estado.acesso = acesso;
    estado.camera = await chamar(acesso, local, true);
  }

  /** A senha da tela compartilhada, pedida pelo canal (o tipo tela). */
  function pedirTela() {
    return new Promise((ok, falha) => {
      const canal = estado.canal;
      if (!canal || canal.readyState !== WebSocket.OPEN) {
        falha(new Error('o canal da página não está aberto'));
        return;
      }
      const prazo = setTimeout(() => {
        canal.removeEventListener('message', ouvir);
        falha(new Error('o tela não teve resposta em 10 s'));
      }, 10_000);
      const ouvir = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.tipo !== 'tela' && m.tipo !== 'erro') return;
        clearTimeout(prazo);
        canal.removeEventListener('message', ouvir);
        if (m.tipo === 'tela') ok(m.senha);
        else falha(new Error(`o tela respondeu o erro ${m.erro}`));
      };
      canal.addEventListener('message', ouvir);
      canal.send(JSON.stringify({ tipo: 'tela' }));
    });
  }

  /** A segunda ligação: um canvas verde, redesenhado a cada quadro, e um silêncio gerado, os dois só para mandar.
   * Volta quando a ligação confirma. */
  async function compartilhar(senha) {
    if (!estado.acesso) throw new Error('a câmera ainda não ligou');
    const ctx = await contextoDeSom();
    const tela = document.createElement('canvas');
    tela.width = 640;
    tela.height = 360;
    const g = tela.getContext('2d');
    const pintar = () => {
      g.fillStyle = 'rgb(30, 180, 60)';
      g.fillRect(0, 0, tela.width, tela.height);
    };
    pintar();
    const imagem = tela.captureStream(15);
    const repintar = setInterval(pintar, 1000 / 15);
    // O silêncio gerado: um oscilador com o ganho zero num MediaStreamAudioDestinationNode. O destino sozinho, sem
    // nada ligado nele, não manda RTP nenhum no Chromium, e a ligação da tela cairia pelo tempo sem mídia.
    const silencio = ctx.createMediaStreamDestination();
    const oscilador = ctx.createOscillator();
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    oscilador.connect(mudo).connect(silencio);
    oscilador.start();
    const fluxo = new MediaStream([imagem.getVideoTracks()[0], silencio.stream.getAudioTracks()[0]]);
    const ligacao = await chamar({ ...estado.acesso, senha }, fluxo, false);
    ligacao.terminada.then(() => {
      clearInterval(repintar);
      oscilador.stop();
      fluxo.getTracks().forEach((f) => f.stop());
    });
    estado.tela = ligacao;
    const confirmou = await Promise.race([ligacao.confirmacao, esperar(20_000).then(() => false)]);
    if (!confirmou) throw new Error(`a ligação da tela não confirmou: ${JSON.stringify(ligacao.fim)}`);
  }

  function telaNoAr() {
    return Boolean(estado.tela && estado.tela.confirmada && !estado.tela.fim);
  }

  /** O BYE da ligação da tela. */
  async function pararDeCompartilhar() {
    const l = estado.tela;
    if (!l || l.fim) return;
    l.sessao.terminate();
    await Promise.race([l.terminada, esperar(10_000)]);
  }

  /** Nada mais sai da ligação da câmera (nem o RTP, nem o RTCP, nem as verificações do ICE): a RTCPeerConnection
   * fecha sem o BYE, e o WebSocket continua aberto, como num navegador que perdeu o caminho da mídia. Só tirar as
   * faixas (o replaceTrack(null)) não basta: o RTCP e o ICE continuam, e o FreeSWITCH conta tudo o que chega. */
  function pararDeMandar() {
    const pc = estado.camera && estado.camera.sessao && estado.camera.sessao.connection;
    if (!pc) throw new Error('a câmera não está ligada');
    pc.close();
  }

  /** Sai da reunião: o BYE das ligações e o canal fechado. */
  async function sair() {
    await pararDeCompartilhar();
    const l = estado.camera;
    if (l && !l.fim) {
      l.sessao.terminate();
      await Promise.race([l.terminada, esperar(10_000)]);
    }
    estado.canal?.close();
  }

  /** Como a ligação da câmera terminou ({codigo, causa, originador}; o codigo é o da resposta final, e null num BYE),
   * esperando até prazo ms; null se ela não terminou. */
  function terminou(prazo) {
    const l = estado.camera;
    if (!l) return Promise.resolve(null);
    return Promise.race([l.terminada, esperar(prazo).then(() => null)]);
  }

  /** Como a última ligação da tela terminou, como no terminou da câmera; null se ela não terminou, ou nem saiu. */
  function telaTerminou(prazo) {
    const l = estado.tela;
    if (!l) return Promise.resolve(null);
    return Promise.race([l.terminada, esperar(prazo).then(() => null)]);
  }

  /** Desenha o quadro de agora do vídeo recebido no canvas. Sem vídeo ainda, null. */
  function desenhar() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    if (quadro.width !== w || quadro.height !== h) {
      quadro.width = w;
      quadro.height = h;
    }
    pincel.drawImage(video, 0, 0, w, h);
    return { w, h };
  }

  /** O [r, g, b] médio de um quadradinho de 5×5 em volta do ponto (em frações) do vídeo recebido. */
  function amostra(fx, fy) {
    const t = desenhar();
    if (!t) return null;
    const x = Math.min(t.w - 3, Math.max(2, Math.round(fx * t.w)));
    const y = Math.min(t.h - 3, Math.max(2, Math.round(fy * t.h)));
    const d = pincel.getImageData(x - 2, y - 2, 5, 5).data;
    const soma = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      soma[0] += d[i];
      soma[1] += d[i + 1];
      soma[2] += d[i + 2];
    }
    return soma.map((c) => Math.round(c / (d.length / 4)));
  }

  /** A frequência mais forte do som recebido (de 100 Hz para cima) e o nível dela, em dB. Sem som ainda, null. */
  function frequencia() {
    const a = estado.analisador;
    if (!a) return null;
    const dados = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(dados);
    const taxa = a.context.sampleRate;
    const inicio = Math.ceil((100 * a.fftSize) / taxa);
    let melhor = inicio;
    for (let i = inicio; i < dados.length; i++) {
      if (dados[i] > dados[melhor]) melhor = i;
    }
    return { hz: (melhor * taxa) / a.fftSize, db: Number.isFinite(dados[melhor]) ? dados[melhor] : -1000 };
  }

  /** O estado das ligações e do vídeo recebido, para a mensagem de um teste que falha. */
  function diagnostico() {
    const daLigacao = (l) => {
      if (!l) return null;
      const pc = l.sessao && l.sessao.connection;
      return {
        ua: l.ua.isConnected() ? 'conectado' : 'desconectado',
        sessao: l.sessao ? l.sessao.status : null,
        confirmada: l.confirmada,
        fim: l.fim,
        ice: pc ? pc.iceConnectionState : null,
        conexao: pc ? pc.connectionState : null,
        recebe: pc ? pc.getReceivers().map((r) => `${r.track.kind}:${r.track.readyState}:${r.track.muted ? 'mudo' : 'som'}`) : [],
      };
    };
    return {
      camera: daLigacao(estado.camera),
      tela: daLigacao(estado.tela),
      video: { largura: video.videoWidth, altura: video.videoHeight, pronto: video.readyState },
      canal: estado.canal ? estado.canal.readyState : null,
    };
  }

  /** Os contadores do RTP que sai e que chega de cada ligação, e o par de candidatos de cada transporte (o estado e
   * as verificações do ICE com resposta), pelo getStats, para a mensagem de um teste que falha. */
  async function estatisticas() {
    const daLigacao = async (l) => {
      const pc = l && l.sessao && l.sessao.connection;
      if (!pc || pc.signalingState === 'closed') return null;
      const saida = {};
      const relatorio = await pc.getStats();
      relatorio.forEach((s) => {
        if (s.type === 'outbound-rtp' || s.type === 'inbound-rtp') {
          saida[`${s.type === 'outbound-rtp' ? 'sai' : 'chega'}-${s.kind}`] = {
            pacotes: s.packetsSent ?? s.packetsReceived,
            quadros: s.framesEncoded ?? s.framesDecoded,
          };
        }
        if (s.type === 'transport' && s.selectedCandidatePairId) {
          const par = relatorio.get(s.selectedCandidatePairId);
          const local = par && relatorio.get(par.localCandidateId);
          const remoto = par && relatorio.get(par.remoteCandidateId);
          saida[`par-${s.id.slice(-6)}`] = par && {
            estado: par.state,
            pedidos: par.requestsSent,
            respostas: par.responsesReceived,
            local: local && `${local.protocol}:${local.port}`,
            remoto: remoto && `${remoto.protocol}:${remoto.port}`,
            dtls: s.dtlsState,
          };
        }
      });
      return saida;
    };
    return { camera: await daLigacao(estado.camera), tela: await daLigacao(estado.tela) };
  }

  window.cliente = {
    diagnostico,
    estatisticas,
    entrarPelaPagina,
    ligar,
    mensagens: () => estado.mensagens.slice(),
    amostra,
    frequencia,
    pedirTela,
    compartilhar,
    telaNoAr,
    pararDeCompartilhar,
    pararDeMandar,
    sair,
    terminou,
    telaTerminou,
  };
})();
