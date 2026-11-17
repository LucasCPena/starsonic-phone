// A câmera e o microfone da página. O pedir dá ao cérebro o midia {mic, cam}, com o ligado ou o indisponivel de cada
// aparelho, e mostra a imagem nas prévias (os <video> mudos da entrada e da espera). Os dois vêm juntos. Se o navegador
// recusar, cada um é pedido sozinho, e a pessoa entra com o que funciona. Depois de um pedido de permissão fechado (o
// NotAllowedError), um aparelho só é pedido sozinho se já estiver liberado, ou se estiver por perguntar com o outro
// bloqueado (o sozinhos).
//
// A escolha da pessoa:
// - o microfone desligado é a faixa com o enabled falso, em toda tela;
// - fora da reunião, a câmera desligada para (a luz apaga) e sai do fluxo, e a câmera que a pessoa liga de novo (do
//   desligado para o ligado) é pedida sozinha e volta ao mesmo fluxo; nenhum outro desenho a pede. Na reunião, a
//   câmera é da ligação, e daqui ninguém a para nem a pede.
// Assim, no ligar, uma faixa de câmera viva no fluxo quer dizer a câmera ligada; nenhuma, a oferta recvonly.
//
// A faixa que acaba sozinha (o aparelho saiu, ou outro programa o tomou: o ended, que o stop() da página não dá) sai
// do fluxo, e o aparelho dela passa a faltar, em toda tela. Nada é pedido de novo: o Tentar de novo pede os dois.
//
// O parar desliga tudo, e vale duas vezes seguidas. O pedido que responde depois de um parar ou de outro pedir (e o da
// câmera sozinha, também depois de a escolha voltar a desligada) para assim que chega, sem ir ao cérebro.

const viva = (faixa) => faixa.readyState === 'live';

/** A mídia da página: pedir, parar, escolher(mic, cam, naReuniao) e fluxo(), o MediaStream de agora (ou null). */
export function criarMidia(aoEvento, previas) {
  let fluxo = null;
  let vez = 0; // a vez do último pedir ou parar: o pedido de uma vez que passou fica de fora
  let pedindo = false; // o pedir de agora ainda não respondeu
  let camera = null; // o pedido da câmera sozinha que ainda não respondeu: {vale}
  let religada = false; // a câmera que a pessoa ligou de novo, fora da reunião, e que ainda não foi pedida
  let escolha = { mic: 'ligado', cam: 'ligado', naReuniao: false }; // a do último desenho

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

  // Fora da reunião, a câmera segue a escolha: desligada, ela para e sai do fluxo; ligada de novo pela pessoa e sem a
  // faixa viva, ela é pedida sozinha, um pedido de cada vez.
  function acertarACamera() {
    if (escolha.naReuniao || escolha.cam !== 'ligado') religada = false;
    if (!fluxo || escolha.naReuniao) return;
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

  async function pedirACamera() {
    const pedido = { vale: true };
    camera = pedido;
    const nova = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
    camera = null;
    const serve = pedido.vale && fluxo !== null && !escolha.naReuniao && escolha.cam === 'ligado';
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
    },
    parar() {
      vez++;
      pedindo = false;
      religada = false;
      esquecerACamera();
      mostrar(null);
    },
    escolher(mic, cam, naReuniao) {
      // Só a câmera que vai do desligado ao ligado é pedida: o ligado que vem do indisponivel é o de um fluxo novo, que
      // a trouxe, e o desenho de outra tela (o fim da reunião, por exemplo) não muda a escolha.
      if (escolha.cam === 'desligado' && cam === 'ligado') religada = true;
      escolha = { mic, cam, naReuniao };
      for (const faixa of fluxo?.getAudioTracks() ?? []) faixa.enabled = mic === 'ligado';
      acertarACamera();
    },
    fluxo: () => fluxo,
  };
}

function pararFaixas(f) {
  for (const faixa of f?.getTracks() ?? []) faixa.stop();
}

async function obter() {
  const aparelhos = navigator.mediaDevices;
  if (!aparelhos?.getUserMedia) return { fluxo: null, mic: 'indisponivel', cam: 'indisponivel' };
  try {
    return { fluxo: await aparelhos.getUserMedia({ audio: true, video: true }), mic: 'ligado', cam: 'ligado' };
  } catch (erro) {
    const pedir = erro?.name === 'NotAllowedError' ? await sozinhos() : { som: true, imagem: true };
    const som = pedir.som ? await aparelhos.getUserMedia({ audio: true }).catch(() => null) : null;
    const imagem = pedir.imagem ? await aparelhos.getUserMedia({ video: true }).catch(() => null) : null;
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
