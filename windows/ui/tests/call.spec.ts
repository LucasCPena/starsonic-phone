// A tela da ligação (uma, com a segunda tocando, duas, consulta, conferência), o aviso de ligação recebida
// (aviso.html, 380×168) e o toque, contra a ponte falsa: os textos exatos, os comandos que saem, o axe e as
// capturas. A interface não decide nenhuma regra: os botões seguem só o `ligacao` do estado.
import { test, expect, type Page } from '@playwright/test';
import {
  abrir,
  audio,
  audioFalso,
  capturar,
  comandos,
  empurrar,
  esperarComando,
  estado,
  mudarEstado,
  semViolacoesSerias,
  toques,
  verTextos,
  vezes,
} from './helpers';

const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });

async function abrirAviso(page: Page, cenario: string): Promise<void> {
  await page.setViewportSize({ width: 380, height: 168 });
  await abrir(page, cenario, 'aviso.html');
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema}`, () => {
    test.use({ colorScheme: tema });

    test('one call shows the name, the timer and the controls, and sends mute, hold and hangup', async ({ page }) => {
      await abrir(page, 'ligacao');
      await verTextos(page, ['Starsonic Phone · Recepção · 2001', 'Em ligação', 'Ana Souza', 'Ramal 2003', 'Desligar']);
      await expect(page.getByText(/^03:1\d$/)).toBeVisible();
      for (const nome of ['Mudo', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Nova ligação']) {
        await expect(botao(page, nome), nome).toBeEnabled();
      }
      // Sempre a seção escura, nos dois temas.
      const fundo = await page.locator('.win').evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(fundo).toContain('linear-gradient');
      expect(await page.getByText('Ana Souza', { exact: true }).evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
      await semViolacoesSerias(page);
      await capturar(page, 'ligacao', tema);

      await botao(page, 'Mudo').click();
      await esperarComando(page, { cmd: 'mute', on: true });
      await expect(botao(page, 'Mudo')).toHaveAttribute('aria-pressed', 'true');
      await botao(page, 'Espera').click();
      await esperarComando(page, { cmd: 'hold', on: true });
      await expect(botao(page, 'Espera')).toHaveAttribute('aria-pressed', 'true');
      await verTextos(page, ['Em espera']);
      await botao(page, 'Espera').click();
      await esperarComando(page, { cmd: 'hold', on: false });
      await expect(page.getByText('Em espera', { exact: true })).toHaveCount(0);
      // Desligar manda o id do cartão; a última ligação acabou: o Teclado volta.
      await botao(page, 'Desligar').click();
      await esperarComando(page, { cmd: 'hangup', id: 11 });
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Seções' })).toBeVisible();
    });

    test('the second call rings on the band and is rejected or answered', async ({ page }) => {
      await abrir(page, 'ligacao-segunda');
      await verTextos(page, ['Ligação de Carlos Lima', 'Ramal 2007 · tocando', 'Em ligação', 'Ana Souza', 'Ramal 2003']);
      await expect(botao(page, 'Mudo')).toHaveAttribute('aria-pressed', 'true');
      await semViolacoesSerias(page);
      await capturar(page, 'ligacao-segunda', tema);

      await botao(page, 'Recusar').click();
      await esperarComando(page, { cmd: 'reject' });
      await expect(page.getByText('Ligação de Carlos Lima')).toHaveCount(0);

      await page.reload();
      await expect(page.locator('body[data-pronto]')).toHaveCount(1);
      await botao(page, 'Atender').click();
      await esperarComando(page, { cmd: 'answer' });
      // Atendida: o Carlos em cima e a Ana no cartão "Em espera".
      await expect(page.locator('.who-name')).toHaveText('Carlos Lima');
      await expect(page.locator('.vcard').filter({ hasText: 'Ana Souza' }).getByText('Em espera', { exact: true })).toBeVisible();
    });

    test('two calls show the held card, Alternar and Juntar, and no Nova ligação', async ({ page }) => {
      await abrir(page, 'duas-ligacoes');
      await expect(page.locator('.who-name')).toHaveText('Carlos Lima');
      const espera = page.locator('.vcard').filter({ hasText: 'Ana Souza' });
      await expect(espera.getByText('Em espera', { exact: true })).toBeVisible();
      await expect(espera.getByText(/^Ramal 2003 · 08:4\d$/)).toBeVisible();
      for (const nome of ['Mudo', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Alternar', 'Juntar']) {
        await expect(botao(page, nome), nome).toBeEnabled();
      }
      await expect(botao(page, 'Nova ligação')).toHaveCount(0);
      await semViolacoesSerias(page);
      await capturar(page, 'duas-ligacoes', tema);

      // Com duas ligações, o Consultar fica travado (a consulta seria a terceira); Transferir agora vale.
      await botao(page, 'Transferir').click();
      await expect(botao(page, 'Consultar')).toBeDisabled();
      await page.getByRole('textbox', { name: 'Número para transferir' }).fill('2004');
      await expect(botao(page, 'Transferir agora')).toBeEnabled();
      await botao(page, 'Cancelar').click();
      await expect(botao(page, 'Transferir agora')).toHaveCount(0);

      await botao(page, 'Alternar').click();
      await esperarComando(page, { cmd: 'swap' });
      await expect(page.locator('.who-name')).toHaveText('Ana Souza');
      await expect(page.locator('.vcard').filter({ hasText: 'Carlos Lima' }).getByText('Em espera', { exact: true })).toBeVisible();

      // O Desligar do cartão em espera manda o id dele.
      await page.getByRole('button', { name: 'Desligar Carlos Lima' }).click();
      await esperarComando(page, { cmd: 'hangup', id: 12 });
      await expect(page.locator('.vcard')).toHaveCount(0);
    });

    test('Juntar makes a conference and Separar splits it', async ({ page }) => {
      await abrir(page, 'duas-ligacoes');
      await botao(page, 'Juntar').click();
      await esperarComando(page, { cmd: 'join' });
      await verTextos(page, ['Conferência', 'Você, Carlos e Ana']);
      await botao(page, 'Separar').click();
      await esperarComando(page, { cmd: 'split' });
      await expect(page.getByText('Conferência', { exact: true })).toHaveCount(0);
      await expect(page.locator('.vcard').filter({ hasText: 'Ana Souza' }).getByText('Em espera', { exact: true })).toBeVisible();
    });

    test('the conference shows the participants and the time since Juntar, never Em espera', async ({ page }) => {
      await abrir(page, 'conferencia');
      await verTextos(page, ['Conferência', 'Você, Ana e Carlos', 'Ana Souza', 'Ramal 2003', 'Carlos Lima', 'Ramal 2007', 'Desligar para todos']);
      await expect(page.getByText(/^06:2\d$/)).toBeVisible();
      for (const nome of ['Mudo', 'Teclado', 'Separar']) await expect(botao(page, nome), nome).toBeEnabled();
      for (const nome of ['Espera', 'Transferir', 'Alternar', 'Juntar', 'Nova ligação']) await expect(botao(page, nome), nome).toHaveCount(0);
      await expect(page.getByText(/Em espera/)).toHaveCount(0);
      await semViolacoesSerias(page);
      await capturar(page, 'conferencia', tema);

      // Mesmo que um cartão venha com held, na conferência ninguém está "Em espera".
      await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: { ...s.ligacao.second, held: true } } }));
      await expect(page.getByText('Você, Ana e Carlos')).toBeVisible();
      await expect(page.getByText(/Em espera/)).toHaveCount(0);

      await botao(page, 'Desligar para todos').click();
      await esperarComando(page, { cmd: 'hangup', id: 11 });
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    });

    test('Transferir sends Transferir agora with the number', async ({ page }) => {
      await abrir(page, 'ligacao');
      await botao(page, 'Transferir').click();
      await verTextos(page, ['Transferir para']);
      const numero = page.getByRole('textbox', { name: 'Número para transferir' });
      await expect(numero).toBeFocused();
      // Sem número, nada a mandar.
      await expect(botao(page, 'Transferir agora')).toBeDisabled();
      await expect(botao(page, 'Consultar')).toBeDisabled();
      await numero.fill('2004');
      await semViolacoesSerias(page);
      await capturar(page, 'ligacao-transferir', tema);
      await botao(page, 'Transferir agora').click();
      await esperarComando(page, { cmd: 'transfer', numero: '2004' });
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    });

    test('Consultar calls the colleague and Concluir transferência completes it', async ({ page }) => {
      await abrir(page, 'ligacao');
      await botao(page, 'Transferir').click();
      await page.getByRole('textbox', { name: 'Número para transferir' }).fill('2007');
      await botao(page, 'Consultar').click();
      await esperarComando(page, { cmd: 'consult', numero: '2007' });
      // O colega chama: Concluir e Alternar travados (só entre ligações confirmadas), Cancelar vale.
      await verTextos(page, ['Consultando', 'Carlos Lima', 'Chamando…', 'Em espera · transferência']);
      await expect(botao(page, 'Concluir transferência')).toBeDisabled();
      await expect(botao(page, 'Alternar')).toBeDisabled();
      await expect(botao(page, 'Cancelar')).toBeEnabled();
      // O colega atendeu.
      await expect(botao(page, 'Concluir transferência')).toBeEnabled();
      await expect(botao(page, 'Alternar')).toBeEnabled();
      await botao(page, 'Concluir transferência').click();
      await esperarComando(page, { cmd: 'completeTransfer' });
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    });

    test('the consult shows the client on hold for the transfer and sends Alternar and Cancelar', async ({ page }) => {
      await abrir(page, 'consulta');
      await verTextos(page, [
        'Ana Souza',
        'Em espera · transferência',
        'Consultando',
        'Carlos Lima',
        'Ramal 2007',
        'Concluir transferência',
        'Ana Souza passa a falar com Carlos Lima, e as duas ligações saem daqui.',
      ]);
      await expect(page.getByText(/^Ramal 2003 · 08:4\d$/)).toBeVisible();
      await expect(page.getByText(/^00:4\d$/)).toBeVisible();
      for (const nome of ['Mudo', 'Alternar', 'Cancelar', 'Concluir transferência']) await expect(botao(page, nome), nome).toBeEnabled();
      for (const nome of ['Juntar', 'Espera', 'Transferir', 'Nova ligação']) await expect(botao(page, nome), nome).toHaveCount(0);
      await semViolacoesSerias(page);
      await capturar(page, 'consulta', tema);

      await botao(page, 'Mudo').click();
      await esperarComando(page, { cmd: 'mute', on: true });
      // Alternar: a cliente em cima, o colega "Em espera"; os botões da consulta continuam.
      await botao(page, 'Alternar').click();
      await esperarComando(page, { cmd: 'swap' });
      await expect(page.locator('.who-name')).toHaveText('Ana Souza');
      await expect(page.locator('.vcard').filter({ hasText: 'Carlos Lima' }).getByText('Em espera', { exact: true })).toBeVisible();
      await expect(botao(page, 'Concluir transferência')).toBeEnabled();
      await botao(page, 'Cancelar').click();
      await esperarComando(page, { cmd: 'cancelConsult' });
      await expect(page.locator('.vcard')).toHaveCount(0);
      await expect(page.locator('.who-name')).toHaveText('Ana Souza');
      await expect(botao(page, 'Nova ligação')).toBeEnabled();
    });

    test('Nova ligação dials a second call; Alternar and Juntar wait until it is answered', async ({ page }) => {
      await abrir(page, 'ligacao');
      await botao(page, 'Nova ligação').click();
      const numero = page.getByRole('textbox', { name: 'Número da nova ligação' });
      await expect(numero).toBeFocused();
      await numero.fill('2010');
      // A sugestão do contato liga pela regra dos contatos; o Ligar liga o número digitado.
      await expect(page.getByRole('button', { name: /Financeiro/ })).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'ligacao-nova', tema);
      await botao(page, 'Ligar').click();
      await esperarComando(page, { cmd: 'dial', numero: '2010' });
      await verTextos(page, ['Financeiro', 'Chamando…']);
      await expect(page.locator('.vcard').filter({ hasText: 'Ana Souza' }).getByText('Em espera', { exact: true })).toBeVisible();
      await expect(botao(page, 'Alternar')).toBeDisabled();
      await expect(botao(page, 'Juntar')).toBeDisabled();
      await expect(botao(page, 'Alternar')).toBeEnabled();
      await expect(botao(page, 'Juntar')).toBeEnabled();
    });

    test('the in-call keypad sends DTMF from the keys and the keyboard only while open', async ({ page }) => {
      await abrir(page, 'ligacao');
      await page.keyboard.press('5');
      await botao(page, 'Teclado').click();
      await expect(botao(page, 'Teclado')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: '1', exact: true }).click();
      await esperarComando(page, { cmd: 'dtmf', digitos: '1' });
      await page.keyboard.press('#');
      await esperarComando(page, { cmd: 'dtmf', digitos: '#' });
      await verTextos(page, ['1#']);
      await semViolacoesSerias(page);
      await capturar(page, 'ligacao-teclado', tema);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '1', exact: true })).toHaveCount(0);
      await page.keyboard.press('7');
      // O 5 e o 7 com o teclado fechado não saíram.
      expect((await comandos(page)).filter((c) => c.cmd === 'dtmf').map((c) => c.digitos)).toEqual(['1', '#']);
    });

    test('Áudio chooses the speaker and the microphone of the call', async ({ page }) => {
      await abrir(page, 'ligacao');
      await botao(page, 'Áudio').click();
      const falante = page.getByRole('group', { name: 'Alto-falante' });
      await expect(falante.getByRole('menuitemradio', { name: 'Headset USB' })).toHaveAttribute('aria-checked', 'true');
      await semViolacoesSerias(page);
      await capturar(page, 'ligacao-audio', tema);
      await falante.getByRole('menuitemradio', { name: 'Alto-falantes (Realtek)' }).click();
      await esperarComando(page, { cmd: 'setAudio', altoFalante: 'Alto-falantes (Realtek)' });
      await botao(page, 'Áudio').click();
      await page.getByRole('group', { name: 'Microfone' }).getByRole('menuitemradio', { name: 'Padrão do Windows' }).click();
      await esperarComando(page, { cmd: 'setAudio', microfone: '' });
    });

    test('a call that rings in the main window shows Recusar and Atender', async ({ page }) => {
      await abrir(page, 'tocando-antes-de-carregar');
      await verTextos(page, ['Ligação recebida · Recepção', 'Carlos Lima', 'Ramal 2007', 'Recusar', 'Atender']);
      for (const nome of ['Mudo', 'Teclado', 'Espera', 'Transferir', 'Desligar']) await expect(botao(page, nome), nome).toHaveCount(0);
      await semViolacoesSerias(page);
      await capturar(page, 'ligacao-recebida', tema);
      await botao(page, 'Recusar').click();
      await esperarComando(page, { cmd: 'reject' });
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    });

    test('the notice fits 380×168 and sends answer and reject', async ({ page }) => {
      await audioFalso(page);
      await abrirAviso(page, 'aviso');
      await verTextos(page, ['Ligação recebida · Recepção', 'Ana Souza', 'Ramal 2003', 'Recusar', 'Atender']);
      const medidas = await page.evaluate(() => ({
        largura: document.documentElement.scrollWidth,
        altura: document.documentElement.scrollHeight,
        corpo: [document.body.scrollWidth, document.body.scrollHeight],
      }));
      expect(medidas).toEqual({ largura: 380, altura: 168, corpo: [380, 168] });
      for (const nome of ['Recusar', 'Atender']) {
        const caixa = (await botao(page, nome).boundingBox())!;
        expect(caixa.x).toBeGreaterThanOrEqual(0);
        expect(caixa.y).toBeGreaterThanOrEqual(0);
        expect(caixa.x + caixa.width).toBeLessThanOrEqual(380);
        expect(caixa.y + caixa.height).toBeLessThanOrEqual(168);
      }
      const fundo = await page.locator('.aviso').evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(fundo).toContain('linear-gradient');
      await semViolacoesSerias(page);
      await capturar(page, 'aviso', tema);
      // O toque é da janela principal: o aviso não toca (nada de som em dobro).
      expect(await audio(page)).toEqual([]);

      await botao(page, 'Recusar').click();
      await esperarComando(page, { cmd: 'reject' });
      await page.reload();
      await expect(page.locator('body[data-pronto]')).toHaveCount(1);
      await botao(page, 'Atender').click();
      await esperarComando(page, { cmd: 'answer' });
      expect((await comandos(page))[0]).toEqual({ v: 1, cmd: 'ready' });
    });
  });
}

test.describe('ligação e toque', () => {
  test('the call screen shows a call that was ringing before the page loaded', async ({ page }) => {
    await audioFalso(page);
    await abrir(page, 'tocando-antes-de-carregar');
    // O cenário só responde ao `ready`: o estado e o toque chegam depois dele.
    expect((await comandos(page))[0]).toEqual({ v: 1, cmd: 'ready' });
    await verTextos(page, ['Ligação recebida · Recepção', 'Carlos Lima']);
    await expect.poll(async () => (await audio(page)).map((a) => a.oscillators.map((o) => [o.frequency, o.started, o.stopped]))).toEqual([[[425, true, false]]]);
    // Recarregar (a interface de novo): o `ready` traz outra vez a ligação e o toque.
    await page.reload();
    await expect(page.locator('body[data-pronto]')).toHaveCount(1);
    await verTextos(page, ['Ligação recebida · Recepção', 'Carlos Lima']);
    await expect.poll(async () => (await audio(page)).length).toBe(1);
    await expect.poll(async () => (await audio(page))[0].oscillators[0]?.started).toBe(true);
    await botao(page, 'Atender').click();
    await esperarComando(page, { cmd: 'answer' });
    await verTextos(page, ['Em ligação', 'Carlos Lima']);
    // O C++ (falso) para o toque ao atender.
    await expect.poll(async () => (await audio(page))[0].oscillators[0].stopped).toBe(true);
  });

  test('the call timer counts from activeSinceMs', async ({ page }) => {
    const agora = new Date('2026-10-21T14:00:00-03:00').getTime();
    await page.clock.setFixedTime(agora);
    await abrir(page, 'ligacao');
    await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, activeSinceMs: agora - 192_000 } } }));
    await expect(page.locator('.timer')).toHaveText('03:12');
    await page.clock.setFixedTime(agora + 5_000);
    await expect(page.locator('.timer')).toHaveText('03:17');
    await page.clock.setFixedTime(agora + 3_600_000);
    await expect(page.locator('.timer')).toHaveText('1:03:12');
    // Atendida aqui, ainda sem a confirmação do motor (activeSinceMs 0): sem tempo.
    await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, activeSinceMs: 0 } } }));
    await expect(page.locator('.timer')).toHaveText('Conectando…');
  });

  test('a dialing card without an id hangs up with id 0', async ({ page }) => {
    await abrir(page, 'ligacao');
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: { ...s.ligacao, top: { ...s.ligacao.top, id: 0, number: '2010', name: '', phase: 'dialing', activeSinceMs: 0 } },
    }));
    await verTextos(page, ['2010', 'Chamando…']);
    for (const nome of ['Teclado', 'Espera', 'Transferir', 'Nova ligação']) await expect(botao(page, nome), nome).toBeDisabled();
    await botao(page, 'Desligar').click();
    await esperarComando(page, { cmd: 'hangup', id: 0 });
    expect(await vezes(page, { cmd: 'hangup' })).toBe(0);
  });

  test('the ring follows the ring messages', async ({ page }) => {
    const inicio = new Date('2026-10-21T14:00:00-03:00').getTime();
    await page.clock.install({ time: inicio });
    await audioFalso(page);
    await abrir(page, 'principal');
    // O relógio parado: só anda com o runFor (as mensagens da ponte falsa também saem por um setTimeout).
    await page.clock.pauseAt(inicio + 120_000);
    const mandar = async (tipo: string) => {
      await empurrar(page, { v: 1, type: 'ring', tipo });
      await page.clock.runFor(10);
    };

    // Completo: o oscilador de 425 Hz, 1 s ligado e 4 s desligado.
    await mandar('completo');
    await expect.poll(async () => (await audio(page)).length).toBe(1);
    let [ctx] = await audio(page);
    expect(ctx.oscillators).toEqual([{ type: 'sine', frequency: 425, started: true, stopped: false }]);
    expect(ctx.resumed).toBe(true);
    let t = toques(ctx.gains[0]);
    expect(t.liga).toHaveLength(1);
    expect(t.desliga[0] - t.liga[0]).toBeCloseTo(1, 1);
    await page.clock.runFor(4_000);
    expect(toques((await audio(page))[0].gains[0]).liga).toHaveLength(1);
    await page.clock.runFor(1_100);
    t = toques((await audio(page))[0].gains[0]);
    expect(t.liga).toHaveLength(2);
    expect(t.liga[1] - t.liga[0]).toBeCloseTo(5, 1);

    // Parar: encerra na hora, e nada mais toca depois.
    await mandar('parar');
    [ctx] = await audio(page);
    expect(ctx.oscillators[0].stopped).toBe(true);
    expect(ctx.closed).toBe(true);
    await page.clock.runFor(10_000);
    expect(toques((await audio(page))[0].gains[0]).liga).toHaveLength(2);

    // Espera: o bipe de 0,2 s a cada 3 s.
    await mandar('espera');
    expect(await audio(page)).toHaveLength(2);
    ctx = (await audio(page))[1];
    expect(ctx.oscillators[0]).toMatchObject({ frequency: 425, started: true, stopped: false });
    t = toques(ctx.gains[0]);
    expect(t.liga).toHaveLength(1);
    expect(t.desliga[0] - t.liga[0]).toBeCloseTo(0.2, 1);
    await page.clock.runFor(2_900);
    expect(toques((await audio(page))[1].gains[0]).liga).toHaveLength(1);
    await page.clock.runFor(200);
    t = toques((await audio(page))[1].gains[0]);
    expect(t.liga).toHaveLength(2);
    expect(t.liga[1] - t.liga[0]).toBeCloseTo(3, 1);

    // Do bipe para o toque completo (a primeira acabou com a segunda tocando): um toque só por vez.
    await mandar('completo');
    const todos = await audio(page);
    expect(todos).toHaveLength(3);
    expect(todos[1].closed).toBe(true);
    expect(todos[1].oscillators[0].stopped).toBe(true);
    expect(todos.filter((a) => !a.closed)).toHaveLength(1);
    await mandar('parar');
    expect((await audio(page)).every((a) => a.closed)).toBe(true);
  });

  test('the ring plays on the Toque device and on the default when it cannot', async ({ page }) => {
    await audioFalso(page);
    await abrir(page, 'principal');
    await mudarEstado(page, (s) => ({ ...s, audio: { ...s.audio, toque: 'saida-toque-1' } }));
    await expect.poll(async () => (await estado(page)).audio.toque).toBe('saida-toque-1');
    await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
    await expect.poll(async () => (await audio(page))[0]?.oscillators[0]?.started).toBe(true);
    expect((await audio(page))[0].sinkId).toBe('saida-toque-1');
    await empurrar(page, { v: 1, type: 'ring', tipo: 'parar' });
    await expect.poll(async () => (await audio(page))[0].closed).toBe(true);

    // Sem permissão (ou o dispositivo sumiu): toca no padrão do mesmo jeito.
    await page.evaluate(() => ((window as unknown as Record<string, unknown>).__audioSinkFalha = true));
    await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
    await expect.poll(async () => (await audio(page))[1]?.oscillators[0]?.started).toBe(true);
    expect((await audio(page))[1].sinkId).toBe('');
  });

  test('the ring with the real AudioContext starts and stops without errors', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await abrir(page, 'principal');
    await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
    await page.waitForTimeout(300);
    await empurrar(page, { v: 1, type: 'ring', tipo: 'espera' });
    await page.waitForTimeout(300);
    await empurrar(page, { v: 1, type: 'ring', tipo: 'parar' });
    await page.waitForTimeout(300);
    expect(erros).toEqual([]);
  });

  test('the notice shows the second call that rings and nothing without one', async ({ page }) => {
    await abrirAviso(page, 'ligacao-segunda');
    await verTextos(page, ['Ligação recebida · Recepção', 'Carlos Lima', 'Ramal 2007']);
    await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: null, secondKind: 'none' } }));
    await expect(page.getByText('Carlos Lima')).toHaveCount(0);
    await expect(botao(page, 'Atender')).toHaveCount(0);
  });
});
