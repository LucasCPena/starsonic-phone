// A conta do sinalizador de qualidade da reunião (a seção 7.4 do desenho do chat e do sinalizador): o que a página lê
// dos números do navegador (o getStats da ligação principal), a medida entre duas leituras, o estado de cada medida e o
// estado mostrado, que não acompanha cada medida para não piscar. As contas são funções puras; o medidor, no fim, é quem
// lê a cada 2 s. Ele mede só a conexão da própria pessoa, não manda nada a servidor nenhum, não escreve nada no
// console, e não guarda o relatório depois de o ler. No fim do arquivo estão os textos do botão e do cartão.
//
// Dois números do navegador são guardados por ele até chegar o seguinte: o relatório que o servidor de vídeo manda de
// volta (um a cada 4 ou 5 s) e a amostra do atraso (uma a cada 2,5 s, no par de endereços do Chromium). Lidos a cada
// 2 s, eles não são um número novo a cada leitura. Por isso cada leitura lembra três coisas da anterior: desde quando
// a página manda cada tipo (um relatório de antes disso não fala do que ela manda), quantos pacotes perdidos o
// relatório anterior de cada fluxo contava (um relatório sem perdidos novos não diz perda), e as duas últimas amostras
// do atraso (uma só, lida duas vezes, não são duas).

/** A página mede a cada 2 s. */
export const INTERVALO_MS = 2000;
/** O relatório que o servidor de vídeo manda de volta vale por 10 s. */
export const VALIDADE_DO_RELATORIO_MS = 10000;
/** A leitura que chega mais de 6 s depois da anterior é só a base de novo: a página esteve parada. */
export const PAUSA_MS = 3 * INTERVALO_MS;
/** Os limites da conta, num lugar só. A perda é uma fração; o atraso, em ms. */
export const LIMITES = Object.freeze({
  perda: Object.freeze({ instavel: 0.02, ruim: 0.08 }),
  atraso: Object.freeze({ instavel: 250, ruim: 500 }),
});

const numero = (v) => typeof v === 'number' && Number.isFinite(v);
/** O maior dos números, ou null sem nenhum. */
const maior = (valores) => valores.filter(numero).reduce((m, v) => (m === null || v > m ? v : m), null);

/**
 * O que uma leitura guarda do getStats (um RTCStatsReport, ou qualquer coisa com o forEach dele), com o que ela lembra
 * da leitura anterior (antes; sem ela, a leitura não tem memória):
 * { agora, som, video, sai, relatos, atraso, amostras }.
 *   agora: o maior timestamp do relatório, em ms;
 *   som: { recebidos, perdidos } do inbound-rtp de áudio, ou null; video: { recebidos, perdidos, imagens } do de vídeo
 *     (as imagens são o framesDecoded, ou null sem ele), ou null; mais de um do mesmo tipo são somados;
 *   sai: o que a página manda de cada tipo, { som, video }, cada um com { enviados, desde, perda }:
 *     - os enviados são os packetsSent dos outbound-rtp do tipo, somados, ou null sem eles;
 *     - o desde é o agora da primeira leitura que viu a página mandar esse tipo sem parar até aqui (os enviados
 *       andaram desde a leitura anterior); null quando ela não mandou, ou quando a página não tem como saber;
 *     - a perda é a maior entre as que dizem os remote-inbound-rtp do tipo que chegaram depois do desde e a até 10 s
 *       do agora; null sem nenhum. O servidor manda o relatório também do que a página não manda, e o relatório que
 *       chegou antes de ela começar a mandar não fala do que ela manda;
 *   relatos: de cada remote-inbound-rtp (pelo id dele), o último relatório visto: { quando, perdidos, base, temBase }.
 *     Os perdidos são o packetsLost (os que o servidor conta desde o começo do fluxo), e a base, os do relatório
 *     anterior do mesmo fluxo. O relatório diz a fractionLost dele só quando traz perdidos novos (mais que a base);
 *     sem perdidos novos, a perda dele é zero, e o primeiro relatório visto de um fluxo é só a base (não diz nada).
 *     O FreeSWITCH conta um pacote perdido que não existe no fluxo que começa depois do primeiro relatório dele, e
 *     esse pacote aparece na fractionLost dos primeiros relatórios sem nunca aumentar os perdidos. Sem a conta dos
 *     perdidos (um navegador que não a dá), vale a fractionLost;
 *   amostras: as duas últimas amostras diferentes do atraso, cada uma { id, valor (em ms) }. A amostra é o
 *     currentRoundTripTime do par de endereços em uso, e o id dela é a resposta de que ela veio (o responsesReceived
 *     do par; sem ele, null: a página não sabe, e cada leitura conta como uma amostra); sem o número do par, é o
 *     roundTripTime do remote-inbound-rtp do som com até 10 s, e o id é o daquele relatório. Sem amostra nenhuma, a
 *     leitura esquece as de antes;
 *   atraso: em ms, o menor das duas amostras; com menos de duas, null.
 * Sem relatório, null.
 */
export function leitura(relatorio, antes = null) {
  if (!relatorio || typeof relatorio.forEach !== 'function') return null;
  const chegam = { audio: null, video: null };
  const mandados = { audio: null, video: null }; // os pacotes que a página mandou de cada tipo
  const voltam = []; // os remote-inbound-rtp
  const pares = [];
  let parDoTransporte = null;
  let agora = null;
  relatorio.forEach((s) => {
    if (!s || typeof s !== 'object') return;
    if (numero(s.timestamp) && (agora === null || s.timestamp > agora)) agora = s.timestamp;
    const tipo = s.kind ?? s.mediaType;
    if (s.type === 'inbound-rtp' && (tipo === 'audio' || tipo === 'video')) {
      if (!numero(s.packetsReceived) || !numero(s.packetsLost)) return;
      const t = chegam[tipo] ?? { recebidos: 0, perdidos: 0, imagens: null };
      t.recebidos += s.packetsReceived;
      t.perdidos += s.packetsLost;
      if (numero(s.framesDecoded)) t.imagens = (t.imagens ?? 0) + s.framesDecoded;
      chegam[tipo] = t;
    } else if (s.type === 'outbound-rtp' && (tipo === 'audio' || tipo === 'video')) {
      if (numero(s.packetsSent)) mandados[tipo] = (mandados[tipo] ?? 0) + s.packetsSent;
    } else if (s.type === 'remote-inbound-rtp') {
      voltam.push({
        id: s.id,
        tipo,
        quando: s.timestamp,
        fracao: s.fractionLost,
        perdidos: s.packetsLost,
        atraso: s.roundTripTime,
      });
    } else if (s.type === 'candidate-pair') {
      pares.push(s);
    } else if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') {
      parDoTransporte = s.selectedCandidatePairId;
    }
  });

  // Cada relatório do servidor com a hora dele, com o que a leitura anterior lembra do mesmo fluxo: a perda que ele
  // diz, e o que fica guardado para a leitura seguinte.
  const relatos = {};
  const julgados = voltam
    .filter((v) => numero(v.quando))
    .map((v) => {
      const guardado = antes?.relatos?.[v.id];
      const visto =
        guardado === undefined
          ? { quando: v.quando, perdidos: v.perdidos, base: undefined, temBase: false }
          : guardado.quando === v.quando
            ? guardado
            : { quando: v.quando, perdidos: v.perdidos, base: guardado.perdidos, temBase: true };
      relatos[v.id] = visto;
      return { ...v, perda: perdaDoRelatorio(v, visto) };
    });
  // Os que ainda valem.
  const novos = julgados.filter((v) => agora - v.quando <= VALIDADE_DO_RELATORIO_MS);
  // O que a página manda de um tipo: desde quando, e a perda que o servidor diz do que ela mandou desde então.
  const saida = (qual, tipo) => {
    const enviados = mandados[tipo];
    const anterior = antes?.sai?.[qual] ?? null;
    // Sem o contador de agora, a comparação já dá falso; sem o de antes, ela daria verdadeiro.
    const mandou = anterior !== null && numero(anterior.enviados) && enviados > anterior.enviados;
    const desde = mandou ? (anterior.desde ?? agora) : null;
    if (desde === null) return { enviados, desde: null, perda: null };
    const perdas = novos.filter((v) => v.tipo === tipo && v.quando > desde).map((v) => v.perda);
    return { enviados, desde, perda: maior(perdas) };
  };
  const sai = { som: saida('som', 'audio'), video: saida('video', 'video') };
  // O par em uso: o do transport; sem ele, o que diz selected; sem ele, o nomeado que deu certo.
  const emUso =
    pares.find((p) => parDoTransporte !== null && p.id === parDoTransporte) ??
    pares.find((p) => p.selected === true) ??
    pares.find((p) => p.nominated === true && p.state === 'succeeded');
  const amostras = amostrasCom(antes?.amostras ?? [], amostraDoAtraso(emUso, novos));
  const atraso = amostras.length === 2 ? Math.min(amostras[0].valor, amostras[1].valor) : null;

  const som = chegam.audio ? { recebidos: chegam.audio.recebidos, perdidos: chegam.audio.perdidos } : null;
  return { agora, som, video: chegam.video, sai, relatos, atraso, amostras };
}

// A perda que um relatório do servidor diz, com o que a página lembra do fluxo dele (o visto): a fractionLost, quando
// ele traz pacotes perdidos novos; zero, quando não traz; e null no primeiro relatório visto do fluxo, que é só a base
// da conta, ou quando a fração não é um número que valha. Sem a conta dos perdidos, neste relatório ou no anterior,
// vale a fração.
function perdaDoRelatorio(v, visto) {
  if (!numero(v.fracao) || v.fracao < 0) return null;
  if (!numero(v.perdidos)) return v.fracao;
  if (!visto.temBase) return null;
  if (!numero(visto.base)) return v.fracao;
  return v.perdidos > visto.base ? v.fracao : 0;
}

// A amostra do atraso de um relatório: a do par de endereços em uso, com a resposta de que ela veio; sem o número do
// par, a do relatório do som que ainda vale. Sem nenhuma, null.
function amostraDoAtraso(emUso, novos) {
  const doPar = emUso?.currentRoundTripTime;
  if (numero(doPar)) {
    const respostas = emUso.responsesReceived;
    return { id: numero(respostas) ? `${emUso.id}:${respostas}` : null, valor: doPar * 1000 };
  }
  const doSom = novos.find((v) => v.tipo === 'audio' && numero(v.atraso));
  return doSom ? { id: `som:${doSom.quando}`, valor: doSom.atraso * 1000 } : null;
}

// As duas últimas amostras diferentes, com mais uma: a mesma amostra lida de novo (o mesmo id) não entra outra vez. Sem
// o id, a página não sabe se é a mesma, e ela entra. Sem amostra, as guardadas são esquecidas.
function amostrasCom(guardadas, nova) {
  if (nova === null) return [];
  const ultima = guardadas.at(-1);
  if (ultima !== undefined && nova.id !== null && nova.id === ultima.id) return guardadas;
  return [...guardadas, nova].slice(-2);
}

// A perda de um tipo entre duas leituras: os perdidos sobre os perdidos mais os recebidos. Os perdidos que diminuem (um
// pacote atrasado que chegou) contam zero. Sem pacote novo nenhum, ou com o contador dos recebidos andando para trás,
// o tipo não dá número.
function perdaDoQueChega(antes, depois) {
  if (!antes || !depois) return null;
  const recebidos = depois.recebidos - antes.recebidos;
  if (recebidos < 0) return null;
  const perdidos = Math.max(0, depois.perdidos - antes.perdidos);
  return recebidos + perdidos === 0 ? null : perdidos / (recebidos + perdidos);
}

// O que chegou de um tipo entre duas leituras: 'chegou', 'nada', ou 'incerto' (o contador andou para trás, e isso não
// prova que nada chegou). Sem o tipo nas duas leituras, null.
function chegada(antes, depois) {
  if (antes === null || depois === null) return null;
  const novos = depois - antes;
  return novos > 0 ? 'chegou' : novos === 0 ? 'nada' : 'incerto';
}

/**
 * A medida entre duas leituras: { perda, atraso, nadaChegou }. A perda é uma fração, a maior entre a do som que chega,
 * a do vídeo que chega e a que a leitura de agora traz do som e do vídeo que a página manda (a que o servidor diz, e só
 * do que ela manda: com a câmera desligada o vídeo vai sem faixa, e o primeiro relatório do FreeSWITCH sobre ele conta
 * um pacote perdido, que de nenhum é 255/256); ou null. O atraso, em ms, é o da leitura de agora; ou null.
 * O nadaChegou: nenhum pacote de som novo e nenhuma imagem nova, entre os tipos que as duas leituras têm (sem a conta
 * das imagens, valem os pacotes do vídeo). Sem uma das leituras, null.
 */
export function medida(antes, depois) {
  if (!antes || !depois) return null;
  const perda = maior([
    perdaDoQueChega(antes.som, depois.som),
    perdaDoQueChega(antes.video, depois.video),
    depois.sai.som.perda,
    depois.sai.video.perda,
  ]);
  const comImagens = antes.video?.imagens != null && depois.video?.imagens != null;
  const chegadas = [
    chegada(antes.som?.recebidos ?? null, depois.som?.recebidos ?? null),
    comImagens
      ? chegada(antes.video.imagens, depois.video.imagens)
      : chegada(antes.video?.recebidos ?? null, depois.video?.recebidos ?? null),
  ].filter((c) => c !== null);
  const nadaChegou = chegadas.length > 0 && chegadas.every((c) => c === 'nada');
  return { perda, atraso: depois.atraso, nadaChegou };
}

/**
 * O estado de uma medida: 'ruim', 'instavel', 'boa' ou 'semNumero'. Com um número só (a perda sem o atraso, ou o
 * contrário), ele decide. Sem número nenhum e com alguma coisa chegando, é 'semNumero': o número que o navegador não
 * dá não conta contra a pessoa.
 */
export function classificar(m) {
  if (m.nadaChegou) return 'ruim';
  const temPerda = numero(m.perda);
  const temAtraso = numero(m.atraso);
  if (!temPerda && !temAtraso) return 'semNumero';
  if ((temPerda && m.perda >= LIMITES.perda.ruim) || (temAtraso && m.atraso >= LIMITES.atraso.ruim)) return 'ruim';
  if ((temPerda && m.perda >= LIMITES.perda.instavel) || (temAtraso && m.atraso >= LIMITES.atraso.instavel)) {
    return 'instavel';
  }
  return 'boa';
}

// Do melhor para o pior. O medindo conta como melhor que todos: as duas primeiras medidas o tiram dele.
const ORDEM = ['medindo', 'boa', 'instavel', 'ruim'];
const nivel = (estado) => ORDEM.indexOf(estado);
/** Piorar pede 2 medidas piores; melhorar, 5 melhores. */
const PARA_PIORAR = 2;
const PARA_MELHORAR = 5;
/** Duas medidas seguidas sem número voltam ao medindo. */
const SEM_NUMERO_PARA_MEDIR = 2;

/** A conta do estado mostrado, no começo: medindo, sem medida nenhuma. */
export function conta() {
  return { mostrado: 'medindo', ultimas: [], semNumero: 0 };
}

/**
 * A conta depois de mais uma medida classificada. A medida sem número não conta para piorar nem para melhorar; duas
 * seguidas voltam ao medindo. As outras: o estado piora quando as 2 últimas são piores que o mostrado, e passa para a
 * menos ruim das duas; senão, melhora quando as 5 últimas são melhores que o mostrado, e passa para a pior das cinco.
 */
export function passo(c, classe) {
  if (classe === 'semNumero') {
    const semNumero = c.semNumero + 1;
    if (semNumero >= SEM_NUMERO_PARA_MEDIR) return { mostrado: 'medindo', ultimas: [], semNumero };
    return { ...c, semNumero };
  }
  const ultimas = [...c.ultimas, classe].slice(-PARA_MELHORAR);
  const niveis = ultimas.map(nivel);
  const agora = nivel(c.mostrado);
  let mostrado = c.mostrado;
  const duas = niveis.slice(-PARA_PIORAR);
  if (duas.length === PARA_PIORAR && duas.every((n) => n > agora)) {
    mostrado = ORDEM[Math.min(...duas)];
  } else if (niveis.length === PARA_MELHORAR && niveis.every((n) => n < agora)) {
    mostrado = ORDEM[Math.max(...niveis)];
  }
  return { mostrado, ultimas, semNumero: 0 };
}

/**
 * O medidor. O ler() devolve a promessa do relatório da ligação principal (ou de null); o relogio é o da página
 * ({agora(), depois(ms, fn)}); o visivel() diz se a aba está à vista; o aoMedir({ estado, perda, atraso }) recebe o
 * estado mostrado e os números da última medida, a cada medida.
 *
 * Devolve { medir(ligado) }. Ligar começa do zero: uma conta nova, e a primeira leitura na hora (ela é só a base da
 * seguinte). Desligar para: nem a leitura que estava no ar vira medida. A leitura que falha não vira medida nem para o
 * medidor.
 *
 * A pausa: com a aba escondida, o medidor não lê; e a leitura que chega mais de 6 s depois da anterior (a página que o
 * aparelho parou de uma vez, sem a aba dizer que se escondeu) não mede o tempo parado. Nos dois casos a leitura
 * seguinte é de novo só a base, sem memória; o estado mostrado fica como estava, e as medidas de antes da pausa não
 * contam mais para piorar nem para melhorar.
 */
export function criarMedidor({ ler, relogio, visivel, aoMedir }) {
  let ligado = false;
  let vez = 0; // a roda de leituras de agora: o que sobra de uma roda anterior fica de fora
  let c = conta();
  let anterior = null; // a última leitura que deu certo, a base da próxima medida
  let pedida = 0; // o número da última leitura pedida, e o da última que entrou na conta
  let entrou = 0;

  function pausar() {
    anterior = null;
    c = { ...c, ultimas: [], semNumero: 0 };
  }

  function ciclo(daVez) {
    if (daVez !== vez) return;
    relogio.depois(INTERVALO_MS, () => ciclo(daVez));
    if (!visivel()) {
      pausar();
      return;
    }
    const esta = ++pedida;
    Promise.resolve()
      .then(ler)
      .then((relatorio) => {
        // A leitura de uma roda que acabou, ou a que chegou depois de uma mais nova, fica de fora.
        if (daVez !== vez || esta < entrou) return;
        let l = leitura(relatorio, anterior);
        if (l === null) return;
        entrou = esta;
        if (anterior !== null && numero(l.agora) && numero(anterior.agora) && l.agora - anterior.agora > PAUSA_MS) {
          pausar();
          l = leitura(relatorio);
        }
        const m = medida(anterior, l);
        anterior = l;
        if (m === null) return;
        c = passo(c, classificar(m));
        aoMedir({ estado: c.mostrado, perda: m.perda, atraso: m.atraso });
      })
      .catch(() => {}); // o ler que falha, ou a tela que lança: a próxima leitura segue
  }

  return {
    medir(ligar) {
      if (ligar === ligado) return;
      ligado = ligar;
      vez += 1;
      c = conta();
      anterior = null;
      if (ligado) ciclo(vez);
    },
  };
}

// ---- Os textos do sinalizador (a seção 4.4 do desenho): o que o botão e o cartão dizem em cada estado. ----

/** O aviso curto da conexão que virou ruim, que o leitor de tela também ouve. */
export const AVISO_DA_CONEXAO_RUIM = 'Sua conexão está ruim';

// As dicas do cartão são três, sempre na mesma ordem (elas estão na página): cada estado mostra as primeiras.
const TEXTOS = Object.freeze({
  boa: Object.freeze({
    botao: 'Conexão boa',
    nome: 'Conexão boa. Ver os detalhes',
    titulo: 'Sua conexão está boa',
    explicacao: 'A imagem e o som estão chegando bem.',
    dicas: 0,
  }),
  instavel: Object.freeze({
    botao: 'Conexão instável',
    nome: 'Conexão instável. Ver os detalhes',
    titulo: 'Sua conexão está instável',
    explicacao: 'A imagem ou o som podem falhar de vez em quando.',
    dicas: 2,
  }),
  ruim: Object.freeze({
    botao: 'Conexão ruim',
    nome: 'Conexão ruim. Ver os detalhes',
    titulo: 'Sua conexão está ruim',
    explicacao: 'Os outros podem não ver ou ouvir você direito, e a imagem deles pode travar para você.',
    dicas: 3,
  }),
  medindo: Object.freeze({
    botao: 'Medindo a conexão…',
    nome: 'Medindo a conexão',
    titulo: 'Medindo a conexão…',
    explicacao: 'Os números aparecem aqui em alguns segundos.',
    dicas: 0,
  }),
});

/**
 * Os textos de um estado mostrado: { botao, nome, titulo, explicacao, dicas }. O botao é o texto do botão; o nome, o
 * que o leitor de tela ouve nele; o titulo e a explicacao são do cartão; as dicas, quantas das três o cartão mostra.
 * Um estado que não existe mostra o medindo.
 */
export function textosDoSinal(estado) {
  return Object.hasOwn(TEXTOS, estado) ? TEXTOS[estado] : TEXTOS.medindo;
}

/**
 * Os números do pé do cartão, como "Perda: 4% · Atraso: 210 ms": a perda (uma fração) e o atraso (em ms) da última
 * medida, arredondados para o inteiro. O número que o navegador não dá aparece como "—". No medindo, o cartão não tem
 * números: null.
 */
export function numerosDoCartao({ estado, perda, atraso }) {
  if (estado === 'medindo') return null;
  const aPerda = numero(perda) ? `${Math.round(perda * 100)}%` : '—';
  const oAtraso = numero(atraso) ? `${Math.round(atraso)} ms` : '—';
  return `Perda: ${aPerda} · Atraso: ${oAtraso}`;
}
