// O modo iPhone da interface (spec do iPhone, seções 4.1, 8, 10 e 11.2; docs/ponte-windows.md, "O modo iPhone"), contra a
// ponte falsa no modo iPhone (?plataforma=ios), em cada tamanho do iPhone e nos dois temas: sem a barra de título e sem
// as partes do PC, as Configurações só com as Ligações, o Sobre e os avisos de licença do iPhone, a área do toque de
// 44×44 px dos alvos pequenos, com a área segura, o axe e as fotos (test-results/capturas/ios-*.png) que vão ao
// responsável. A tela da ligação fica em ios-ligacao.spec.ts.
import { expect, test, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { audio, audioFalso, comandos, empurrar, esperarComando, verTextos } from './helpers';
import { abrirIos, areasDe44, capturarIos, dentroDaAreaSegura, noIphone, semViolacoesSerias, TAMANHOS_IPHONE, tamanhoDe } from './ios-helpers';

const APP_CSS = fileURLToPath(new URL('../dist/app.css', import.meta.url));
/** Os avisos de licença do app do iPhone, como o build os põe no pacote. */
const LICENCAS = fileURLToPath(new URL('../dist/assets/licencas-ios.txt', import.meta.url));
/** As teclas do Teclado, na ordem da tela. */
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
/** A conta em uso dos cenários: a Recepção, 2001. */
const CONTA_EM_USO = '9f3c2a71b0d84e55';
const VIEWPORT_DO_IPHONE = 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1';

for (const tamanho of TAMANHOS_IPHONE) {
  for (const tema of ['light', 'dark'] as const) {
    test.describe(`iPhone ${tamanho.largura}×${tamanho.altura} (${tema})`, () => {
      test.use({ ...noIphone(tamanho), colorScheme: tema });

      test('the main screen has no title bar, no Atalhos tab and keeps the safe area', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        await expect(page.locator('.titlebar')).toHaveCount(0);
        await expect(page.locator('.resize-zone')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Atalhos' })).toHaveCount(0);
        await expect(page.locator('.nav button')).toHaveCount(3);
        await expect(page.locator('.win')).toHaveAttribute('data-plataforma', 'ios');
        // Teclado, Recentes e Contatos, sem as teclas do PC, em três colunas de ponta a ponta (e sem o desenho do canto
        // de redimensionar).
        const nav = page.getByRole('navigation', { name: 'Seções' });
        const abas = await nav.locator('button.tab').evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-keyshortcuts')]));
        expect(abas).toEqual([
          ['Teclado', null],
          ['Recentes', null],
          ['Contatos', null],
        ]);
        const colunas = await nav.evaluate((n) => {
          const s = getComputedStyle(n);
          const r = n.getBoundingClientRect();
          const bs = Array.from(n.querySelectorAll('button.tab'), (b) => b.getBoundingClientRect());
          return { inicio: r.left + parseFloat(s.paddingLeft), fim: r.right - parseFloat(s.paddingRight), primeira: bs[0].left, ultima: bs[2].right };
        });
        expect(colunas.primeira).toBeCloseTo(colunas.inicio, 0);
        expect(colunas.ultima).toBeCloseTo(colunas.fim, 0);
        await expect(nav.locator('.grip')).toBeHidden();
        await dentroDaAreaSegura(page, ['.brand', '.nav']);
        // A página até as bordas da tela e sem zoom, e o toque sem o que é do navegador: a seleção de texto fora dos campos,
        // o realce do toque e o zoom de dois toques (o menu do toque longo é o caso do app.css, no fim).
        await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', VIEWPORT_DO_IPHONE);
        const toque = (seletor: string) =>
          page.locator(seletor).first().evaluate((e) => {
            const s = getComputedStyle(e);
            return [s.userSelect, s.touchAction, s.getPropertyValue('-webkit-tap-highlight-color')];
          });
        expect(await toque('.key')).toEqual(['none', 'manipulation', 'rgba(0, 0, 0, 0)']);
        expect(await toque('.account-name')).toEqual(['none', 'manipulation', 'rgba(0, 0, 0, 0)']);
        expect((await toque('input.number-text'))[0]).toBe('text');
        await semViolacoesSerias(page);
        await capturarIos(page, 'teclado', tamanho, tema);
      });

      test('the menu has Configurações, Editar conta, Sobre and Sair, and Sair asks before removeAccount', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const abrirMenu = async () => {
          await page.getByRole('button', { name: 'Menu' }).click();
          return page.getByRole('menu', { name: 'Menu' });
        };
        let menu = await abrirMenu();
        await expect(menu.getByRole('menuitem')).toHaveText(['Configurações', 'Editar conta', 'Sobre', 'Sair']);
        // A linha de separar fica antes do Sair.
        expect(await menu.evaluate((m) => Array.from(m.children, (c) => c.getAttribute('role')))).toEqual([
          'menuitem',
          'menuitem',
          'menuitem',
          'separator',
          'menuitem',
        ]);

        // Editar conta: a tela da conta em uso, preenchida, dentro da área segura e sem o Remover (a confirmação dele fala
        // do computador, e o Sair do Menu já tira a conta).
        await menu.getByRole('menuitem', { name: 'Editar conta' }).click();
        await expect(page.getByRole('heading', { name: 'Editar conta' })).toBeVisible();
        await expect(page.getByLabel('Servidor (endereço ou IP)')).toHaveValue('starcloud1-starsonic.com.br');
        await expect(page.getByLabel('Ramal', { exact: true })).toHaveValue('2001');
        await expect(page.getByLabel('Nome da conta (opcional)')).toHaveValue('Recepção');
        await expect(page.getByRole('button', { name: 'Remover' })).toHaveCount(0);
        await dentroDaAreaSegura(page, ['.bar']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'editar-conta', tamanho, tema);
        await page.getByRole('button', { name: 'Voltar' }).click();

        // O Sair pergunta antes; o Cancelar não manda nada e devolve o foco ao Menu.
        menu = await abrirMenu();
        await menu.getByRole('menuitem', { name: 'Sair' }).click();
        const dialogo = page.getByRole('dialog', { name: 'Sair da conta?' });
        await expect(dialogo).toBeVisible();
        await expect(
          dialogo.getByText('Este iPhone deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha.', { exact: true }),
        ).toBeVisible();
        await expect(dialogo.getByRole('button')).toHaveText(['Cancelar', 'Sair']);
        await dentroDaAreaSegura(page, ['dialog[open]']);
        await semViolacoesSerias(page);
        await dialogo.getByRole('button', { name: 'Cancelar' }).click();
        await expect(dialogo).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
        expect((await comandos(page)).filter((c) => c.cmd === 'removeAccount' || c.cmd === 'quit')).toEqual([]);

        // O Sair da confirmação: o removeAccount da conta em uso (nunca o quit); o C++ de mentira volta à tela Entrar.
        menu = await abrirMenu();
        await menu.getByRole('menuitem', { name: 'Sair' }).click();
        await dialogo.getByRole('button', { name: 'Sair' }).click();
        await esperarComando(page, { cmd: 'removeAccount', contaId: CONTA_EM_USO });
        await expect(page.getByRole('heading', { name: 'Entre com o seu ramal' })).toBeVisible();
        expect((await comandos(page)).filter((c) => c.cmd === 'quit')).toEqual([]);
      });

      test('the account in the header does not switch accounts', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const conta = page.locator('.brand .account');
        await expect(conta).toContainText('2001');
        await expect(conta).toContainText('Conectado · starcloud1-starsonic.com.br');
        await expect(page.getByRole('button', { name: /Trocar de conta/ })).toHaveCount(0);
        // Sem a seta.
        await expect(conta.locator('svg')).toHaveCount(0);
        await conta.click();
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page.getByText('Adicionar conta')).toHaveCount(0);
        expect((await comandos(page)).filter((c) => c.cmd === 'selectAccount')).toEqual([]);
      });

      test('Entrar calls the support number and keeps the safe area', async ({ page }) => {
        await abrirIos(page, 'entrar', tamanho);
        await expect(page.locator('.titlebar')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Fechar' })).toHaveCount(0);
        // O cabeçalho diz o aparelho (o "Ramal no celular" do Android); o do Windows diz "Ramal no computador".
        await expect(page.locator('.brand .eyebrow')).toHaveText('Ramal no iPhone');
        await expect(page.getByRole('heading', { name: 'Entre com o seu ramal' })).toBeVisible();
        await expect(page.getByText('Ramal no computador')).toHaveCount(0);
        // O número da ajuda é um botão: o toque abre o discador do iPhone.
        const ligar = page.getByRole('button', { name: 'Ligar para (11) 5060-3000' });
        await expect(ligar).toHaveText('(11) 5060-3000');
        await expect(page.getByText('Precisa de ajuda? (11) 5060-3000', { exact: true })).toBeVisible();
        await dentroDaAreaSegura(page, ['.brand', 'form']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'entrar', tamanho, tema);
        await ligar.click();
        await esperarComando(page, { cmd: 'openExternal', url: 'tel:+551150603000' });
      });

      test('Recentes calls back on a tap, without Salvar contato', async ({ page }) => {
        await abrirIos(page, 'recentes', tamanho);
        await esperarComando(page, { cmd: 'viewRecents' });
        await expect(page.getByRole('button', { name: 'Recentes' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByText('Perdida · 14:32', { exact: true })).toBeVisible();
        await dentroDaAreaSegura(page, ['.brand', '.nav']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'recentes', tamanho, tema);
        // Tocar numa linha (aqui, um número sem nome) liga de volta (spec 4.1), como o botão de ligar dela: sem o painel
        // do "Ligar" e do "Salvar contato".
        await page.getByRole('button', { name: /^3001/ }).click();
        await esperarComando(page, { cmd: 'dial', numero: '3001' });
        await expect(page.locator('.row-actions')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Salvar contato' })).toHaveCount(0);
        expect((await comandos(page)).filter((c) => c.cmd === 'dial')).toEqual([{ v: 1, cmd: 'dial', numero: '3001' }]);
      });

      test('ring and update messages do nothing, and Ctrl+P and Ctrl+2 do nothing', async ({ page }) => {
        await audioFalso(page);
        await abrirIos(page, 'principal', tamanho);
        await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
        await empurrar(page, { v: 1, type: 'update', versao: '1.0.1', notas: 'Correções no Teclado.' });
        // Um aviso depois dos dois: as mensagens chegam na ordem, e o aviso na tela diz que as duas já passaram.
        await empurrar(page, { v: 1, type: 'toast', texto: 'Sem conexão com o servidor. Tente de novo em instantes.' });
        await expect(page.getByText('Sem conexão com o servidor. Tente de novo em instantes.')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await audio(page), 'nenhum toque').toEqual([]);
        // As teclas do PC não fazem nada: o 5 que vem depois delas chega ao Teclado, que continua na tela.
        await page.keyboard.press('Control+KeyP');
        await page.keyboard.press('Control+2');
        await page.keyboard.press('5');
        await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('5');
        await expect(page.getByRole('button', { name: 'Teclado' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect((await comandos(page)).filter((c) => ['adminLogin', 'updateNow', 'updateLater'].includes(String(c.cmd)))).toEqual([]);
      });

      test('the abrir message opens Recentes', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const recentes = page.getByRole('button', { name: 'Recentes' });
        // Do Teclado.
        await empurrar(page, { v: 1, type: 'abrir', tela: 'recentes' });
        await expect(page.getByRole('main', { name: 'Recentes' })).toBeVisible();
        await expect(recentes).toHaveAttribute('aria-current', 'page');
        await esperarComando(page, { cmd: 'viewRecents' });
        // De Configurações.
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('menuitem', { name: 'Configurações' }).click();
        await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
        await empurrar(page, { v: 1, type: 'abrir', tela: 'recentes' });
        await expect(page.getByRole('main', { name: 'Recentes' })).toBeVisible();
        await expect(recentes).toHaveAttribute('aria-current', 'page');
      });

      test('an abrir asked before ready comes right after the first state and opens Recentes', async ({ page }) => {
        // O app aberto pelo aviso da perdida: o `ready` traz o estado, a agenda e o `abrir`, um atrás do outro.
        await abrirIos(page, 'principal', tamanho, { abrir: 'recentes' });
        await expect(page.getByRole('main', { name: 'Recentes' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Recentes' })).toHaveAttribute('aria-current', 'page');
        await esperarComando(page, { cmd: 'viewRecents' });
      });

      test('the iPhone viewport is in place before the first iPhone screen is drawn', async ({ page }) => {
        // O <meta name="viewport"> no instante em que o .win do iPhone aparece: o observador roda logo depois da mudança,
        // antes de a tela ser pintada.
        await page.addInitScript(() => {
          const w = window as unknown as { __viewportNoPrimeiroQuadro?: string };
          new MutationObserver((_, observador) => {
            if (!document.querySelector('.win[data-plataforma="ios"]')) return;
            w.__viewportNoPrimeiroQuadro = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
            observador.disconnect();
          }).observe(document, { childList: true, subtree: true, attributes: true });
        });
        await abrirIos(page, 'principal', tamanho);
        const noPrimeiroQuadro = await page.evaluate(() => (window as unknown as { __viewportNoPrimeiroQuadro?: string }).__viewportNoPrimeiroQuadro);
        expect(noPrimeiroQuadro).toBe(VIEWPORT_DO_IPHONE);
      });

      test('the header buttons have 44×44 tap areas that do not overlap', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const cabecalho = page.locator('header.brand');
        const areas = await areasDe44(
          ['Não perturbe', 'Atender automático', 'Menu'].map((nome) => [nome, cabecalho.getByRole('button', { name: nome, exact: true })]),
        );
        // O desenho continua o de sempre: no Compacto, os três redondos de 32 px, a 6 px um do outro; no Normal, o Menu de
        // 36 px e as pílulas de 30 px de altura.
        if ((await page.locator('.win').getAttribute('data-layout')) === 'compacto') {
          expect(areas.map((a) => tamanhoDe(a.desenho))).toEqual([
            [32, 32],
            [32, 32],
            [32, 32],
          ]);
          expect(areas.slice(1).map((a, i) => Math.round(a.desenho.esquerda - areas[i].desenho.direita))).toEqual([6, 6]);
        } else {
          expect(tamanhoDe(areas[2].desenho)).toEqual([36, 36]);
          expect(areas.slice(0, 2).map((a) => tamanhoDe(a.desenho)[1])).toEqual([30, 30]);
        }
      });

      test('Configurações shows only Ligações, with Bipe ao digitar', async ({ page }) => {
        await abrirIos(page, 'configuracoes', tamanho);
        await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
        // Só a parte Ligações: o bipe do fim, o Bipe ao digitar (com a ajuda) e o Atender automaticamente com o tempo.
        await expect(page.locator('h2.eyebrow')).toHaveText(['Ligações']);
        const bipeFim = page.getByRole('switch', { name: 'Bipe quando a ligação cai ou termina' });
        const bipeTecla = page.getByRole('switch', { name: 'Bipe ao digitar' });
        const atender = page.getByRole('switch', { name: 'Atender automaticamente' });
        const tempo = page.getByRole('combobox', { name: 'Tempo para atender' });
        await expect(page.getByRole('switch')).toHaveCount(3);
        for (const chave of [bipeFim, bipeTecla, atender]) await expect(chave).toBeVisible();
        await expect(bipeTecla).toHaveAccessibleDescription('Vem ligado. Cada tecla faz o bipe de telefone.');
        await expect(bipeTecla).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByRole('combobox')).toHaveCount(1);
        await expect(tempo).toHaveValue('3');
        // Sem as Contas, o Áudio, o Iniciar com o Windows e os Contatos (a planilha da empresa).
        for (const texto of ['Contas', 'Adicionar conta', 'Áudio', 'Microfone', 'Alto-falante', 'Toque', 'Iniciar com o Windows', 'Contatos', 'Planilha da empresa', 'Atualizar agora']) {
          await expect(page.getByText(texto, { exact: true }), texto).toHaveCount(0);
        }
        await dentroDaAreaSegura(page, ['.bar', '.card']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'configuracoes', tamanho, tema);

        // O Bipe ao digitar manda o setSetting com o bipeTecla, e a chave segue o estado que volta.
        await bipeTecla.click();
        await esperarComando(page, { cmd: 'setSetting', chave: 'bipeTecla', valor: false });
        await expect(bipeTecla).toHaveAttribute('aria-checked', 'false');
        await bipeTecla.click();
        await esperarComando(page, { cmd: 'setSetting', chave: 'bipeTecla', valor: true });
        await expect(bipeTecla).toHaveAttribute('aria-checked', 'true');
        // As outras, como no Windows: cada chave segue o estado que volta, e a ação seguinte só vem depois dele. O Tempo para
        // atender manda o `on` do último estado que chegou: trocado antes de o estado do Atender voltar, ele mandava o
        // on:false de antes.
        await bipeFim.click();
        await esperarComando(page, { cmd: 'setSetting', chave: 'bipeFim', valor: false });
        await expect(bipeFim).toHaveAttribute('aria-checked', 'false');
        await atender.click();
        await esperarComando(page, { cmd: 'setAutoAnswer', on: true });
        await expect(atender).toHaveAttribute('aria-checked', 'true');
        await tempo.selectOption('5');
        await esperarComando(page, { cmd: 'setAutoAnswer', on: true, segundos: 5 });
        await verTextos(page, ['Depois de 5 segundos tocando']);
        expect((await comandos(page)).filter((c) => c.cmd === 'setAudio' || c.chave === 'iniciarComWindows')).toEqual([]);
      });

      test('Sobre shows the iPhone licenses, calls the support and opens the notices', async ({ page }) => {
        await abrirIos(page, 'sobre', tamanho);
        await verTextos(page, [
          'Sobre',
          'Starsonic Phone 0.1.0-rc.1',
          'Usa o baresip e a libre (BSD), a libg722 e o Opus (BSD)',
          'starsonic.com.br',
          '(11) 5060-3000',
          'Também no WhatsApp · seg. a sex., 8h às 18h',
          'Avisos de licença',
          'Enviar diagnóstico',
        ]);
        // Sem a licença e as peças do Windows, e sem o Código-fonte.
        await expect(page.getByText(/GPL|PJSIP|WebView2|Código-fonte|github\.com/)).toHaveCount(0);
        // O site; o telefone, com o Ligar (o discador do iPhone) e o WhatsApp; e a linha dos avisos de licença.
        const cartao = page.locator('.about .card');
        await expect(cartao.getByRole('button')).toHaveText(['Abrir', 'Ligar', 'WhatsApp', 'Avisos de licença']);
        expect(await cartao.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).toEqual([
          'Abrir starsonic.com.br',
          'Ligar para o suporte',
          'Abrir o WhatsApp',
          null,
        ]);
        await dentroDaAreaSegura(page, ['.bar', '.about .card', '.about > .btn']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'sobre', tamanho, tema);

        await page.getByRole('button', { name: 'Ligar para o suporte', exact: true }).click();
        await esperarComando(page, { cmd: 'openExternal', url: 'tel:+551150603000' });
        await page.getByRole('button', { name: 'Abrir o WhatsApp' }).click();
        await esperarComando(page, { cmd: 'openExternal', url: 'https://wa.me/551150603000' });
        await page.getByRole('button', { name: 'Abrir starsonic.com.br' }).click();
        await esperarComando(page, { cmd: 'openExternal', url: 'https://starsonic.com.br' });
        await page.getByRole('button', { name: 'Enviar diagnóstico' }).click();
        await esperarComando(page, { cmd: 'sendDiagnostics' });
        expect((await comandos(page)).filter((c) => c.cmd === 'openExternal').map((c) => c.url)).toEqual([
          'tel:+551150603000',
          'https://wa.me/551150603000',
          'https://starsonic.com.br',
        ]);

        // Os avisos de licença: a tela com o nome, a versão e a licença de cada peça, que rola (também pelo teclado).
        await page.getByRole('button', { name: 'Avisos de licença', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Avisos de licença', level: 1 })).toBeVisible();
        const avisos = page.getByRole('region', { name: 'Avisos de licença' });
        // Cada peça com o nome e a versão num título, sem o sublinhado de "=" do arquivo.
        await expect(avisos.getByRole('heading', { level: 2 })).toHaveText(PECAS);
        await expect(avisos).not.toContainText('==');
        // As linhas comuns de um parágrafo vão juntas e quebram na largura da tela (a frase das licenças BSD: a do baresip, a
        // da libre e a do Opus); as caixas de "*" da libg722 e as linhas com recuo que não continuam um item de lista (os
        // nomes alinhados do Opus) ficam como estão no arquivo, com os espaços.
        await expect(
          avisos.getByText('Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:', {
            exact: true,
          }),
        ).toHaveCount(3);
        const comoNoArquivo = await avisos.locator('.licenca-fixa').evaluateAll((ls) => ls.map((l) => l.textContent));
        expect(comoNoArquivo).toEqual(expect.arrayContaining(['* Copyright (c) CMU    1993', '                    Jean-Marc Valin, Timothy B. Terriberry,']));
        // Um item de lista leva junto as linhas de continuação com recuo do arquivo: a cláusula 1 do BSD do baresip é um
        // parágrafo só, que quebra na largura da tela com o recuo pendente (as linhas de baixo começam no texto, depois do
        // "1.").
        expect(comoNoArquivo).not.toContain('   notice, this list of conditions and the following disclaimer.');
        const baresip = avisos.locator('section').filter({ has: page.getByRole('heading', { name: 'baresip 4.12.0', exact: true }) });
        const clausula1 = baresip.getByText('1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.', {
          exact: true,
        });
        await expect(clausula1).toHaveCount(1);
        const item = await clausula1.evaluate((el) => {
          const [marca, texto] = Array.from(el.children) as HTMLElement[];
          const linha = parseFloat(getComputedStyle(texto).lineHeight);
          return {
            marca: marca.textContent?.trim(),
            marcaAntesDoTexto: marca.getBoundingClientRect().right <= texto.getBoundingClientRect().left,
            linhas: Math.round(texto.getBoundingClientRect().height / linha),
          };
        });
        expect(item.marca).toBe('1.');
        expect(item.marcaAntesDoTexto, 'o recuo pendente: o texto começa depois do "1.", em todas as linhas').toBe(true);
        expect(item.linhas, 'o item quebra na largura da tela').toBeGreaterThan(1);
        // Nenhuma palavra do arquivo fica de fora, e todas na ordem dele (fora os "=").
        const doArquivo = readFileSync(LICENCAS, 'utf8')
          .split(/\s+/)
          .filter((p) => p !== '' && !/^=+$/.test(p));
        expect((await avisos.innerText()).split(/\s+/).filter(Boolean)).toEqual(doArquivo);
        await expect(avisos).toContainText('Baresip Foundation');
        await expect(avisos).toContainText('Xiph.Org');
        await expect(avisos).toHaveAttribute('tabindex', '0');
        expect(await avisos.evaluate((e) => e.scrollHeight > e.clientHeight), 'o texto rola').toBe(true);
        await dentroDaAreaSegura(page, ['.bar', '.licencas']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'licencas', tamanho, tema);
        await page.getByRole('button', { name: 'Voltar' }).click();
        await expect(page.getByRole('heading', { name: 'Sobre', level: 1 })).toBeVisible();
      });

      test('the keypad, the suggestions, the tabs and the agenda rows have 44×44 tap areas', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const compacto = (await page.locator('.win').getAttribute('data-layout')) === 'compacto';
        // O Teclado: o Apagar, as 12 teclas, a sugestão de "988" (a Ana Souza) e as abas.
        const numero = page.getByRole('textbox', { name: 'Número' });
        await numero.fill('988');
        await expect(page.locator('.suggest')).toHaveCount(1);
        const nav = page.getByRole('navigation', { name: 'Seções' });
        const teclado = await areasDe44([
          ['Apagar', page.getByRole('button', { name: 'Apagar' })],
          ...TECLAS.map((t): [string, Locator] => [`tecla ${t}`, page.locator('.keys').getByRole('button', { name: t, exact: true })]),
          ['a sugestão da Ana Souza', page.locator('.suggest')],
          ...['Teclado', 'Recentes', 'Contatos'].map((n): [string, Locator] => [`a aba ${n}`, nav.getByRole('button', { name: n, exact: true })]),
        ]);
        // O Apagar com o desenho de sempre: redondo, de 32 px no Compacto e de 40 no Normal.
        expect(tamanhoDe(teclado[0].desenho)).toEqual(compacto ? [32, 32] : [40, 40]);
        // A lista das sugestões guarda o mínimo de sempre (uma sugestão: 53 px; duas ou três, na linha compacta: 47 px); só
        // na tela baixa (375×667), onde a linha compacta tinha 38 px, ele sobe para os 44 px de uma sugestão.
        const baixa = tamanho.altura < 720;
        const minimoDaLista = () => page.locator('.teclado-meio > .suggestions').evaluate((e) => getComputedStyle(e).minHeight);
        expect(await minimoDaLista()).toBe(baixa ? '44px' : '53px');
        // Duas sugestões dividem a lista (a que não cabe rola para a vista, como no Windows): cada uma com pelo menos 44 px
        // de altura.
        await numero.fill('200');
        await expect(page.locator('.suggest')).toHaveCount(2);
        expect(await minimoDaLista()).toBe(baixa ? '44px' : '47px');
        for (const altura of await page.locator('.suggest').evaluateAll((ss) => ss.map((s) => s.getBoundingClientRect().height))) {
          expect(altura, 'a altura de uma sugestão').toBeGreaterThanOrEqual(43.99);
        }

        // A aba Contatos: a linha e o botão redondo de ligar de cada contato (o redondo com os 38 px de sempre).
        await nav.getByRole('button', { name: 'Contatos', exact: true }).click();
        const nomes = ['Ana Souza', 'Ângela Prado', 'Beatriz Ramos'];
        const linha = (nome: string) => page.locator('main li.row').filter({ has: page.locator('.row-title').getByText(nome, { exact: true }) });
        const contatos = await areasDe44(
          nomes.flatMap((nome): Array<[string, Locator]> => [
            [`a linha de ${nome}`, linha(nome).locator('.row-hit')],
            [`Ligar para ${nome}`, page.getByRole('button', { name: `Ligar para ${nome}`, exact: true })],
          ]),
        );
        expect(contatos.filter((a) => a.nome.startsWith('Ligar')).map((a) => tamanhoDe(a.desenho))).toEqual([
          [38, 38],
          [38, 38],
          [38, 38],
        ]);
      });

      test('Voltar, the switches, the time and the Sobre buttons have 44×44 tap areas', async ({ page }) => {
        await abrirIos(page, 'configuracoes', tamanho);
        const compacto = (await page.locator('.win').getAttribute('data-layout')) === 'compacto';
        const voltar = page.getByRole('button', { name: 'Voltar' });
        // Configurações: o Voltar da barra, as três chaves e o tempo para atender.
        const configuracoes = await areasDe44([
          ['Voltar', voltar],
          ...['Bipe quando a ligação cai ou termina', 'Bipe ao digitar', 'Atender automaticamente'].map((n): [string, Locator] => [n, page.getByRole('switch', { name: n })]),
          ['Tempo para atender', page.getByRole('combobox', { name: 'Tempo para atender' })],
        ]);
        // O desenho de sempre: o Voltar redondo, de 32 px no Compacto e de 36 no Normal, e as chaves de 42×24.
        expect(configuracoes.map((a) => tamanhoDe(a.desenho)).slice(0, 4)).toEqual([compacto ? [32, 32] : [36, 36], [42, 24], [42, 24], [42, 24]]);

        // Sobre: o Voltar, o Abrir do site, o Ligar e o WhatsApp do telefone, os avisos de licença e o Enviar diagnóstico.
        await voltar.click();
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('menuitem', { name: 'Sobre' }).click();
        await areasDe44([
          ['Voltar', voltar],
          ...['Abrir starsonic.com.br', 'Ligar para o suporte', 'Abrir o WhatsApp', 'Avisos de licença', 'Enviar diagnóstico'].map((n): [string, Locator] => [
            n,
            page.getByRole('button', { name: n, exact: true }),
          ]),
        ]);
        // Os avisos de licença e o Editar conta: o Voltar.
        await page.getByRole('button', { name: 'Avisos de licença', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Avisos de licença', level: 1 })).toBeVisible();
        await areasDe44([['Voltar dos avisos', voltar]]);
        await voltar.click();
        await voltar.click();
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('menuitem', { name: 'Editar conta' }).click();
        await expect(page.getByRole('heading', { name: 'Editar conta' })).toBeVisible();
        await areasDe44([['Voltar do Editar conta', voltar]]);
      });
    });
  }
}

/** Os avisos de licença do iPhone (spec do iPhone, 10), na ordem do arquivo: o nome e a versão de cada peça. */
const PECAS = ['baresip 4.12.0', 'libre 4.12.0', 'libg722 1.2.8', 'Opus 1.6.1', 'Plus Jakarta Sans 2.071', 'Preact 10.29.8', 'nlohmann/json 3.11.3', 'miniz 3.0.2'];

/** Um caminho a partir da raiz do repositório. */
function doRepositorio(caminho: string): string {
  return fileURLToPath(new URL(`../../../${caminho}`, import.meta.url));
}

// Os avisos de licença do app do iPhone (spec do iPhone, 10): o nome, a versão e o texto inteiro da licença de cada peça,
// nas versões fixas (o build/deps.lock, o package-lock.json e o que está em starsonic/third_party). As licenças que estão
// no repositório são conferidas letra por letra (a do miniz com o fim de linha do resto do arquivo); as outras, pelo
// SHA-256 do arquivo de licença de cada uma na versão fixa (o LICENSE do baresip, da libre e da libg722 nos commits do
// deps.lock, e o COPYING do Opus na tag v1.6.1).
test('the iPhone license notices carry the name, the version and the whole license of each piece', () => {
  const texto = readFileSync(LICENCAS, 'utf8');
  const lock = JSON.parse(readFileSync(doRepositorio('build/deps.lock'), 'utf8'));
  const npm = JSON.parse(readFileSync(doRepositorio('windows/ui/package-lock.json'), 'utf8'));
  const json = readFileSync(doRepositorio('starsonic/third_party/nlohmann/json.hpp'), 'utf8');
  const versaoDoJson = ['MAJOR', 'MINOR', 'PATCH'].map((p) => json.match(new RegExp(`#define NLOHMANN_JSON_VERSION_${p} (\\d+)`))![1]).join('.');
  const semV = (tag: string) => tag.replace(/^v/, '');
  const esperadas: Array<{ peca: string; sha256?: string; arquivo?: string }> = [
    { peca: `baresip ${semV(lock.baresip.baresip.tag)}`, sha256: '020859591b1d52b62d9436e89a13c279c890099e0b412984cf599a298aa7b128' },
    { peca: `libre ${semV(lock.baresip.re.tag)}`, sha256: '76b5c9a0aa85ac72a6d5d2e2998f5ea4462ff633e585e59a749c7f9d506c0b76' },
    { peca: `libg722 ${semV(lock.baresip.libg722.tag)}`, sha256: '1e254974831f464d0aa84d3bb9d534d3e6c657d6bb33e83637482b2105cb4984' },
    { peca: `Opus ${semV(lock.android.opus.tag)}`, sha256: '01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551' },
    { peca: 'Plus Jakarta Sans 2.071', arquivo: 'windows/ui/assets/OFL.txt' },
    { peca: `Preact ${npm.packages['node_modules/preact'].version}`, arquivo: 'windows/ui/node_modules/preact/LICENSE' },
    { peca: `nlohmann/json ${versaoDoJson}`, arquivo: 'starsonic/third_party/nlohmann/LICENSE.MIT' },
    { peca: 'miniz 3.0.2', arquivo: 'starsonic/third_party/miniz/LICENSE' },
  ];
  // Cada parte: o nome e a versão, sublinhados com "=", uma linha em branco e a licença inteira; duas linhas em branco
  // entre as partes.
  const titulos = Array.from(texto.matchAll(/^(\S.*)\n(=+)\n\n/gm)).filter((m) => m[1].length === m[2].length);
  expect(titulos.map((m) => m[1])).toEqual(esperadas.map((e) => e.peca));
  expect(PECAS).toEqual(esperadas.map((e) => e.peca));
  expect(titulos[0].index, 'o arquivo começa na primeira peça').toBe(0);
  for (const [i, titulo] of titulos.entries()) {
    const inicio = titulo.index! + titulo[0].length;
    const fim = i + 1 < titulos.length ? titulos[i + 1].index! - 2 : texto.length;
    if (i + 1 < titulos.length) expect(texto.slice(fim - 1, fim + 2), `${titulo[1]}: o fim`).toBe('\n\n\n');
    const licenca = texto.slice(inicio, fim);
    const { peca, sha256, arquivo } = esperadas[i];
    if (arquivo) expect(licenca, peca).toBe(readFileSync(doRepositorio(arquivo), 'utf8').replace(/\r\n/g, '\n'));
    else expect(createHash('sha256').update(licenca).digest('hex'), peca).toBe(sha256);
  }
});

test.describe('os avisos de licença sem o arquivo', () => {
  test.use(noIphone(TAMANHOS_IPHONE[1]));

  test('the notices screen asks to reinstall when its text does not load', async ({ page }) => {
    await page.route('**/assets/licencas-ios.txt', (rota) => rota.abort());
    await abrirIos(page, 'sobre', TAMANHOS_IPHONE[1]);
    await page.getByRole('button', { name: 'Avisos de licença', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Reinstale o Starsonic Phone.');
    await expect(page.getByRole('heading', { name: 'Avisos de licença', level: 1 })).toBeVisible();
    await semViolacoesSerias(page);
  });
});

/** Os seletores de uma lista, separados só pelas vírgulas de fora (a de um `:is(input, textarea)` fica dentro dele). */
function seletoresDaLista(lista: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let inicio = 0;
  for (let i = 0; i < lista.length; i++) {
    if (lista[i] === '(' || lista[i] === '[') nivel++;
    else if (lista[i] === ')' || lista[i] === ']') nivel--;
    else if (lista[i] === ',' && nivel === 0) {
      partes.push(lista.slice(inicio, i));
      inicio = i + 1;
    }
  }
  partes.push(lista.slice(inicio));
  return partes.map((p) => p.trim());
}

// O menu do toque longo (o -webkit-touch-callout) é só do WebKit: o Chromium dos testes não o tem no estilo calculado, e
// o caso confere as regras no app.css. Elas valem só no modo iPhone, como o resto, e nos campos o menu volta (o Colar).
test('the iPhone styles turn off the long-press menu outside the fields, and only in the iPhone mode', () => {
  const css = readFileSync(APP_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const regras = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, seletor, corpo]) => ({ seletor: seletor.trim(), corpo }));
  const callout = regras.filter((r) => /-webkit-touch-callout/.test(r.corpo));
  expect(callout.some((r) => /-webkit-touch-callout:\s*none/.test(r.corpo))).toBe(true);
  for (const parte of callout.flatMap((r) => seletoresDaLista(r.seletor))) expect(parte).toMatch(/^\.win\[data-plataforma="ios"\]/);
  expect(callout.some((r) => /\binput\b/.test(r.seletor) && /\btextarea\b/.test(r.seletor) && /-webkit-touch-callout:\s*default/.test(r.corpo))).toBe(true);
});
