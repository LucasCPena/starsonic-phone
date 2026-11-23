// A câmera e o microfone da página. O pedir dá ao cérebro o midia {mic, cam}, com o ligado ou o indisponivel de cada
// aparelho, e mostra a imagem nas prévias (os <video> mudos da entrada e da espera). Os dois vêm juntos. Se o navegador
// recusar, cada um é pedido sozinho, e a pessoa entra com o que funciona. Depois de um pedido de permissão fechado (o
// NotAllowedError), um aparelho só é pedido sozinho se já estiver liberado, ou se estiver por perguntar com o outro
// bloqueado (o sozinhos).
//
// A escolha da pessoa:
// - o microfone desligado é a faixa com o enabled falso, em toda tela;
// - sem a ligação no ar, a câmera desligada para (a luz apaga) e sai do fluxo, e a câmera que a pessoa liga de novo
//   (do desligado para o ligado) é pedida sozinha e volta ao mesmo fluxo. Com a ligação no ar (na reunião, sem a
//   conexão caída), a câmera é da ligação, e daqui ninguém a para nem a pede. A conexão que cai a devolve: a escolha
//   volta a valer no fluxo, e a câmera ligada que falta nele (a que a ligação ainda pedia quando a conexão caiu) é
//   pedida sozinha. Nenhum outro desenho a pede.
// Assim, no ligar, uma faixa de câmera viva no fluxo quer dizer a câmera ligada; nenhuma, o vídeo sem faixa.
//
// A faixa que acaba sozinha (o aparelho saiu, ou outro programa o tomou: o ended, que o stop() da página não dá) sai
// do fluxo, e o aparelho dela passa a faltar, em toda tela; a câmera que a ligação pôs no fluxo é vigiada daqui quando
// volta a ser do midia.js. Nada é pedido de novo: o Tentar de novo pede os dois.
//
// O parar desliga a câmera e o microfone (a captura da tela tem o pararCaptura dela), e vale duas vezes seguidas. O
// pedido que responde depois de um parar ou de outro pedir (e o da câmera sozinha, também depois de a escolha voltar a
// desligada) para assim que chega, sem ir ao cérebro.
//
// O silêncio gerado é a faixa de som de quem está sem microfone (o desenho, item 6; toda ligação manda som): um
// oscilador num ganho zero, num MediaStreamAudioDestination. Sem RTP, a ligação cairia pelo tempo sem mídia (60 s); o
// oscilador dá ao destino o que mandar (o Chromium manda também o de um destino vazio, mas o desenho não conta com
// isso). O AudioContext dele nasce e acorda nos cliques que levam à reunião e no Compartilhar a tela (o despertar):
// fora de um gesto, o navegador o deixa parado (suspended), e um contexto parado não processa o som.
//
// A captura da tela (o desenho, item 4) é a imagem que a ligação da tela manda, com o silêncio. O capturarTela chama o
// getDisplayMedia, só da imagem, dentro do clique do Compartilhar a tela (o Safari e o Firefox só o deixam dentro do
// gesto), e a resposta vai ao cérebro como o telaCapturada; a escolha cancelada, ou um erro, é o ok falso, sem aviso.
// Um pedido de cada vez. A captura nunca entra no fluxo e não é um aparelho: o ended da faixa dela (o "Parar de
// compartilhar" do próprio navegador) é o clique pararDeCompartilhar, uma vez, e nunca um midia. O pararCaptura para
// todas as faixas dela e vale duas vezes seguidas; a captura que a página para não avisa nada, e a que responde depois
// de o cérebro desistir dela para assim que chega.
//
// Os aparelhos do app (o aparelhos, com os nomes das Configurações do app, dentro do iframe dele): cada pedido da
// câmera e do microfone, daqui e da ligação (o restricoesDaCamera e o restricoesDoMicrofone), leva o deviceId do
// aparelho do navegador cujo nome (o label) é o escolhido; e o alto-falante é o setSinkId do <audio> do som da reunião,
// onde o navegador o tem. O nome vazio, ou que o navegador não tem, é o padrão do sistema. O navegador só diz os nomes
// depois da primeira permissão: o primeiro pedido que veio com outro aparelho, quando o escolhido aparece só depois
// dele, é feito de novo. Fora do app, sem nomes, os pedidos são os de sempre, e o alto-falante não muda. Os nomes não
// vão ao console.

const viva = (faixa) => faixa.readyState === 'live';

/**
 * A câmera que a página pede (o desenho): 1280×720 a 30, de frente. Tudo ideal: o navegador dá o mais perto que a
 * câmera tem, e nenhuma câmera fica de fora por não ter esse tamanho. A imagem vai ao mosaico, e o quadro da pessoa
 * sai nítido. Os pedidos daqui e o da câmera ligada na reunião (o ligacao.js) levam as mesmas.
 */
export const CAMERA = Object.freeze({
  width: Object.freeze({ ideal: 1280 }),
  height: Object.freeze({ ideal: 720 }),
  frameRate: Object.freeze({ ideal: 30 }),
  aspectRatio: Object.freeze({ ideal: 16 / 9 }),
  facingMode: Object.freeze({ ideal: 'user' }),
});

// A tela compartilhada (o desenho): até 1920×1080 a 15. O texto de uma tela pede nitidez, e não movimento; o
// contentHint 'detail' da faixa diz o mesmo ao codificador, que, com pouca banda, tira imagens por segundo antes da
// nitidez.
const TELA = Object.freeze({
  video: Object.freeze({
    width: Object.freeze({ max: 1920 }),
    height: Object.freeze({ max: 1080 }),
    frameRate: Object.freeze({ max: 15 }),
  }),
  audio: false,
});

// Os nomes dos aparelhos escolhidos no app: um só na página, como o silêncio, porque a ligação também pede a câmera e o
// microfone (o ligacao.js).
let nomes = { microfone: '', altoFalante: '', camera: '' };

// O deviceId do aparelho do navegador daquele tipo (audioinput, videoinput ou audiooutput) cujo nome é o dado, ou null:
// sem o nome, sem o aparelho, ou sem a lista.
async function idDoNome(tipo, nome) {
  if (!nome) return null;
  try {
    const lista = await navigator.mediaDevices.enumerateDevices();
    return lista.find((d) => d.kind === tipo && d.label === nome && d.deviceId !== '')?.deviceId ?? null;
  } catch {
    return null;
  }
}

/** O que pedir do microfone: o aparelho escolhido no app, ou o padrão (o true). */
export async function restricoesDoMicrofone() {
  const id = await idDoNome('audioinput', nomes.microfone);
  return id === null ? true : { deviceId: { exact: id } };
}

/** O que pedir da câmera: o CAMERA, com o aparelho escolhido no app, se o navegador o tiver. */
export async function restricoesDaCamera() {
  const id = await idDoNome('videoinput', nomes.camera);
  return id === null ? CAMERA : { ...CAMERA, deviceId: { exact: id } };
}

/**
 * A mídia da página: pedir, parar, escolher(mic, cam, reuniao), aparelhos(nomes) (os do app), fluxo() (o MediaStream
 * de agora, ou null),
 * cameraPedida() (a promessa da resposta do pedido da câmera sozinha que ainda corre, ou null), despertar() (o
 * silêncio, dentro de um clique), e a captura da tela: capturarTela() (dentro do clique), pararCaptura() e captura() (o
 * MediaStream dela, ou null). O reuniao do escolher é 'fora' (fora da reunião), 'noAr' (a ligação no ar: a câmera é
 * dela) ou 'caiu' (a conexão caída, até a volta).
 */
export function criarMidia(aoEvento, previas, som = null) {
  let fluxo = null;
  let vez = 0; // a vez do último pedir ou parar: o pedido de uma vez que passou fica de fora
  let pedindo = false; // o pedir de agora ainda não respondeu
  let camera = null; // o pedido da câmera sozinha que ainda não respondeu: {vale, respondeu}
  let religada = false; // a câmera ligada que falta no fluxo, sem a ligação no ar, e que ainda não foi pedida
  let escolha = { mic: 'ligado', cam: 'ligado', reuniao: 'fora' }; // a do último desenho
  const vigiadas = new WeakSet(); // as faixas com o ended vigiado daqui
  let tela = null; // a captura da tela de agora: {fluxo}
  let pedidoDaTela = null; // o getDisplayMedia que ainda não respondeu: {vale}

  function mostrar(novo) {
    if (fluxo && fluxo !== novo) pararFaixas(fluxo);
    fluxo = novo;
    for (const faixa of novo?.getTracks() ?? []) vigiar(faixa);
    for (const video of previas) video.srcObject = novo;
  }

  // O aparelho como o último desenho o tinha: o que faltava continua faltando, e o resto vai como ligado (o cérebro
  // guarda o desligado da pessoa). O fluxo não diz isso da câmera: a desligada fora da reunião não está nele.
  const comoEstava = (qual) => (escolha[qual] === 'indisponivel' ? 'indisponivel' : 'ligado');

  function vigiar(faixa) {
    if (vigiadas.has(faixa)) return;
    vigiadas.add(faixa);
    faixa.addEventListener('ended', () => acabou(faixa), { once: true });
  }

  // A faixa que acaba sozinha sai do fluxo, e o aparelho dela falta; o outro fica como estava. Com um pedir em curso,
  // só a resposta dele vai ao cérebro: um midia antes dela acabaria a espera da mídia, e o ligar sairia com o fluxo que
  // o pedir vai parar.
  function acabou(faixa) {
    if (!fluxo?.getTracks().includes(faixa)) return; // a faixa de um fluxo que já saiu
    fluxo.removeTrack(faixa);
    if (pedindo) return;
    const som = faixa.kind === 'audio';
    aoEvento({
      tipo: 'midia',
      mic: som ? 'indisponivel' : comoEstava('mic'),
      cam: som ? comoEstava('cam') : 'indisponivel',
    });
  }

  // O pedido da câmera sozinha que ainda não respondeu deixa de valer: a resposta dele para quando chegar.
  function esquecerACamera() {
    if (camera) camera.vale = false;
  }

  // Sem a ligação no ar, a câmera segue a escolha: desligada, ela para e sai do fluxo; ligada de novo pela pessoa (ou
  // devolvida pela conexão que caiu) e sem a faixa viva, ela é pedida sozinha, um pedido de cada vez. A câmera que a
  // ligação pôs no fluxo passa a ser vigiada daqui.
  function acertarACamera() {
    const daLigacao = escolha.reuniao === 'noAr';
    if (daLigacao || escolha.cam !== 'ligado') religada = false;
    if (!fluxo || daLigacao) return;
    for (const faixa of fluxo.getTracks()) vigiar(faixa);
    if (escolha.cam !== 'ligado') {
      esquecerACamera();
      for (const faixa of fluxo.getVideoTracks()) {
        faixa.stop();
        fluxo.removeTrack(faixa);
      }
    } else if (religada && !pedindo && !camera) {
      religada = false;
      if (!fluxo.getVideoTracks().some(viva)) pedirACamera();
    }
  }

  // A promessa respondeu acaba quando o pedido acabou de vez: a câmera já está no fluxo, ou não vem.
  async function pedirACamera() {
    let responder;
    const respondeu = new Promise((r) => {
      responder = r;
    });
    const pedido = { vale: true, respondeu };
    camera = pedido;
    const nova = await restricoesDaCamera()
      .then((video) => navigator.mediaDevices.getUserMedia({ video }))
      .catch(() => null);
    camera = null;
    const serve = pedido.vale && fluxo !== null && escolha.reuniao !== 'noAr' && escolha.cam === 'ligado';
    if (nova && serve) {
      for (const faixa of nova.getVideoTracks()) {
        vigiar(faixa);
        fluxo.addTrack(faixa);
      }
      // A prévia recomeça com o mesmo fluxo: a faixa que entra num fluxo que ela já mostra sai esticada no Chromium.
      for (const video of previas) video.srcObject = fluxo;
    } else {
      pararFaixas(nova);
      // A câmera que não voltou falta: o aviso de acesso aparece, e o microfone fica como estava.
      if (!nova && serve) aoEvento({ tipo: 'midia', mic: comoEstava('mic'), cam: 'indisponivel' });
    }
    acertarACamera(); // a escolha pode ter mudado enquanto ele esperava
    responder();
  }

  // Dentro do clique: o getDisplayMedia sai antes de tudo o que é assíncrono. Com um pedido ainda aberto (a escolha da
  // tela na frente da página) ou uma captura de pé, o clique fica de fora.
  function capturarTela() {
    if (pedidoDaTela || tela) return;
    const pedido = { vale: true };
    pedidoDaTela = pedido;
    let resposta;
    try {
      resposta = navigator.mediaDevices.getDisplayMedia(TELA);
    } catch (erro) {
      resposta = Promise.reject(erro);
    }
    const respondeu = () => {
      if (pedidoDaTela === pedido) pedidoDaTela = null;
    };
    Promise.resolve(resposta).then(
      (captura) => {
        respondeu();
        // A que chega depois de o cérebro desistir dela para, sem aviso; a que chega sem imagem viva não serve.
        const serve = captura?.getVideoTracks().some(viva);
        if (!pedido.vale || !serve) {
          pararFaixas(captura);
          if (pedido.vale) aoEvento({ tipo: 'telaCapturada', ok: false });
          return;
        }
        capturada(captura);
        aoEvento({ tipo: 'telaCapturada', ok: true });
      },
      () => {
        respondeu();
        if (pedido.vale) aoEvento({ tipo: 'telaCapturada', ok: false });
      },
    );
  }

  // A captura nova é a de agora. O ended de uma faixa dela, que só o navegador dá (o stop() da página não o dá), é o
  // Parar de compartilhar, uma vez, enquanto ela for a de agora.
  function capturada(captura) {
    for (const faixa of captura.getVideoTracks()) faixa.contentHint = 'detail';
    const esta = { fluxo: captura };
    tela = esta;
    let avisou = false;
    const oNavegadorParou = () => {
      if (tela !== esta || avisou) return;
      avisou = true;
      aoEvento({ tipo: 'clique', botao: 'pararDeCompartilhar' });
    };
    for (const faixa of captura.getTracks()) faixa.addEventListener('ended', oNavegadorParou, { once: true });
  }

  // O alto-falante do app no som da reunião. O navegador sem o setSinkId fica com o padrão; o que recusa também.
  async function acertarOSom() {
    if (typeof som?.setSinkId !== 'function') return;
    const id = (await idDoNome('audiooutput', nomes.altoFalante)) ?? '';
    if (som.sinkId !== id) await som.setSinkId(id).catch(() => {});
  }

  return {
    async pedir() {
      const minha = ++vez;
      pedindo = true;
      religada = false; // o fluxo novo traz a câmera, ou diz que ela falta
      esquecerACamera();
      const { fluxo: novo, mic, cam } = await obter();
      if (minha !== vez) {
        pararFaixas(novo);
        return;
      }
      pedindo = false;
      mostrar(novo);
      aoEvento({ tipo: 'midia', mic, cam }); // o desenho dele acerta a câmera do fluxo novo com a escolha
      // Com a permissão, o navegador já diz o nome do alto-falante.
      if (nomes.altoFalante) acertarOSom();
    },
    aparelhos(novos) {
      const { microfone, altoFalante, camera } = novos;
      if (microfone === nomes.microfone && altoFalante === nomes.altoFalante && camera === nomes.camera) return;
      nomes = { microfone, altoFalante, camera };
      acertarOSom();
    },
    parar() {
      vez++;
      pedindo = false;
      religada = false;
      esquecerACamera();
      mostrar(null);
    },
    escolher(mic, cam, reuniao) {
      // Só a câmera que vai do desligado ao ligado é pedida: o ligado que vem do indisponivel é o de um fluxo novo, que
      // a trouxe, e o desenho de outra tela (o fim da reunião, por exemplo) não muda a escolha. A conexão que cai
      // devolve a câmera da ligação: a ligada que faltar no fluxo também é pedida.
      if (escolha.cam === 'desligado' && cam === 'ligado') religada = true;
      if (escolha.reuniao === 'noAr' && reuniao === 'caiu' && cam === 'ligado') religada = true;
      escolha = { mic, cam, reuniao };
      for (const faixa of fluxo?.getAudioTracks() ?? []) faixa.enabled = mic === 'ligado';
      acertarACamera();
    },
    fluxo: () => fluxo,
    cameraPedida: () => camera?.respondeu ?? null,
    despertar: despertarOSilencio,
    capturarTela,
    pararCaptura() {
      if (pedidoDaTela) pedidoDaTela.vale = false;
      pararFaixas(tela?.fluxo);
      tela = null;
    },
    captura: () => tela?.fluxo ?? null,
  };
}

function pararFaixas(f) {
  for (const faixa of f?.getTracks() ?? []) faixa.stop();
}

// O silêncio é um só na página: o contexto nasce no primeiro despertar, e o gerador, no primeiro pedido da faixa.
let silencio = null; // {contexto, faixa}

/** Cria ou acorda o contexto do silêncio. Só vale dentro de um clique: fora dele, o navegador o deixa parado. */
function despertarOSilencio() {
  try {
    silencio ??= { contexto: new AudioContext(), faixa: null };
    silencio.contexto.resume().catch(() => {});
  } catch {
    // o navegador sem o WebAudio: as ligações saem sem o silêncio
  }
}

/**
 * Uma cópia da faixa do silêncio, que a ligação para quando acaba, ou null antes do primeiro despertar (ou sem o
 * WebAudio).
 */
export function faixaDoSilencio() {
  if (!silencio) return null;
  try {
    if (!silencio.faixa) {
      const { contexto } = silencio;
      const destino = contexto.createMediaStreamDestination();
      const oscilador = contexto.createOscillator();
      const mudo = contexto.createGain();
      mudo.gain.value = 0;
      oscilador.connect(mudo).connect(destino);
      oscilador.start();
      silencio.faixa = destino.stream.getAudioTracks()[0];
    }
    return silencio.faixa.clone();
  } catch {
    return null;
  }
}

// A câmera e o microfone, com os aparelhos escolhidos no app. Antes da primeira permissão, o navegador não diz os nomes,
// e o pedido vem com o padrão: com a permissão, o que veio com outro aparelho é pedido de novo, uma vez, e o novo só
// fica com tudo o que o primeiro deu.
async function obter() {
  const primeiro = await obterCom();
  if (!primeiro.fluxo || (await comOsEscolhidos(primeiro.fluxo))) return primeiro;
  const segundo = await obterCom();
  if (segundo.mic !== primeiro.mic || segundo.cam !== primeiro.cam) {
    pararFaixas(segundo.fluxo);
    return primeiro;
  }
  pararFaixas(primeiro.fluxo);
  return segundo;
}

// O fluxo tem o microfone e a câmera escolhidos, ou o navegador não tem o escolhido.
async function comOsEscolhidos(fluxo) {
  const certo = async (faixas, tipo, nome) => {
    const faixa = faixas.find(viva);
    if (!faixa || !nome) return true;
    const id = await idDoNome(tipo, nome);
    return id === null || faixa.getSettings?.().deviceId === id;
  };
  return (
    (await certo(fluxo.getAudioTracks(), 'audioinput', nomes.microfone)) &&
    (await certo(fluxo.getVideoTracks(), 'videoinput', nomes.camera))
  );
}

async function obterCom() {
  const aparelhos = navigator.mediaDevices;
  if (!aparelhos?.getUserMedia) return { fluxo: null, mic: 'indisponivel', cam: 'indisponivel' };
  const [audio, video] = await Promise.all([restricoesDoMicrofone(), restricoesDaCamera()]);
  try {
    return { fluxo: await aparelhos.getUserMedia({ audio, video }), mic: 'ligado', cam: 'ligado' };
  } catch (erro) {
    const pedir = erro?.name === 'NotAllowedError' ? await sozinhos() : { som: true, imagem: true };
    const som = pedir.som ? await aparelhos.getUserMedia({ audio }).catch(() => null) : null;
    const imagem = pedir.imagem ? await aparelhos.getUserMedia({ video }).catch(() => null) : null;
    const faixas = [...(som?.getTracks() ?? []), ...(imagem?.getTracks() ?? [])];
    return {
      fluxo: faixas.length > 0 ? new MediaStream(faixas) : null,
      mic: som ? 'ligado' : 'indisponivel',
      cam: imagem ? 'ligado' : 'indisponivel',
    };
  }
}

// Depois de um pedido de permissão fechado, pedir um aparelho sozinho abriria outro pedido: só vale pedir o que já está
// liberado, ou o que está por perguntar quando o outro foi bloqueado (o bloqueio de um só). Sem a consulta das
// permissões (ela não existe, lança ou falha), nenhum.
async function sozinhos() {
  try {
    const [som, imagem] = await Promise.all(
      ['microphone', 'camera'].map((name) => navigator.permissions.query({ name })),
    );
    const pode = (este, outro) => este.state === 'granted' || (este.state === 'prompt' && outro.state === 'denied');
    return { som: pode(som, imagem), imagem: pode(imagem, som) };
  } catch {
    return { som: false, imagem: false };
  }
}
