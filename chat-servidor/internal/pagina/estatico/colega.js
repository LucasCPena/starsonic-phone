// As contas e os textos da página do colega: o passe do endereço, o Windows (a tela "o app ou o navegador"), a lista da
// reunião (quem está nela e quem espera para entrar), o nome do botão Participantes, o título do cartão do pedido, as
// frases do Encerrar para todos e o que o leitor de tela ouve. Tudo puro, sem DOM, sem rede e sem relógio: o agora e o
// navegador vêm de quem chama. Os textos são os da seção "Os textos" do plano da etapa 2a. Os nomes da lista e o passe
// nunca vão ao console.

// O passe que o app põe no fim do endereço: 43 caracteres base64url (32 bytes), sozinho depois do #p=.
const PASSE_NO_ENDERECO = /^#p=([A-Za-z0-9_-]{43})$/;

/** O passe do fim do endereço (o location.hash, "#p=<passe>"), ou null para qualquer outra coisa. */
export function passeDoEndereco(hash) {
  const m = typeof hash === 'string' ? PASSE_NO_ENDERECO.exec(hash) : null;
  return m ? m[1] : null;
}

/**
 * O navegador está no Windows: o navigator, com o userAgent e o userAgentData. O platform do userAgentData decide onde
 * o navegador o tem (o Chromium); sem ele (o Firefox, o Safari), o agente diz o Windows NT.
 */
export function ehWindows(navegador) {
  const plataforma = navegador?.userAgentData?.platform;
  if (typeof plataforma === 'string' && plataforma !== '') return plataforma === 'Windows';
  return /Windows NT/.test(String(navegador?.userAgent ?? ''));
}

/** A lista sem ninguém: a do começo, e a de fora da reunião. */
export const LISTA_VAZIA = Object.freeze({ participantes: Object.freeze([]), pedidos: Object.freeze([]) });

const texto = (v) => typeof v === 'string';
const comId = (x) => x !== null && typeof x === 'object' && texto(x.id) && x.id !== '' && texto(x.nome);

/**
 * A mensagem participantes do canal → a lista, com só os campos conhecidos: {participantes: [{id, nome, deFora, tela,
 * voce}], pedidos: [{id, nome}]}. Sem as duas listas, null. O item sem id, ou com o nome que não é texto, sai. O número
 * de pessoas não é conferido: quem limita é o servidor.
 */
export function lerLista(m) {
  if (!Array.isArray(m?.participantes) || !Array.isArray(m?.pedidos)) return null;
  return {
    participantes: m.participantes.filter(comId).map((p) => ({
      id: p.id,
      nome: p.nome,
      deFora: p.deFora === true,
      tela: p.tela === true,
      voce: p.voce === true,
    })),
    pedidos: m.pedidos.filter(comId).map((p) => ({ id: p.id, nome: p.nome })),
  };
}

/** As iniciais do círculo da entrada: a primeira letra do primeiro nome e a do último ("Júlia Martins" → "JM"). */
export function iniciais(nome) {
  const partes = String(nome ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return '?';
  const letra = (p) => [...p][0].toUpperCase();
  return partes.length === 1 ? letra(partes[0]) : letra(partes[0]) + letra(partes[partes.length - 1]);
}

/** O nome do botão Participantes para o leitor de tela: com pedidos, quantas pessoas querem entrar. */
export function rotuloDoBotao(pedidos) {
  const n = pedidos.length;
  if (n === 0) return 'Participantes';
  return n === 1 ? 'Participantes, 1 pessoa quer entrar' : `Participantes, ${n} pessoas querem entrar`;
}

/** O título do cartão do pedido: o nome do primeiro da lista e, com mais pedidos, o número dos outros. */
export function tituloDoCartao(pedidos) {
  const n = pedidos.length;
  if (n === 0) return '';
  return n === 1 ? `${pedidos[0].nome} quer entrar` : `${pedidos[0].nome} e mais ${n - 1} querem entrar`;
}

const dois = (n) => String(n).padStart(2, '0');
const mesmoDia = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// "hoje, 23:59", "amanhã, 23:59" ou "26/11, 23:59", na hora local.
function ateQuando(ms, agoraMs) {
  const d = new Date(ms);
  const agora = new Date(agoraMs);
  const hora = `${dois(d.getHours())}:${dois(d.getMinutes())}`;
  if (mesmoDia(d, agora)) return `hoje, ${hora}`;
  if (mesmoDia(d, new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1))) return `amanhã, ${hora}`;
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}, ${hora}`;
}

/**
 * As duas frases do Encerrar para todos: quem sai (n é o número de pessoas na reunião) e o que acontece com o link. Só
 * a reunião marcada, com o valeAte (em ms) ainda por vir, recomeça se um colega entrar de novo.
 */
export function fraseDoEncerrar(n, tipo, valeAte, agora) {
  const primeira = n === 1 ? 'Você sai agora.' : `As ${n} pessoas saem agora.`;
  const vale = tipo === 'marcada' && typeof valeAte === 'number' && Number.isFinite(valeAte) && valeAte > agora;
  const segunda = vale
    ? `O link continua valendo até ${ateQuando(valeAte, agora)}: a reunião recomeça se um colega entrar de novo.`
    : 'Depois disso, o link não vale mais.';
  return [primeira, segunda];
}

/** O que o leitor de tela ouve quando uma resposta da página deu certo: de é aceitar, recusar ou tirar. */
export function ditoDaResposta(de, nome) {
  switch (de) {
    case 'aceitar':
      return `O pedido de ${nome} foi aceito`;
    case 'recusar':
      return `O pedido de ${nome} foi recusado`;
    default: // tirar
      return `${nome} saiu da reunião`;
  }
}
