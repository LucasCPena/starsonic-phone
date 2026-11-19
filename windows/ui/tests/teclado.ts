// O teclado das fotos (o Tab dá a volta e nenhum foco some), que as fotos do chat e as do vídeo usam: saiu do
// tests/chat/fotos.spec.ts sem mudar.
import { expect, type Page } from '@playwright/test';

/** Uma parada do Tab: quem tem o foco (um número por elemento), se é um dos controles da tela, e o que o esconde. */
interface Parada {
  id: number;
  corpo: boolean;
  indice: number;
  problema: string | null;
  descricao: string;
}

/**
 * Guarda na página os controles da tela, os que o Tab precisa alcançar: os botões, os campos e o que tem tabindex 0,
 * ligados, desenhados e fora de uma parte inerte (com um diálogo modal aberto, só os dele). Um grupo de opções (os
 * radio de um mesmo nome) é uma parada só, a marcada: as setas andam dentro dele. Devolve como cada um se chama, para as
 * mensagens.
 */
export async function marcarOsControles(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const descrever = (el: Element | null): string => {
      if (!el) return 'nada';
      const rotulo = (el as HTMLInputElement).labels?.[0]?.textContent;
      const nome = el.getAttribute('aria-label') || el.getAttribute('placeholder') || rotulo || el.textContent || '';
      const classe = typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '';
      return `${el.tagName.toLowerCase()}${classe} "${nome.trim().replace(/\s+/g, ' ').slice(0, 60)}"`;
    };
    // O que esconde o elemento com o foco: sem tamanho, fora da janela ou coberto por outro (o meio dele, na parte que
    // aparece, tem de ser ele, algo dentro dele ou o rótulo dele).
    const problema = (el: HTMLElement): string | null => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return 'sem tamanho';
      if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return 'fora da janela';
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const alvo = document.elementFromPoint(x, y);
      const dono = el.closest('label') ?? el;
      if (!alvo || !(el.contains(alvo) || dono.contains(alvo))) return `coberto por ${descrever(alvo)}`;
      return null;
    };
    const modal = document.querySelector('dialog:modal');
    const seletor = 'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex^="-"])';
    const parada = (el: HTMLElement): boolean => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
      const grupo = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((r) => r.name === el.name && r.form === el.form);
      return el.checked || (!grupo.some((r) => r.checked) && grupo[0] === el);
    };
    const controles = [...document.querySelectorAll<HTMLElement>(seletor)].filter(
      (el) =>
        !(el as HTMLButtonElement).disabled &&
        el.closest('[inert]') === null &&
        (modal === null || modal.contains(el)) &&
        el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        parada(el),
    );
    const w = window as unknown as { __teclado: unknown };
    w.__teclado = { controles, ids: new WeakMap<Element, number>(), proximo: 0, descrever, problema };
    return controles.map(descrever);
  });
}

/** Onde o foco está agora (depois do marcarOsControles). */
export async function paradaDeAgora(page: Page): Promise<Parada> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __teclado: {
          controles: HTMLElement[];
          ids: WeakMap<Element, number>;
          proximo: number;
          descrever(el: Element | null): string;
          problema(el: HTMLElement): string | null;
        };
      }
    ).__teclado;
    const el = document.activeElement;
    const corpo = el === null || el === document.body || el === document.documentElement;
    let id = 0;
    if (el && !corpo) {
      id = t.ids.get(el) ?? ++t.proximo;
      t.ids.set(el, id);
    }
    return {
      id,
      corpo,
      indice: el instanceof HTMLElement ? t.controles.indexOf(el) : -1,
      problema: el instanceof HTMLElement && !corpo ? t.problema(el) : null,
      descricao: t.descrever(el),
    };
  });
}

/**
 * O teclado da tela: com um menu aberto, as setas passam por todos os itens dele e o Tab o fecha com o foco à vista. Depois,
 * o Tab dá a volta inteira: cada parada fica à vista (a única fora da página é a volta pelo navegador, entre o último e
 * o primeiro), e todo controle da tela recebe o foco.
 */
export async function conferirOTeclado(page: Page): Promise<void> {
  const menu = page.getByRole('menu');
  if ((await menu.count()) > 0) {
    const itens = await menu.getByRole('menuitem').count();
    for (let i = 0; i < itens; i++) {
      await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitem').nth((i + 1) % itens), `a seta ${i + 1} no menu`).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await marcarOsControles(page);
    const depois = await paradaDeAgora(page);
    expect(depois.corpo || depois.problema !== null, `o Tab que fecha o menu: ${depois.descricao} (${depois.problema})`).toBe(false);
  }

  const controles = await marcarOsControles(page);
  const alcancados = new Set<number>();
  let comeco = 0;
  let voltas = 0;
  let deuAVolta = false;
  for (let passo = 1; passo <= 2 * controles.length + 6; passo++) {
    await page.keyboard.press('Tab');
    const p = await paradaDeAgora(page);
    if (p.corpo) {
      // A volta pelo navegador (do último ao primeiro): uma só por volta.
      voltas += 1;
      expect(voltas, `o foco saiu da página duas vezes (passo ${passo})`).toBe(1);
      continue;
    }
    expect(p.problema, `o foco some no passo ${passo}: ${p.descricao}`).toBeNull();
    if (p.id === comeco) {
      deuAVolta = true;
      break;
    }
    if (comeco === 0) comeco = p.id;
    if (p.indice >= 0) alcancados.add(p.indice);
  }
  expect(deuAVolta, 'o Tab não volta ao primeiro controle').toBe(true);
  expect(
    controles.filter((_, i) => !alcancados.has(i)),
    'os controles que o Tab não alcança',
  ).toEqual([]);
}

/**
 * A largada do Tab: se um clique deixou o foco num controle da tela (o último da fila, a aba que a foto abriu), o Tab
 * sairia da página já no primeiro passo. O foco vai para o primeiro controle, e o Tab dá a volta a partir dele.
 */
export async function daLargada(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ativo = document.activeElement;
    if (ativo === null || ativo === document.body || ativo === document.documentElement) return;
    document.querySelector<HTMLElement>('button, input:not([type="hidden"]), [tabindex]:not([tabindex^="-"])')?.focus();
  });
}
