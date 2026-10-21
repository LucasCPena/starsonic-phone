// Como a interface escreve o que vem no estado (só apresentação: as regras ficam no C++).
import type { CurrentAccount, RecentKind, SavedAccount } from './state';

/** "Recepção · 2001"; sem nome, só o ramal. */
export function accountTitle(conta: Pick<CurrentAccount | SavedAccount, 'nome' | 'ramal'>): string {
  return conta.nome ? `${conta.nome} · ${conta.ramal}` : conta.ramal;
}

/** A linha do estado no cabeçalho (o `texto` do C++; vazio com sem_conexao). */
export function accountStatusLine(conta: CurrentAccount): string {
  if (conta.texto) return conta.texto;
  switch (conta.status) {
    case 'conectado':
      return `Conectado · ${conta.servidor}`;
    case 'conectando':
      return 'Conectando…';
    default:
      return 'Sem conexão';
  }
}

/** Minúsculas, sem acento: para a busca e os grupos. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

/** As iniciais do avatar: a primeira e a última palavra ("Ana Souza" → "AS"; "Financeiro" → "FI"). */
export function initials(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '?';
  if (palavras.length === 1) return palavras[0].slice(0, 2).toLocaleUpperCase('pt-BR');
  return (palavras[0][0] + palavras[palavras.length - 1][0]).toLocaleUpperCase('pt-BR');
}

/** A letra do grupo dos contatos ("Ágata" → "A"; número ou símbolo → "#"). */
export function groupLetter(nome: string): string {
  const letra = fold(nome.trim()).charAt(0).toUpperCase();
  return /[A-Z]/.test(letra) ? letra : '#';
}

/** "Ramal 2003" para um número curto (um ramal), senão o número como foi gravado. */
export function contactNumberLine(numero: string): string {
  return /^\d{2,6}$/.test(numero.trim()) ? `Ramal ${numero.trim()}` : numero;
}

const TIPO: Record<RecentKind, string> = { feita: 'Feita', recebida: 'Recebida', perdida: 'Perdida' };

export function recentKindLabel(tipo: RecentKind): string {
  return TIPO[tipo];
}

/** "14:32". */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "4 min 18 s", "1 min 02 s", "35 s", "1 h 05 min". A duração vem em milissegundos. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(min).padStart(2, '0')} min`;
  if (min > 0) return `${min} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** O grupo do dia: "Hoje", "Ontem" ou a data ("19 de outubro"; com o ano, se for de outro ano). */
export function dayGroup(ms: number, now: number = Date.now()): string {
  const hoje = startOfDay(now);
  const dia = startOfDay(ms);
  const dias = Math.round((hoje - dia) / 86_400_000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  const d = new Date(ms);
  const opcoes: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date(now).getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('pt-BR', opcoes).format(d);
}

/** "Depois de 3 segundos tocando". */
export function autoAnswerLine(segundos: number): string {
  if (segundos <= 0) return 'Assim que tocar';
  return segundos === 1 ? 'Depois de 1 segundo tocando' : `Depois de ${segundos} segundos tocando`;
}
