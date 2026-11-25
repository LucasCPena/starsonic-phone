// As contas puras das reuniões: o dia e a hora na lista, a validade do link, o código de um texto colado e a
// conferência da Nova reunião. Tudo no relógio do PC; `agora` e as horas são milissegundos desde 1970. Os dias se
// comparam pelo calendário (ano, mês e dia), nunca por 24 horas: onde há horário de verão, um dia tem 23 ou 25 horas.
import { SEM_ASSUNTO } from './textos';
import type { Reuniao } from './tipos';

const DIAS_ABREVIADOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DIAS_POR_EXTENSO = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const CODIGO = /^[abcdefghjkmnpqrstvwxyz23456789]{10}$/;
const DIAS_DE_VALIDADE = 31;

const dois = (n: number) => String(n).padStart(2, '0');
const hora = (d: Date) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
const diaMes = (d: Date) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;

/** Quantos dias de calendário `ms` está depois de `agora` (negativo: antes). */
function diasDeDiferenca(ms: number, agora: number): number {
  const a = new Date(ms);
  const b = new Date(agora);
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
    Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86_400_000);
}

const mesmoAno = (ms: number, agora: number) => new Date(ms).getFullYear() === new Date(agora).getFullYear();

/** "Hoje, 14:00", "Amanhã, 09:30", "Ontem, 14:00", "Qui, 26/11, 16:00"; em outro ano, "Sex, 26/11/2027, 16:00". */
export function quando(inicio: number, agora: number): string {
  const d = new Date(inicio);
  const dias = diasDeDiferenca(inicio, agora);
  if (dias === 0) return `Hoje, ${hora(d)}`;
  if (dias === 1) return `Amanhã, ${hora(d)}`;
  if (dias === -1) return `Ontem, ${hora(d)}`;
  const data = mesmoAno(inicio, agora) ? diaMes(d) : `${diaMes(d)}/${d.getFullYear()}`;
  return `${DIAS_ABREVIADOS[d.getDay()]}, ${data}, ${hora(d)}`;
}

/** O mesmo, para o leitor de tela: "hoje às 14:00", "quinta-feira, 26 de novembro, às 16:00". */
export function quandoPorExtenso(inicio: number, agora: number): string {
  const d = new Date(inicio);
  const dias = diasDeDiferenca(inicio, agora);
  if (dias === 0) return `hoje às ${hora(d)}`;
  if (dias === 1) return `amanhã às ${hora(d)}`;
  if (dias === -1) return `ontem às ${hora(d)}`;
  const ano = mesmoAno(inicio, agora) ? '' : ` de ${d.getFullYear()}`;
  return `${DIAS_POR_EXTENSO[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}${ano}, às ${hora(d)}`;
}

const pessoasEscrito = (n: number) => (n === 1 ? '1 pessoa' : `${n} pessoas`);

/** "Acontecendo · 1 pessoa", "Acontecendo · 3 pessoas"; "" quando ninguém está nela. */
export function acontecendo(r: Pick<Reuniao, 'acontecendo' | 'pessoas'>): string {
  return r.acontecendo && r.pessoas > 0 ? `Acontecendo · ${pessoasEscrito(r.pessoas)}` : '';
}

/** O nome da linha para o leitor de tela: "Planejamento de dezembro, hoje às 14:00, ..., com 3 pessoas". */
export function descricaoDaLinha(r: Reuniao, agora: number): string {
  const partes = [r.assunto || SEM_ASSUNTO];
  if (r.inicio !== null) partes.push(quandoPorExtenso(r.inicio, agora));
  if (r.acontecendo && r.pessoas > 0) partes.push(`acontecendo agora com ${pessoasEscrito(r.pessoas)}`);
  return partes.join(', ');
}

/** O dia da validade: "hoje", "amanhã" ou "26/11" (com o ano, em outro ano). */
function diaDaValidade(valeAte: number, agora: number): string {
  const dias = diasDeDiferenca(valeAte, agora);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  const d = new Date(valeAte);
  return mesmoAno(valeAte, agora) ? diaMes(d) : `${diaMes(d)}/${d.getFullYear()}`;
}

/** "O link vale até hoje, 23:59", "O link vale até amanhã, 23:59", "O link vale até 26/11, 23:59". */
export function valeAteTexto(valeAte: number, agora: number): string {
  return `O link vale até ${diaDaValidade(valeAte, agora)}, ${hora(new Date(valeAte))}`;
}

/** "Hoje, às 23:59", "Amanhã, às 23:59", "26/11, às 23:59": o começo da frase da validade na Nova reunião. */
export function ateQuando(valeAte: number, agora: number): string {
  const dia = diaDaValidade(valeAte, agora);
  const maiuscula = dia === 'hoje' || dia === 'amanhã' ? dia[0].toUpperCase() + dia.slice(1) : dia;
  return `${maiuscula}, às ${hora(new Date(valeAte))}`;
}

/** O código de um texto colado: o link inteiro deste servidor ou só o código; null fora disso. */
export function codigoDoTexto(texto: string, base: string): string | null {
  let t = texto.trim();
  const prefixo = `${base.replace(/\/+$/, '')}/r/`;
  if (t.toLowerCase().startsWith(prefixo.toLowerCase())) {
    t = t.slice(prefixo.length);
    const fim = t.search(/[/?#]/);
    if (fim >= 0) t = t.slice(0, fim);
  }
  t = t.toLowerCase().replace(/\s+/g, '');
  return CODIGO.test(t) ? t : null;
}

/** 23:59:59,999 do dia de `inicio`. */
export function fimDoDia(inicio: number): number {
  const d = new Date(inicio);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

/** O dia e a hora com que a Nova reunião abre: a próxima meia hora cheia depois de `agora`. */
export function inicioPadrao(agora: number): { dia: string; hora: string } {
  const d = new Date(agora);
  const minutos = d.getMinutes() < 30 ? 30 : 60;
  const p = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), minutos, 0, 0);
  return { dia: `${p.getFullYear()}-${dois(p.getMonth() + 1)}-${dois(p.getDate())}`, hora: hora(p) };
}

export interface NovaReuniao {
  assunto: string;
  dia: string;
  hora: string;
  validade: 'fimDoDia' | 'outra';
  ateDia: string;
  ateHora: string;
}

/** O instante de um dia "aaaa-mm-dd" e uma hora "hh:mm" no relógio do PC; NaN se algum não for um valor válido. */
function instante(dia: string, horario: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  const h = /^(\d{2}):(\d{2})$/.exec(horario);
  if (!d || !h) return NaN;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2])).getTime();
}

/** O corpo do POST, ou o erro do formulário (o texto pronto e o campo). */
export function conferirNova(
  f: NovaReuniao,
  agora: number,
): { corpo: { assunto?: string; inicio: number; valeAte: number } } | { erro: string; campo: 'dia' | 'ate' } {
  const inicio = instante(f.dia, f.hora);
  if (Number.isNaN(inicio) || diasDeDiferenca(inicio, agora) < 0) {
    return { erro: 'O dia da reunião já passou.', campo: 'dia' };
  }
  let valeAte = fimDoDia(inicio);
  if (f.validade === 'outra') {
    valeAte = instante(f.ateDia, f.ateHora);
    // O limite é de 31 dias de calendário depois do início, à mesma hora.
    const i = new Date(inicio);
    const limite = new Date(
      i.getFullYear(),
      i.getMonth(),
      i.getDate() + DIAS_DE_VALIDADE,
      i.getHours(),
      i.getMinutes(),
    );
    if (Number.isNaN(valeAte) || valeAte <= inicio || valeAte < agora || valeAte > limite.getTime()) {
      return { erro: 'O link pode valer até 31 dias depois da reunião.', campo: 'ate' };
    }
  }
  // O servidor recusa um assunto com caracteres de controle (um Tab colado): cada um vira um espaço.
  // eslint-disable-next-line no-control-regex
  const assunto = f.assunto.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return { corpo: assunto ? { assunto, inicio, valeAte } : { inicio, valeAte } };
}

/** "O link para de valer na hora." e, acontecendo, o que acontece com quem está nela. */
export function textoDoCancelar(r: Pick<Reuniao, 'acontecendo' | 'pessoas'>): string {
  const base = 'O link para de valer na hora.';
  if (!r.acontecendo || r.pessoas <= 0) return base;
  return r.pessoas === 1
    ? `${base} Como a reunião está acontecendo, a pessoa que está nela sai.`
    : `${base} Como a reunião está acontecendo, as ${r.pessoas} pessoas saem.`;
}
