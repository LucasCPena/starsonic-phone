// Como o chat escreve uma conversa: na lista, o nome, a prévia da última mensagem e a hora dela (a lista "Os textos
// novos" do plano da etapa 2); (Task 6) no aviso do Windows, o título e o texto; e o número da aba. Só apresentação, na
// hora local.
import { clockTime, fold, limitCharacters } from '../format';
import { arquivoNoAviso, FOTO, nomeDaPessoa, textoDoAvisoDeGrupo, VOCE } from './textos';
import type { Conversa, Mensagem } from './tipos';

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

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome;
}

/**
 * A prévia da última mensagem: "Você: <texto>" para a minha; num grupo, "<primeiro nome>: <texto>" para a dos outros.
 * Uma foto é "Foto", um arquivo é o nome dele, e um aviso de grupo é o texto do aviso.
 */
export function previa(c: Conversa, euId: number): string {
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
 * 120 primeiros pontos de código, com "…" quando corta; uma foto é "Foto", e um arquivo, "Arquivo: <nome>".
 */
export function textoDoAviso(m: Mensagem): string {
  if (m.tipo === 'arquivo') return m.arquivo?.foto ? FOTO : arquivoNoAviso(m.arquivo?.nome ?? '');
  const texto = m.texto ?? '';
  const comeco = limitCharacters(texto, COMECO_NO_AVISO);
  return comeco === texto ? texto : `${comeco}…`;
}

/** O número da aba Chat (como o do ícone da barra de tarefas): de 1 a 9, e "9+" acima disso. */
export function numeroDaAba(naoLidas: number): string {
  return naoLidas > 9 ? '9+' : String(naoLidas);
}
