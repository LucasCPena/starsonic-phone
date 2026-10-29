// A lista da empresa no máximo da planilha (rc.4, spec 6.3: 10.000 contatos) na tela Contatos: a junção com os meus, a
// busca e um estado novo com a tela aberta continuam rápidos. Num arquivo próprio: o trace do Playwright tira uma foto
// do DOM inteiro (uns 150.000 nós com a lista cheia) a cada passo e o teste para, e o `trace` só se desliga no arquivo
// inteiro. Só seletores CSS aqui: o getByRole varre os 20.000 botões.
import { expect, test } from '@playwright/test';
import { abrir, empurrar, mudarEstado } from './helpers';

test.use({ trace: 'off' });

/** Os meus contatos do cenário `contatos`. */
const MEUS = 4;

test('10,000 company contacts: the list, the search and a new state stay fast', async ({ page }) => {
  await abrir(page, 'contatos');
  const muitos = Array.from({ length: 10_000 }, (_, i) => ({
    nome: `Contato ${String(i).padStart(5, '0')}`,
    numero: String(30_000 + i),
    observacao: i % 2 ? 'Galpão' : '',
  }));
  // Um deles é a Ana Souza 2003, que também é minha: fica a minha.
  muitos[1234] = { nome: 'Ana Souza', numero: '2003', observacao: '' };
  await mudarEstado(page, (s) => ({
    ...s,
    empresa: { link: '\\\\servidor\\contatos\\empresa.xlsx', situacao: 'ok', erro: '', atualizadaEm: Date.now(), quantos: 10_000, vez: 1 },
  }));
  await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 1, contatos: muitos });
  const linhas = page.locator('li.row');
  await expect(linhas).toHaveCount(9_999 + MEUS);
  await expect(page.locator('li.row-empresa')).toHaveCount(9_999);
  const busca = page.locator('input[type="search"]');
  await busca.fill('39876');
  await expect(page.locator('li.row .row-title')).toHaveText(['Contato 09876']);
  await busca.fill('');
  await expect(linhas).toHaveCount(9_999 + MEUS);

  // Um estado novo com a tela aberta (um BLF, uma ligação noutro lugar) não refaz as 10.000 linhas: com as linhas prontas
  // reaproveitadas leva uns 7 ms aqui; refazendo, uns 100 ms. A mediana de sete fica abaixo de 50 ms.
  const tempos = await page.evaluate(async () => {
    const fake = (window as unknown as { __fake: { state(): Record<string, any>; push(m: unknown): void } }).__fake;
    const medidas: number[] = [];
    for (let i = 0; i < 7; i++) {
      const s = fake.state();
      const t0 = performance.now();
      fake.push({ v: 1, type: 'state', state: { ...s, perdidas: s.perdidas + 1 } });
      // A mensagem chega numa tarefa e o Preact desenha logo depois dela: a tarefa seguinte já vê a tela nova.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      medidas.push(performance.now() - t0);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    return medidas.sort((a, b) => a - b);
  });
  expect(tempos[3], `os tempos: ${tempos.map((t) => Math.round(t)).join(', ')} ms`).toBeLessThan(50);
  await expect(linhas).toHaveCount(9_999 + MEUS);
});
