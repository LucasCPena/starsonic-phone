// As contas e os textos do chat da reunião (docs/chat-protocolo.md, seção 10): funções puras, sem DOM, sem rede e sem
// relógio. O cérebro (estado.js) as usa para guardar as mensagens, e a tela (painel.js e pagina.js), para mostrá-las.
// O texto de uma pessoa nunca vira HTML: as partes daqui entram na página como nós de texto e como links criados um a
// um, e só um trecho que começa com http:// ou https:// vira link.

/** O tamanho de uma mensagem, em pontos de código (o servidor conta do mesmo jeito). */
export const MAX_TEXTO = 1000;
/** As mensagens que a página guarda: as últimas da reunião. */
export const MAX_MENSAGENS = 500;

// Os caracteres de controle que o servidor recusa numa mensagem (docs/chat-protocolo.md, seção 3): todos, menos a
// quebra de linha. O tab não está aqui: ele vira um espaço.
const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * O texto como o servidor o aceita, ou null se ficar vazio, passar de 1.000 pontos de código ou não for texto. As
 * quebras de linha de outros sistemas viram \n; o tab (de um texto colado de uma planilha) vira um espaço; os outros
 * caracteres de controle saem; e os espaços das pontas também. Assim, o servidor nunca recusa o que a página manda.
 */
export function textoLimpo(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROLES, '').trim();
  const n = [...t].length;
  return n >= 1 && n <= MAX_TEXTO ? t : null;
}

// Um endereço: o http:// ou o https:// e o que vem depois, até um espaço ou um sinal que não cabe num endereço
// escrito (o <, o > e as aspas).
const ENDERECO = /https?:\/\/[^\s<>"]+/gi;
// A pontuação que costuma vir colada no fim de um endereço, e que é da frase, não dele.
const PONTUACAO = new Set(['.', ',', ';', ':', '!', '?', "'", '’', '”', '»']);
// Os fechamentos: ficam no endereço só quando fecham um par aberto dentro dele (.../Brasil_(país)).
const PARES = { ')': '(', ']': '[', '}': '{' };

const vezes = (texto, letra) => texto.split(letra).length - 1;

// O endereço sem a pontuação do fim.
function semOFim(endereco) {
  let e = endereco;
  while (e.length > 0) {
    const ultima = e[e.length - 1];
    const abre = PARES[ultima];
    const sobra = abre !== undefined && vezes(e, ultima) > vezes(e, abre);
    if (!PONTUACAO.has(ultima) && !sobra) break;
    e = e.slice(0, -1);
  }
  return e;
}

// Só vira link o que o navegador entende como um endereço http ou https, com o nome de um servidor.
function vale(endereco) {
  let u;
  try {
    u = new URL(endereco);
  } catch {
    return false;
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
}

/**
 * O texto em partes, na ordem: {texto} ou {link}. O link é o endereço como foi escrito, inteiro: é ele que aparece e
 * é para ele que o link leva. Juntas, as partes dão o texto de volta, letra por letra.
 */
export function partes(texto) {
  const lista = [];
  let de = 0;
  for (const achado of texto.matchAll(ENDERECO)) {
    const link = semOFim(achado[0]);
    if (!vale(link)) continue;
    if (achado.index > de) lista.push({ texto: texto.slice(de, achado.index) });
    lista.push({ link });
    de = achado.index + link.length;
  }
  if (de < texto.length) lista.push({ texto: texto.slice(de) });
  return lista;
}

const dois = (n) => String(n).padStart(2, '0');

/** "14:02", na hora local de quem lê. */
export function hora(ms) {
  const d = new Date(ms);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** O número do botão Chat: "" sem mensagem nova, "1" a "9", ou "9+". */
export function contagem(n) {
  if (!(n > 0)) return '';
  return n > 9 ? '9+' : String(n);
}

/** O nome do botão Chat para o leitor de tela, com o número de verdade. */
export function nomeDoBotao(n) {
  if (!(n > 0)) return 'Chat';
  return n === 1 ? 'Chat, 1 mensagem nova' : `Chat, ${n} mensagens novas`;
}

/** Quem escreveu, como o cabeçalho da mensagem diz: "Você", o nome, ou "Participante" sem ele. */
export function quem(m) {
  if (m.voce) return 'Você';
  return m.nome || 'Participante';
}

/** O texto numa linha só: as quebras de linha e os espaços seguidos viram um espaço. */
export function numaLinha(texto) {
  return texto.replace(/\s+/g, ' ').trim();
}

/** A primeira linha do aviso curto de uma mensagem de outra pessoa: "<nome> escreveu". */
export function escreveu(m) {
  return `${m.nome || 'Participante'} escreveu`;
}

/** O que o leitor de tela ouve de uma mensagem de outra pessoa: "<nome> escreveu: <o texto, numa linha>". */
export function dito(m) {
  return `${escreveu(m)}: ${numaLinha(m.texto)}`;
}

/** O texto da mensagem que não foi, pelo motivo (seção 10 da spec: só o limite tem o motivo escrito). */
export function falha(motivo) {
  return motivo === 'limite' ? 'Não enviada: muitas mensagens seguidas. Espere um pouco.' : 'Não enviada';
}
