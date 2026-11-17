// A câmera e o microfone da página. O pedir dá ao cérebro o midia {mic, cam}, com o ligado ou o indisponivel de cada
// aparelho, e mostra a imagem nas prévias (os <video> mudos da entrada e da espera). Os dois vêm juntos; se o navegador
// recusar, cada um é pedido sozinho, e a pessoa entra com o que funciona. A escolha dela (o Microfone e a Câmera) fica
// no enabled das faixas. O parar desliga tudo, e a luz da câmera apaga; ele vale duas vezes seguidas, e o fluxo de um
// pedido que respondeu depois de um parar (ou de outro pedir) para assim que chega, sem ir ao cérebro.

/** A mídia da página: pedir, parar, escolher(mic, cam) e fluxo(), o MediaStream de agora (ou null). */
export function criarMidia(aoEvento, previas) {
  let fluxo = null;
  let vez = 0; // a vez do último pedir ou parar: o pedido de uma vez que passou fica de fora

  function trocar(novo) {
    if (fluxo && fluxo !== novo) pararFaixas(fluxo);
    fluxo = novo;
    for (const video of previas) video.srcObject = novo;
  }

  return {
    async pedir() {
      const minha = ++vez;
      const { fluxo: novo, mic, cam } = await obter();
      if (minha !== vez) {
        pararFaixas(novo);
        return;
      }
      trocar(novo);
      aoEvento({ tipo: 'midia', mic, cam });
    },
    parar() {
      vez++;
      trocar(null);
    },
    // O enabled de cada faixa segue a escolha da pessoa.
    escolher(mic, cam) {
      if (!fluxo) return;
      for (const faixa of fluxo.getAudioTracks()) faixa.enabled = mic === 'ligado';
      for (const faixa of fluxo.getVideoTracks()) faixa.enabled = cam === 'ligado';
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
  } catch {
    const som = await aparelhos.getUserMedia({ audio: true }).catch(() => null);
    const imagem = await aparelhos.getUserMedia({ video: true }).catch(() => null);
    const faixas = [...(som?.getTracks() ?? []), ...(imagem?.getTracks() ?? [])];
    return {
      fluxo: faixas.length > 0 ? new MediaStream(faixas) : null,
      mic: som ? 'ligado' : 'indisponivel',
      cam: imagem ? 'ligado' : 'indisponivel',
    };
  }
}
