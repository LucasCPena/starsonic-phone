// Como o chat escreve uma conversa: na lista, o nome, a prévia da última mensagem e a hora dela (a lista "Os textos
// novos" do plano da etapa 2); (Task 6) no aviso do Windows, o título e o texto; e o número da aba. (Task 5) A busca dos
// colegas. (Task 7) O tamanho e o tipo de um arquivo, o que é uma foto, e os nomes sem as marcas de direção (Review
// Focus 5: a prévia e o aviso também). Só apresentação, na hora local.
import { clockTime, fold, limitCharacters } from '../format';
import {
  APRESENTACAO,
  ARQUIVO,
  ARQUIVO_COMPACTADO,
  arquivoNoAviso,
  AUDIO,
  DOCUMENTO,
  FOTO,
  nomeDaPessoa,
  PDF,
  PLANILHA,
  textoDoAvisoDeGrupo,
  VIDEO,
  VOCE,
} from './textos';
import type { Arquivo, Conversa, Mensagem, Pessoa } from './tipos';

/** O texto do aviso do Windows leva os primeiros 120 caracteres da mensagem. */
const COMECO_NO_AVISO = 120;

const DIAS_DA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function inicioDoDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/**
 * A hora da lista: "09:41" para hoje, "Ontem", o dia da semana dos últimos 6 dias ("Seg"), depois "dd/mm", e
 * "dd/mm/aaaa" para outro ano. Uma hora no futuro (o relógio do servidor adiantado) é a de hoje.
 */
export function horaDaLista(ms: number, agora: number = Date.now()): string {
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(ms)) / 86_400_000);
  const d = new Date(ms);
  if (dias <= 0) return clockTime(ms);
  if (dias === 1) return 'Ontem';
  if (dias <= 6) return DIAS_DA_SEMANA[d.getDay()];
  const diaMes = `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}`;
  return d.getFullYear() === new Date(agora).getFullYear() ? diaMes : `${diaMes}/${d.getFullYear()}`;
}

/** O nome da conversa: o do grupo, ou o da outra pessoa da dupla (com " (saiu)" se ela saiu do chat). */
export function nomeDaConversa(c: Conversa): string {
  return c.tipo === 'grupo' ? c.nome : nomeDaPessoa(c.com);
}

/** O nome da conversa para a busca: sem acento e sem caixa (e sem o " (saiu)"). */
export function nomeParaBusca(c: Conversa): string {
  return fold(c.tipo === 'grupo' ? c.nome : c.com.nome);
}

/**
 * (Task 5) A busca dos colegas (a Nova conversa, o Novo grupo e o Pôr pessoas): o nome sem acento e sem caixa, ou o
 * ramal, como foi digitado; os espaços das pontas não contam. Sem nada digitado, todos.
 */
export function pessoasDaBusca(pessoas: Pessoa[], busca: string): Pessoa[] {
  const texto = busca.trim();
  if (!texto) return pessoas;
  const termo = fold(texto);
  return pessoas.filter((p) => fold(p.nome).includes(termo) || p.ramal.includes(texto));
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome;
}

/**
 * A prévia da última mensagem: "Você: <texto>" para a minha; num grupo, "<primeiro nome>: <texto>" para a dos outros.
 * Uma foto é "Foto", um arquivo é o nome dele, e um aviso de grupo é o texto do aviso. (Task 7) A linha toda vai sem as
 * marcas de direção: um nome de arquivo não troca o fim dela.
 */
export function previa(c: Conversa, euId: number): string {
  return semDirecao(previaComMarcas(c, euId));
}

function previaComMarcas(c: Conversa, euId: number): string {
  const m: Mensagem | null = c.ultima;
  if (!m) return '';
  if (m.tipo === 'aviso') return m.aviso ? textoDoAvisoDeGrupo(m.aviso, euId) : '';
  const conteudo = m.tipo === 'arquivo' ? (m.arquivo?.foto ? FOTO : (m.arquivo?.nome ?? '')) : (m.texto ?? '');
  if (m.autor?.id === euId) return `${VOCE}: ${conteudo}`;
  if (c.tipo === 'grupo' && m.autor) return `${primeiroNome(m.autor.nome)}: ${conteudo}`;
  return conteudo;
}

/** O título do aviso do Windows: o nome de quem mandou; num grupo, "<nome> no <grupo>" ("João Pereira no Comercial"). */
export function tituloDoAviso(c: Conversa, m: Mensagem): string {
  const autor = m.autor?.nome ?? (c.tipo === 'dupla' ? c.com.nome : '');
  return c.tipo === 'grupo' ? `${autor} no ${c.nome}` : autor;
}

/**
 * O texto do aviso do Windows (o de um aviso de grupo é o textoDoAvisoDeGrupo, no textos.ts): o começo do texto, os
 * 120 primeiros pontos de código, com "…" quando corta; uma foto é "Foto", e um arquivo, "Arquivo: <nome>", com o nome
 * sem as marcas de direção (o FitNoticeText do núcleo não as tira).
 */
export function textoDoAviso(m: Mensagem): string {
  if (m.tipo === 'arquivo') return m.arquivo?.foto ? FOTO : arquivoNoAviso(semDirecao(m.arquivo?.nome ?? ''));
  const texto = m.texto ?? '';
  const comeco = limitCharacters(texto, COMECO_NO_AVISO);
  return comeco === texto ? texto : `${comeco}…`;
}

/** O número da aba Chat (como o do ícone da barra de tarefas): de 1 a 9, e "9+" acima disso. */
export function numeroDaAba(naoLidas: number): string {
  return naoLidas > 9 ? '9+' : String(naoLidas);
}

/**
 * (Task 7) Os caracteres que trocam a direção do texto, os controles de direção do Unicode (Bidi_Control): U+061C,
 * U+200E, U+200F, U+202A a U+202E e U+2066 a U+2069 (os mesmos que o SafeDownloadName tira do nome salvo, R35).
 */
const MARCAS_DE_DIRECAO = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * (Task 7) O texto sem os caracteres que trocam a direção (Review Focus 5): o "Proposta<U+202E>fdp.exe" aparece como
 * "Propostafdp.exe", com a extensão de verdade à vista, e não como "Propostaexe.pdf". Vale para todo nome de arquivo
 * na tela, nos nomes de leitor de tela e no nome com que o núcleo o grava (R34).
 */
export function semDirecao(texto: string): string {
  return texto.replace(MARCAS_DE_DIRECAO, '');
}

const KB = 1024;
const MB = 1024 * KB;

/** (Task 7) O tamanho de um arquivo, na base 1.024: "512 bytes", "48 KB" ou "1,2 MB" (o que daria 1.024 KB já é MB). */
export function tamanhoDoArquivo(bytes: number): string {
  if (bytes < KB) return `${bytes} bytes`;
  const kb = Math.round(bytes / KB);
  if (kb < KB) return `${kb} KB`;
  return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
}

/** (Task 7) As fotos do protocolo (docs/chat-protocolo.md, seção 3): o jpg, o png, o gif e o webp. */
const TIPOS_DE_FOTO = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** O tipo MIME sem os parâmetros e sem caixa ("image/PNG; x=1" é "image/png"), como o servidor o lê. */
const tipoSemParametros = (tipo: string) => tipo.split(';')[0].trim().toLowerCase();

/**
 * (Task 7) O tipo do envio é o de uma foto: a mesma regra com que o servidor decide o `foto` do arquivo pelo
 * Content-Type do upload, para o app e o servidor concordarem.
 */
export function ehFoto(tipo: string): boolean {
  return TIPOS_DE_FOTO.has(tipoSemParametros(tipo));
}

const POR_EXTENSAO = new Map<string, string>([
  ['pdf', PDF],
  ...['xls', 'xlsx', 'xlsm', 'ods', 'csv'].map((e): [string, string] => [e, PLANILHA]),
  ...['doc', 'docx', 'odt', 'rtf', 'txt'].map((e): [string, string] => [e, DOCUMENTO]),
  ...['ppt', 'pptx', 'pps', 'ppsx', 'odp'].map((e): [string, string] => [e, APRESENTACAO]),
  ...['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'wma'].map((e): [string, string] => [e, AUDIO]),
  ...['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'wmv'].map((e): [string, string] => [e, VIDEO]),
  ...['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].map((e): [string, string] => [e, ARQUIVO_COMPACTADO]),
]);

const POR_TIPO = new Map<string, string>([
  ['application/pdf', PDF],
  ['application/vnd.ms-excel', PLANILHA],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', PLANILHA],
  ['application/vnd.oasis.opendocument.spreadsheet', PLANILHA],
  ['text/csv', PLANILHA],
  ['application/msword', DOCUMENTO],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', DOCUMENTO],
  ['application/vnd.oasis.opendocument.text', DOCUMENTO],
  ['application/rtf', DOCUMENTO],
  ['text/plain', DOCUMENTO],
  ['application/vnd.ms-powerpoint', APRESENTACAO],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', APRESENTACAO],
  ['application/vnd.oasis.opendocument.presentation', APRESENTACAO],
  ['application/zip', ARQUIVO_COMPACTADO],
  ['application/x-zip-compressed', ARQUIVO_COMPACTADO],
  ['application/vnd.rar', ARQUIVO_COMPACTADO],
  ['application/x-7z-compressed', ARQUIVO_COMPACTADO],
  ['application/gzip', ARQUIVO_COMPACTADO],
]);

/** A extensão do nome (a do último ponto, sem caixa); null sem uma (o ponto do começo de ".bashrc" não conta). */
function extensao(nome: string): string | null {
  const i = nome.lastIndexOf('.');
  return i > 0 && i < nome.length - 1 ? nome.slice(i + 1).toLowerCase() : null;
}

/**
 * (Task 7) O tipo de um arquivo, na linha de baixo do balão ("1,2 MB · PDF"): a foto é "Foto"; o resto vai pela
 * extensão do nome (a que o Windows usa para abrir o arquivo) e, num nome sem extensão, pelo tipo do envio. Uma
 * extensão de fora da lista é "Arquivo", seja qual for o tipo do envio: um ".exe" mandado como PDF nunca aparece "PDF".
 */
export function tipoDoArquivo(a: Pick<Arquivo, 'nome' | 'tipo' | 'foto'>): string {
  if (a.foto) return FOTO;
  const ext = extensao(semDirecao(a.nome));
  if (ext !== null) return POR_EXTENSAO.get(ext) ?? ARQUIVO;
  const tipo = tipoSemParametros(a.tipo);
  if (tipo.startsWith('audio/')) return AUDIO;
  if (tipo.startsWith('video/')) return VIDEO;
  return POR_TIPO.get(tipo) ?? ARQUIVO;
}
