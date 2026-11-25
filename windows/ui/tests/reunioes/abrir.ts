// Os ajudantes dos testes das reuniões: abrir o app na aba Reuniões e as horas no relógio da página.
import { expect, type Page } from '@playwright/test';
import { abrirNoChat } from '../chat/abrir';
import type { ApiDeTeste } from '../chat/servidor';

/** Abre o app no chat de verdade e vai para a aba Reuniões (que só aparece depois da primeira leitura). */
export async function abrirNasReunioes(page: Page, o: Parameters<typeof abrirNoChat>[1]): Promise<void> {
  await abrirNoChat(page, o);
  const aba = page.locator('nav.nav button.tab-reunioes');
  await expect(aba).toBeVisible();
  await aba.click();
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
}

/** O fuso da página (playwright.config.ts) é sempre −03:00. */
const HORAS_DO_FUSO = 3;

/** O dia de hoje no relógio da página: ano, mês (1 a 12) e dia. */
function hojeNaPagina(): { ano: number; mes: number; dia: number } {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = formato.formatToParts(Date.now());
  const de = (tipo: string) => Number(p.find((x) => x.type === tipo)!.value);
  return { ano: de('year'), mes: de('month'), dia: de('day') };
}

/**
 * Uma hora no relógio da página: o playwright.config.ts fixa o fuso dela em America/Sao_Paulo (sempre −03:00), e o
 * Node dos testes pode estar em outro. `dias`: 0 é hoje naquele fuso, 1 é amanhã.
 */
export function noRelogioDaPagina(dias: number, hora: number, minuto: number): number {
  const { ano, mes, dia } = hojeNaPagina();
  return Date.UTC(ano, mes - 1, dia + dias, hora + HORAS_DO_FUSO, minuto);
}

/** O meio-dia de hoje no relógio da página: os testes da lista fixam a hora da página nele. */
export function meioDiaDeHoje(): number {
  return noRelogioDaPagina(0, 12, 0);
}

/** O ano de uma hora no relógio da página. */
export function anoNaPagina(ms: number): number {
  return new Date(ms - HORAS_DO_FUSO * 3_600_000).getUTCFullYear();
}

/** O dia de uma hora no relógio da página, como a lista o escreve: "Dom, 29/11" (com o ano, se não é o de hoje). */
export function diaDaLista(ms: number): string {
  const d = new Date(ms - HORAS_DO_FUSO * 3_600_000);
  const dois = (n: number) => String(n).padStart(2, '0');
  const semana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getUTCDay()];
  const ano = d.getUTCFullYear() === hojeNaPagina().ano ? '' : `/${d.getUTCFullYear()}`;
  return `${semana}, ${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}${ano}`;
}

const DIA = 86_400_000;

/** Marca uma reunião como a pessoa da `api`: o início dado e o link valendo 2 dias depois. Devolve a criada. */
export async function marcar(
  api: ApiDeTeste,
  inicio: number,
  assunto?: string,
): Promise<{ codigo: string; link: string }> {
  const corpo = { ...(assunto === undefined ? {} : { assunto }), inicio, valeAte: inicio + 2 * DIA };
  const r = await api.pedir('POST', '/api/v1/reunioes', corpo);
  if (r.status !== 201) throw new Error(`marcar a reunião respondeu ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json.reuniao;
}
