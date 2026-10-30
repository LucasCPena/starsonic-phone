// A tela da ligação no modo iPhone (spec do iPhone, 4.1, 7.7 e 11.2; docs/ponte-windows.md, "O modo iPhone"), contra a
// ponte falsa no modo iPhone, em cada tamanho do iPhone e nos dois temas: o botão Áudio com a saída de agora, que pede a
// escolha do iPhone (o `audioRoute`), sem o Atalhos; o bipe das teclas (o `keyTone`, só com o Bipe ao digitar) no
// Teclado e no teclado da ligação; e a área segura (Review Focus 4 da etapa 2) da tela da ligação, do teclado dela, dos
// diálogos e do aviso de 2 s, com a área do toque de 44×44 px dos botões pequenos, o axe e as fotos
// (test-results/capturas/ios-*.png) que vão ao responsável. No fim, o Windows sem nada disso.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, comandos, depoisDoQueChegou, empurrar, esperarComando, mudarEstado, type Comando } from './helpers';
import { abrirIos, areasDe44, capturarIos, dentroDaAreaSegura, noIphone, semViolacoesSerias, TAMANHOS_IPHONE, tamanhoDe } from './ios-helpers';

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const AVISO = 'Sem conexão com o servidor. Tente de novo em instantes.';

function botao(page: Page, nome: string): Locator {
  return page.getByRole('button', { name: nome, exact: true });
}

/** Os comandos das teclas (o dtmf e o keyTone), na ordem em que saíram. */
async function dasTeclas(page: Page): Promise<Comando[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'dtmf' || c.cmd === 'keyTone');
}

/** As teclas dos keyTone que saíram, na ordem. */
async function bipes(page: Page): Promise<unknown[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'keyTone').map((c) => c.tecla);
}

/** O aviso de 2 s na tela e parado no lugar dele: a entrada (180 ms) o traz 6 px de baixo, e a caixa só vale no fim. */
async function avisoNaTela(page: Page): Promise<void> {
  await empurrar(page, { v: 1, type: 'toast', texto: AVISO });
  await expect(page.getByText(AVISO)).toBeVisible();
  await page.locator('.toast-box').evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
}

for (const tamanho of TAMANHOS_IPHONE) {
  for (const tema of ['light', 'dark'] as const) {
    test.describe(`Ligação no iPhone ${tamanho.largura}×${tamanho.altura} (${tema})`, () => {
      test.use({ ...noIphone(tamanho), colorScheme: tema });

      test('the call screen shows the audio route and asks the iPhone to choose', async ({ page }) => {
        await abrirIos(page, 'ligacao', tamanho);
        // O botão Áudio mostra a saída de agora; o nome dele diz o que ele é e a saída.
        const audio = botao(page, 'Áudio: iPhone');
        await expect(audio).toHaveText('iPhone');
        // Os controles de uma ligação, sem o Atalhos (fora da 1.0), em três colunas: Mudo, Teclado e Áudio; Espera,
        // Transferir e Nova ligação.
        const controles = page.locator('.ctrls > *');
        await expect(controles).toHaveText(['Mudo', 'Teclado', 'iPhone', 'Espera', 'Transferir', 'Nova ligação']);
        await expect(page.getByRole('button', { name: 'Atalhos' })).toHaveCount(0);
        const colunas = await controles.evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().left)));
        expect(colunas.slice(3), 'a segunda linha começa embaixo da primeira').toEqual(colunas.slice(0, 3));
        await dentroDaAreaSegura(page, ['main.call-body button', '.who']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'ligacao', tamanho, tema);

        // O toque pede a escolha do iPhone (o hospedeiro mostra a dele), sem o menu dos dispositivos do Windows.
        await audio.click();
        await esperarComando(page, { cmd: 'audioRoute' });
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(audio).not.toHaveAttribute('aria-haspopup');
        await expect(audio).not.toHaveAttribute('aria-expanded');
        // A saída trocada (na tela de chamada do iPhone, ou um fone que liga) vem num estado novo.
        await mudarEstado(page, (s) => ({ ...s, rotaAudio: 'Viva-voz' }));
        await expect(botao(page, 'Áudio: Viva-voz')).toHaveText('Viva-voz');
        // Um fone de nome comprido: numa linha só, cortado com as reticências; o nome inteiro fica no nome do botão.
        const comprido = 'Fone de ouvido sem fio da Recepção';
        await mudarEstado(page, (s) => ({ ...s, rotaAudio: comprido }));
        const fone = botao(page, `Áudio: ${comprido}`);
        await expect(fone).toHaveText(comprido);
        const rotulo = await fone.locator('.ctrl-rota').evaluate((e) => ({
          altura: e.getBoundingClientRect().height,
          linha: parseFloat(getComputedStyle(e).lineHeight),
          cortado: e.scrollWidth > e.clientWidth,
          reticencias: getComputedStyle(e).textOverflow,
        }));
        expect(rotulo.altura, 'uma linha só').toBeLessThan(1.5 * rotulo.linha);
        expect(rotulo).toMatchObject({ cortado: true, reticencias: 'ellipsis' });
        await dentroDaAreaSegura(page, ['main.call-body button']);
        // Sem saber a saída: só "Áudio".
        await mudarEstado(page, (s) => ({ ...s, rotaAudio: '' }));
        await expect(botao(page, 'Áudio')).toHaveText('Áudio');
        expect((await comandos(page)).filter((c) => c.cmd === 'audioRoute' || c.cmd === 'setAudio')).toEqual([{ v: 1, cmd: 'audioRoute' }]);
      });

      test('the keys beep through keyTone only with bipeTecla', async ({ page }) => {
        // O Teclado: cada tecla da tela e do teclado físico manda o keyTone com ela (o + como a tecla 0); o Apagar não.
        await abrirIos(page, 'principal', tamanho);
        const numero = page.getByRole('textbox', { name: 'Número' });
        const tecla = (t: string) => page.locator('.keys').getByRole('button', { name: t, exact: true });
        for (const t of ['1', '5', '0', '*', '#']) await tecla(t).click();
        await page.keyboard.press('7');
        await page.keyboard.press('+');
        await expect(numero).toHaveValue('150*#7+');
        await page.getByRole('button', { name: 'Apagar' }).click();
        await expect(numero).toHaveValue('150*#7');
        await expect.poll(() => bipes(page)).toEqual(['1', '5', '0', '*', '#', '7', '0']);
        // Com o Bipe ao digitar desligado, as teclas digitam sem o bipe.
        await mudarEstado(page, (s) => ({ ...s, config: { ...s.config, bipeTecla: false } }));
        await depoisDoQueChegou(page);
        await tecla('2').click();
        await page.keyboard.press('3');
        await expect(numero).toHaveValue('150*#723');
        expect(await bipes(page)).toEqual(['1', '5', '0', '*', '#', '7', '0']);
        expect((await comandos(page)).filter((c) => c.cmd === 'dtmf')).toEqual([]);

        // O teclado da ligação: cada tecla manda o dtmf e, junto, o keyTone com ela; o teclado físico também.
        await abrirIos(page, 'ligacao', tamanho);
        await botao(page, 'Teclado').click();
        const teclado = page.getByRole('group', { name: 'Teclado da ligação' });
        await teclado.getByRole('button', { name: '1', exact: true }).click();
        await page.keyboard.press('#');
        await expect.poll(() => dasTeclas(page)).toEqual([
          { v: 1, cmd: 'dtmf', digitos: '1' },
          { v: 1, cmd: 'keyTone', tecla: '1' },
          { v: 1, cmd: 'dtmf', digitos: '#' },
          { v: 1, cmd: 'keyTone', tecla: '#' },
        ]);
        // O teclado da ligação também fica na área segura (a foto dele vai junto das outras, sem o contorno do foco que
        // a tecla do teclado físico deixou no 1).
        await dentroDaAreaSegura(page, ['.call-keys .key', 'main.call-body button', '.who']);
        await semViolacoesSerias(page);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await capturarIos(page, 'ligacao-teclado', tamanho, tema);
        // Sem a chave, só o dtmf.
        await mudarEstado(page, (s) => ({ ...s, config: { ...s.config, bipeTecla: false } }));
        await depoisDoQueChegou(page);
        await teclado.getByRole('button', { name: '2', exact: true }).click();
        await page.keyboard.press('9');
        await expect.poll(() => dasTeclas(page)).toEqual([
          { v: 1, cmd: 'dtmf', digitos: '1' },
          { v: 1, cmd: 'keyTone', tecla: '1' },
          { v: 1, cmd: 'dtmf', digitos: '#' },
          { v: 1, cmd: 'keyTone', tecla: '#' },
          { v: 1, cmd: 'dtmf', digitos: '2' },
          { v: 1, cmd: 'dtmf', digitos: '9' },
        ]);
      });

      test('two calls, the consult and the conference keep the safe area', async ({ page }) => {
        for (const [cenario, nomes] of [
          ['duas-ligacoes', ['Mudo', 'Teclado', 'iPhone', 'Espera', 'Transferir', 'Alternar', 'Juntar']],
          ['consulta', ['Mudo', 'Alternar', 'Cancelar']],
          ['conferencia', ['Mudo', 'Teclado', 'Separar']],
        ] as const) {
          await abrirIos(page, cenario, tamanho);
          await expect(page.locator('.ctrls > *'), cenario).toHaveText([...nomes]);
          await expect(page.getByRole('button', { name: 'Atalhos' })).toHaveCount(0);
          // Os botões, os cartões (a outra ligação, os da conferência) e quem fala ficam na área segura.
          await dentroDaAreaSegura(page, ['main.call-body button', '.vcard', '.who']);
          await semViolacoesSerias(page);
          await capturarIos(page, cenario, tamanho, tema);
        }
        // Duas ligações, com o painel do Transferir e com o teclado aberto: o cartão em cima e o resto embaixo dele.
        await abrirIos(page, 'duas-ligacoes', tamanho);
        await botao(page, 'Transferir').click();
        await expect(page.getByRole('textbox', { name: 'Número para transferir' })).toBeVisible();
        await dentroDaAreaSegura(page, ['.vcard', '.call-panel', 'main.call-body button']);
        await botao(page, 'Cancelar').click();
        await botao(page, 'Teclado').click();
        await dentroDaAreaSegura(page, ['.vcard', '.call-keys .key', 'main.call-body button']);
      });

      test('the dialogs and the toast stay inside the safe area', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        // O aviso de 2 s: dentro da área segura e em cima da navegação, como no Windows.
        await avisoNaTela(page);
        await dentroDaAreaSegura(page, ['.toast-box']);
        const aviso = (await page.locator('.toast-box').boundingBox())!;
        const nav = (await page.locator('.nav').boundingBox())!;
        expect(aviso.y + aviso.height, 'o aviso em cima da navegação').toBeLessThanOrEqual(nav.y + 0.5);

        // A confirmação do Sair.
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('menuitem', { name: 'Sair' }).click();
        await expect(page.getByRole('dialog', { name: 'Sair da conta?' })).toBeVisible();
        await dentroDaAreaSegura(page, ['dialog[open]']);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // A escolha do número de um contato com muitos números: o diálogo fica na área segura e rola por dentro, até o
        // Cancelar.
        const numeros = Array.from({ length: 14 }, (_, i) => `(11) 9${4000 + i}-${7000 + i}`);
        await empurrar(page, { v: 1, type: 'agenda', vez: 2, contatos: [{ nome: 'Central de Atendimento', numeros }] });
        await mudarEstado(page, (s) => ({ ...s, agenda: { permissao: 'concedida', vez: 2, quantos: 1 } }));
        await page.getByRole('navigation', { name: 'Seções' }).getByRole('button', { name: 'Contatos', exact: true }).click();
        // O toque só depois de a lista nova estar na tela (antes dela, a aba mostra a agenda de exemplo).
        await expect(page.locator('main li.row .row-title')).toHaveText(['Central de Atendimento']);
        await page.locator('main li.row .row-hit').click();
        const escolha = page.getByRole('dialog', { name: 'Central de Atendimento' });
        await expect(escolha).toBeVisible();
        await expect(escolha.getByRole('button')).toHaveCount(numeros.length + 1);
        await dentroDaAreaSegura(page, ['dialog[open]']);
        expect(await escolha.evaluate((d) => d.scrollHeight > d.clientHeight), 'o diálogo rola por dentro').toBe(true);
        const cancelar = escolha.getByRole('button', { name: 'Cancelar' });
        await cancelar.scrollIntoViewIfNeeded();
        await expect(cancelar).toBeInViewport();
        await dentroDaAreaSegura(page, ['dialog[open]']);
        await cancelar.click();
        await expect(escolha).toHaveCount(0);

        // Na ligação, o aviso fica no alto, embaixo da barra de status.
        await abrirIos(page, 'ligacao', tamanho);
        await avisoNaTela(page);
        await dentroDaAreaSegura(page, ['.toast-box']);
      });

      test('the round buttons, the keypad and Cancelar of the call screen have 44×44 tap areas', async ({ page }) => {
        // A segunda que toca: o Recusar e o Atender redondos da faixa, com os 40 px de sempre.
        await abrirIos(page, 'ligacao-segunda', tamanho);
        const faixa = await areasDe44([
          ['Recusar', botao(page, 'Recusar')],
          ['Atender', botao(page, 'Atender')],
        ]);
        expect(faixa.map((a) => tamanhoDe(a.desenho))).toEqual([
          [40, 40],
          [40, 40],
        ]);
        // Duas ligações: o Desligar da que está em espera, com os 32 px de sempre.
        await abrirIos(page, 'duas-ligacoes', tamanho);
        const espera = await areasDe44([['Desligar Ana Souza', botao(page, 'Desligar Ana Souza')]]);
        expect(tamanhoDe(espera[0].desenho)).toEqual([32, 32]);
        // O teclado da ligação, o Teclado do lado e o Desligar.
        await botao(page, 'Teclado').click();
        const teclado = page.getByRole('group', { name: 'Teclado da ligação' });
        await areasDe44([
          ...TECLAS.map((t): [string, Locator] => [`tecla ${t}`, teclado.getByRole('button', { name: t, exact: true })]),
          ['Teclado', botao(page, 'Teclado')],
          ['Desligar', botao(page, 'Desligar')],
        ]);
        // O painel do Transferir: o Cancelar (40 px de altura), o Consultar e o Transferir agora.
        await botao(page, 'Teclado').click();
        await botao(page, 'Transferir').click();
        const painel = await areasDe44([
          ['Consultar', botao(page, 'Consultar')],
          ['Transferir agora', botao(page, 'Transferir agora')],
          ['Cancelar', botao(page, 'Cancelar')],
        ]);
        expect(tamanhoDe(painel[2].desenho)[1]).toBe(40);
      });
    });
  }
}

// O Windows (sem `plataforma` no estado) fica como está: as teclas não bipam, e o Áudio abre o menu dos dispositivos.
test('without plataforma the keys send no keyTone and Áudio keeps the device menu and Atalhos', async ({ page }) => {
  await abrir(page, 'principal');
  for (const t of ['1', '0', '#']) await page.locator('.keys').getByRole('button', { name: t, exact: true }).click();
  await page.keyboard.press('5');
  await page.keyboard.press('+');
  await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('10#5+');
  expect((await comandos(page)).filter((c) => c.cmd === 'keyTone')).toEqual([]);

  await abrir(page, 'ligacao');
  await expect(botao(page, 'Atalhos')).toBeVisible();
  await expect(botao(page, 'Áudio')).toHaveAttribute('aria-haspopup', 'menu');
  await botao(page, 'Áudio').click();
  await expect(page.getByRole('menu', { name: 'Áudio' })).toBeVisible();
  await page.keyboard.press('Escape');
  await botao(page, 'Teclado').click();
  await page.getByRole('group', { name: 'Teclado da ligação' }).getByRole('button', { name: '1', exact: true }).click();
  await esperarComando(page, { cmd: 'dtmf', digitos: '1' });
  expect((await comandos(page)).filter((c) => c.cmd === 'keyTone' || c.cmd === 'audioRoute')).toEqual([]);
});
