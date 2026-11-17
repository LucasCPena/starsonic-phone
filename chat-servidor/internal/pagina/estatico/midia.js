// A câmera e o microfone da página. O pedir dá ao cérebro o midia {mic, cam}, com o ligado ou o indisponivel de cada
// aparelho, e mostra a imagem nas prévias (os <video> mudos da entrada e da espera). Os dois vêm juntos. Se o navegador
// recusar, cada um é pedido sozinho, e a pessoa entra com o que funciona; depois de um pedido de permissão fechado (o
// NotAllowedError), só o aparelho que não abre outro pedido (o sozinhos).
//
// A escolha da pessoa:
// - o microfone desligado é a faixa com o enabled falso, em toda tela;
// - fora da reunião, a câmera desligada para (a luz apaga) e sai do fluxo, e a câmera ligada de novo é pedida sozinha
//   e volta ao mesmo fluxo; na reunião, a câmera é da ligação, e daqui ninguém a para nem a pede.
// Assim, no ligar, uma faixa de câmera viva no fluxo quer dizer a câmera ligada; nenhuma, a oferta recvonly.
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
  let escolha = { cam: 'ligado', naReuniao: false }; // a da câmera, no último desenho

  function mostrar(novo) {
    if (fluxo && fluxo !== novo) pararFaixas(fluxo);
    fluxo = novo;
    for (const video of previas) video.srcObject = novo;
  }

  // O pedido da câmera sozinha que ainda não respondeu deixa de valer: a resposta dele para quando chegar.
  function esquecerACamera() {
    if (camera) camera.vale = false;
  }

  // Fora da reunião, a câmera segue a escolha: desligada, ela para e sai do fluxo; ligada e sem a faixa viva, ela é
  // pedida sozinha, um pedido de cada vez.
  function acertarACamera() {
    if (!fluxo || escolha.naReuniao) return;
    if (escolha.cam !== 'ligado') {
      esquecerACamera();
      for (const faixa of fluxo.getVideoTracks()) {
        faixa.stop();
        fluxo.removeTrack(faixa);
      }
    } else if (!pedindo && !camera && !fluxo.getVideoTracks().some(viva)) {
      pedirACamera();
    }
  }

  async function pedirACamera() {
    const pedido = { vale: true };
    camera = pedido;
    const nova = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
    camera = null;
    const serve = pedido.vale && fluxo !== null && !escolha.naReuniao && escolha.cam === 'ligado';
    if (nova && serve) {
      for (const faixa of nova.getVideoTracks()) fluxo.addTrack(faixa);
      // A prévia recomeça com o mesmo fluxo: a faixa que entra num fluxo que ela já mostra sai esticada no Chromium.
      for (const video of previas) video.srcObject = fluxo;
    } else {
      pararFaixas(nova);
      // A câmera que não voltou falta: o aviso de acesso aparece, e o microfone fica como está.
      if (!nova && serve) {
        const mic = fluxo.getAudioTracks().some(viva) ? 'ligado' : 'indisponivel';
        aoEvento({ tipo: 'midia', mic, cam: 'indisponivel' });
      }
    }
    acertarACamera(); // a escolha pode ter mudado enquanto ele esperava
  }

  return {
    async pedir() {
      const minha = ++vez;
      pedindo = true;
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
      esquecerACamera();
      mostrar(null);
    },
    escolher(mic, cam, naReuniao) {
      escolha = { cam, naReuniao };
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
