// A ponte falsa com a sala: o C++ de mentira responde aos comandos da sala, e aos de sempre com a sala de pé, como o
// núcleo (docs/ponte-windows.md, "A sala de vídeo (0.4.0)"). Ela é o núcleo de mentira de toda spec da sala. Cada comando
// é tratado na hora, dentro do `mandar`; só os convidados e a Nova ligação atendem depois (1,5 s).
import { expect, test, type Page } from '@playwright/test';
import { arrumacao } from '../../src/sala/mosaico';
import { SEM_VIDEO } from '../../src/video/estado';
import { abrir, audio, audioFalso, estado } from '../helpers';

const mandar = (page: Page, comando: Record<string, unknown>) =>
  page.evaluate((c) => (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake.mandar(c), comando);
/** A ligação de agora do C++ de mentira. */
const ligacao = async (page: Page) => (await estado(page)).ligacao;
/** O `video` da linha da sala nos cenários: o mosaico chegando e a nossa câmera chegando aos convidados. */
const VIDEO_DA_SALA = { oferece: false, ativo: true, imagem: true, camera: true, cedo: false, porteiro: false };

test('the fake core carries the room like the core', async ({ page }) => {
  await abrir(page, 'sala');
  const l = await ligacao(page);
  expect(l.top).toEqual({
    id: 30,
    number: '',
    name: '',
    incoming: false,
    phase: 'active',
    activeSinceMs: expect.any(Number),
    held: false,
    video: VIDEO_DA_SALA,
  });
  // De pé há 5 min 41 s.
  expect(Date.now() - l.top.activeSinceMs).toBeGreaterThanOrEqual(341_000);
  expect(Date.now() - l.top.activeSinceMs).toBeLessThan(371_000);
  expect(l).toMatchObject({ second: null, secondKind: 'none', conference: false, consulting: false });
  expect(l.sala).toEqual({
    id: 30,
    fora: false,
    cheia: false,
    participantes: [
      { id: 11, numero: '2003', nome: 'Ana Souza', estado: 'naSala', imagem: true, quadro: arrumacao(2)[0] },
      { id: 12, numero: '2007', nome: 'Carlos Lima', estado: 'naSala', imagem: true, quadro: arrumacao(2)[1] },
    ],
  });

  await abrir(page, 'video');
  expect((await ligacao(page)).sala).toBeNull();
  // O convidado vê uma videochamada comum: só quem montou tem a sala.
  await abrir(page, 'sala-convidado');
  const s = await estado(page);
  expect(s.conta).toMatchObject({ nome: 'Ana Souza', ramal: '2003' });
  expect(s.ligacao.top).toMatchObject({ id: 11, number: '2001', name: 'Recepção', phase: 'active', video: { ativo: true, imagem: true, camera: true } });
  expect(s.ligacao.sala).toBeNull();
});

test('salaAdicionar from a video call starts the room with the call inside', async ({ page }) => {
  await abrir(page, 'video');
  const ana = (await ligacao(page)).top;
  await mandar(page, { cmd: 'salaAdicionar', numero: '2007', contato: true });
  const l = await ligacao(page);
  // A linha da sala nasce no lugar da ligação, com o tempo dela; a ligação entra como o primeiro convidado.
  expect(l.top).toEqual({
    id: 41,
    number: '',
    name: '',
    incoming: false,
    phase: 'active',
    activeSinceMs: ana.activeSinceMs,
    held: false,
    video: VIDEO_DA_SALA,
  });
  expect(l).toMatchObject({ second: null, secondKind: 'none' });
  const carlos = { id: 42, numero: '2007', nome: 'Carlos Lima', estado: 'chamando', imagem: false, quadro: arrumacao(2)[1] };
  expect(l.sala).toEqual({
    id: 41,
    fora: false,
    cheia: false,
    participantes: [{ id: 11, numero: '2003', nome: 'Ana Souza', estado: 'naSala', imagem: true, quadro: arrumacao(2)[0] }, carlos],
  });
  await expect
    .poll(async () => (await ligacao(page)).sala.participantes[1], { timeout: 3_000 })
    .toEqual({ ...carlos, estado: 'naSala', imagem: true });
});

test('the room grows to five and fills up', async ({ page }) => {
  await abrir(page, 'sala');
  await mandar(page, { cmd: 'salaAdicionar', numero: '2005' });
  await mandar(page, { cmd: 'salaAdicionar', numero: '2006' });
  expect((await ligacao(page)).sala.cheia).toBe(false);
  await mandar(page, { cmd: 'salaAdicionar', numero: '2008' });
  let sala = (await ligacao(page)).sala;
  expect(sala.participantes.map((p: { id: number; numero: string; estado: string }) => [p.id, p.numero, p.estado])).toEqual([
    [11, '2003', 'naSala'],
    [12, '2007', 'naSala'],
    [41, '2005', 'chamando'],
    [42, '2006', 'chamando'],
    [43, '2008', 'chamando'],
  ]);
  expect(sala.participantes.map((p: { quadro: unknown }) => p.quadro)).toEqual(arrumacao(5));
  expect(sala.cheia).toBe(true);

  // Cheia, mesmo com todos atendidos, um sexto não entra.
  await expect
    .poll(async () => (await ligacao(page)).sala.participantes.map((p: { estado: string }) => p.estado), { timeout: 3_000 })
    .toEqual(['naSala', 'naSala', 'naSala', 'naSala', 'naSala']);
  sala = (await ligacao(page)).sala;
  await mandar(page, { cmd: 'salaAdicionar', numero: '2010' });
  expect((await ligacao(page)).sala).toEqual(sala);
});

test('salaAdicionar does nothing out of the rules', async ({ page }) => {
  // Sem ligação, numa só com a voz, com você fora da sala e com a sala cheia.
  for (const cenario of ['principal', 'ligacao', 'sala-fora', 'sala-cheia']) {
    await abrir(page, cenario);
    const antes = await ligacao(page);
    await mandar(page, { cmd: 'salaAdicionar', numero: '2005' });
    expect(await ligacao(page), cenario).toEqual(antes);
  }
  // Sem número.
  await abrir(page, 'sala');
  const antes = await ligacao(page);
  await mandar(page, { cmd: 'salaAdicionar', numero: ' ' });
  expect(await ligacao(page)).toEqual(antes);
});

test('salaTirar takes the guest out, and with one guest left the room is a call again', async ({ page }) => {
  await abrir(page, 'sala-estados');
  const linha = (await ligacao(page)).top;
  await mandar(page, { cmd: 'salaTirar', id: 12 });
  const sala = (await ligacao(page)).sala;
  expect(sala.participantes.map((p: { id: number }) => p.id)).toEqual([11, 13, 14]);
  expect(sala.participantes.map((p: { quadro: unknown }) => p.quadro)).toEqual(arrumacao(3));
  // O id da sala, ou o de ninguém: nada.
  for (const id of [30, 99]) {
    await mandar(page, { cmd: 'salaTirar', id });
    expect((await ligacao(page)).sala, String(id)).toEqual(sala);
  }
  // A Bia fica sozinha: a ligação dela, com a imagem dela (nenhuma) e a câmera da sala.
  await mandar(page, { cmd: 'salaTirar', id: 11 });
  await mandar(page, { cmd: 'salaTirar', id: 14 });
  let l = await ligacao(page);
  expect(l.sala).toBeNull();
  expect(l.top).toMatchObject({ id: 13, number: '2005', name: 'Bia Ramos', phase: 'active', activeSinceMs: linha.activeSinceMs, held: false });
  expect(l.top.video).toMatchObject({ ativo: true, imagem: false, camera: true });

  // Quem fica ainda chamando volta como uma feita que chama.
  await abrir(page, 'sala-estados');
  for (const id of [11, 13, 14]) await mandar(page, { cmd: 'salaTirar', id });
  l = await ligacao(page);
  expect(l.sala).toBeNull();
  expect(l.top).toMatchObject({ id: 12, number: '2007', name: 'Carlos Lima', phase: 'dialing', activeSinceMs: 0 });

  // A Ana fica com a câmera da sala, aqui desligada.
  await abrir(page, 'sala');
  await mandar(page, { cmd: 'camera', on: false });
  await mandar(page, { cmd: 'salaTirar', id: 12 });
  l = await ligacao(page);
  expect(l.sala).toBeNull();
  expect(l.top).toMatchObject({ id: 11, number: '2003', name: 'Ana Souza', phase: 'active', held: false });
  expect(l.top.video).toMatchObject({ imagem: true, camera: false });
  expect(l.second).toBeNull();

  // Com você fora, quem fica toma o lugar da sala embaixo, em espera.
  await abrir(page, 'sala-fora');
  await mandar(page, { cmd: 'salaTirar', id: 12 });
  l = await ligacao(page);
  expect(l.sala).toBeNull();
  expect(l.top).toMatchObject({ id: 16, held: false });
  expect(l.second).toMatchObject({ id: 11, number: '2003', name: 'Ana Souza', phase: 'active', held: true });
  expect(l.secondKind).toBe('held');
});

test('salaEncerrar and the hangup of the room line end the room', async ({ page }) => {
  await audioFalso(page);
  await abrir(page, 'sala');
  await mandar(page, { cmd: 'salaEncerrar' });
  expect(await ligacao(page)).toBeNull();

  // O hangup sem id, com a sala em cima, é o salaEncerrar; o id de um convidado não faz nada.
  await abrir(page, 'sala');
  const antes = await ligacao(page);
  await mandar(page, { cmd: 'hangup', id: 12 });
  expect(await ligacao(page)).toEqual(antes);
  await mandar(page, { cmd: 'hangup' });
  expect(await ligacao(page)).toBeNull();

  // A ligação de fora fica sozinha em cima, fora da espera: a que estava em espera embaixo da sala, e a de cima com a
  // sala embaixo.
  for (const [cenario, comando] of [
    ['sala-de-volta', { cmd: 'hangup', id: 30 }],
    ['sala-fora', { cmd: 'salaEncerrar' }],
  ] as const) {
    await abrir(page, cenario);
    await mandar(page, comando);
    const l = await ligacao(page);
    expect(l.top, cenario).toMatchObject({ id: 16, number: '2012', name: 'Roberto Lima', phase: 'active', held: false });
    expect(l, cenario).toMatchObject({ second: null, secondKind: 'none', sala: null });
  }

  // A que ainda toca segue tocando, sozinha: o bipe de espera dá lugar ao toque completo.
  await abrir(page, 'sala-ligacao-de-fora');
  await expect.poll(async () => (await audio(page))[0]?.oscillators[0]?.started).toBe(true);
  await mandar(page, { cmd: 'salaEncerrar' });
  const l = await ligacao(page);
  expect(l.top).toMatchObject({ id: 16, incoming: true, phase: 'ringing', held: false });
  expect(l).toMatchObject({ second: null, secondKind: 'none', sala: null });
  await expect.poll(async () => (await audio(page)).length).toBe(2);
  expect((await audio(page))[0].closed).toBe(true);
});

test('the outside call: answer takes you out, salaVoltar brings you back with it on hold, swap and its end', async ({ page }) => {
  await audioFalso(page);
  await abrir(page, 'sala-ligacao-de-fora');
  // O Roberto toca como a segunda, com o bipe de espera.
  expect((await ligacao(page)).second).toMatchObject({ id: 16, incoming: true, phase: 'ringing' });
  await expect.poll(async () => (await audio(page))[0]?.oscillators[0]?.started).toBe(true);

  // O answer, também com o video: true, o atende só com a voz e tira você da sala; o bipe para.
  await mandar(page, { cmd: 'answer', video: true });
  let l = await ligacao(page);
  expect(l.top).toMatchObject({ id: 16, number: '2012', name: 'Roberto Lima', phase: 'active', held: false });
  expect(l.top.activeSinceMs).toBeGreaterThan(0);
  expect(l.top.video).toMatchObject({ ativo: false, imagem: false, camera: false });
  expect(l.second).toMatchObject({ id: 30, held: true });
  expect(l.secondKind).toBe('held');
  expect(l.sala.fora).toBe(true);
  await expect.poll(async () => (await audio(page))[0].closed).toBe(true);
  expect(await audio(page)).toHaveLength(1);

  const onde = async () => {
    const agora = await ligacao(page);
    return { cima: agora.top.id, cimaEmEspera: agora.top.held, baixo: agora.second?.id ?? null, baixoEmEspera: agora.second?.held ?? null, fora: agora.sala.fora };
  };
  // O salaVoltar põe a sala em cima e o Roberto em espera.
  await mandar(page, { cmd: 'salaVoltar' });
  expect(await onde()).toEqual({ cima: 30, cimaEmEspera: false, baixo: 16, baixoEmEspera: true, fora: false });
  expect((await ligacao(page)).secondKind).toBe('held');
  // O swap tira você de novo, e o hold do Roberto, com a sala embaixo, o troca de volta.
  await mandar(page, { cmd: 'swap' });
  expect(await onde()).toEqual({ cima: 16, cimaEmEspera: false, baixo: 30, baixoEmEspera: true, fora: true });
  await mandar(page, { cmd: 'hold' });
  expect(await onde()).toEqual({ cima: 30, cimaEmEspera: false, baixo: 16, baixoEmEspera: true, fora: false });
  await mandar(page, { cmd: 'swap' });
  // O fim do Roberto traz a sala de volta, sozinha.
  await mandar(page, { cmd: 'hangup', id: 16 });
  expect(await onde()).toEqual({ cima: 30, cimaEmEspera: false, baixo: null, baixoEmEspera: null, fora: false });
  expect((await ligacao(page)).secondKind).toBe('none');
});

test('a guest who only rings or is busy', async ({ page }) => {
  await abrir(page, 'sala');
  const chamados = Date.now();
  await mandar(page, { cmd: 'salaAdicionar', numero: '180' });
  await mandar(page, { cmd: 'salaAdicionar', numero: '486' });
  const participantes = async (): Promise<Array<Record<string, unknown>>> => (await ligacao(page)).sala.participantes;
  expect((await participantes()).map((p) => [p.numero, p.estado])).toEqual([
    ['2003', 'naSala'],
    ['2007', 'naSala'],
    ['180', 'chamando'],
    ['486', 'chamando'],
  ]);
  // O 486 sai com o motivo, e os outros voltam à arrumação de três.
  await expect.poll(async () => (await participantes()).map((p) => p.numero), { timeout: 3_000 }).toEqual(['2003', '2007', '180']);
  await expect(page.getByRole('status').filter({ hasText: '486: Ocupado' })).toBeVisible();
  expect((await participantes()).map((p) => p.quadro)).toEqual(arrumacao(3));
  // O 180 segue chamando depois de 3 s.
  await page.waitForTimeout(Math.max(0, chamados + 3_000 - Date.now()));
  expect((await participantes())[2]).toMatchObject({ id: 41, numero: '180', estado: 'chamando', imagem: false });
});

test('with the room up, hold, transfer, consult, dtmf, join and split change nothing', async ({ page }) => {
  const nada = async (cenario: string, comandos: Array<Record<string, unknown>>) => {
    await abrir(page, cenario);
    const antes = await ligacao(page);
    for (const comando of comandos) {
      await mandar(page, comando);
      expect(await ligacao(page), `${cenario}: ${JSON.stringify(comando)}`).toEqual(antes);
    }
  };
  const naSala = [
    { cmd: 'hold' },
    { cmd: 'hold', on: true },
    { cmd: 'transfer', numero: '2010' },
    { cmd: 'consult', numero: '2010' },
    { cmd: 'dtmf', digitos: '1' },
    { cmd: 'join' },
    { cmd: 'split' },
  ];
  await nada('sala', naSala);
  // Também com a ligação de fora em espera embaixo da sala.
  await nada('sala-de-volta', naSala);
  // Com você fora, os convidados não entram numa conferência com a ligação de fora.
  await nada('sala-fora', [{ cmd: 'join' }, { cmd: 'split' }]);
});

test("the outside call's transfer ends only it and brings the room back", async ({ page }) => {
  await abrir(page, 'sala-fora');
  const sala = (await ligacao(page)).sala;
  await mandar(page, { cmd: 'transfer', numero: '2010' });
  const l = await ligacao(page);
  expect(l.top).toMatchObject({ id: 30, number: '', held: false });
  expect(l).toMatchObject({ second: null, secondKind: 'none' });
  expect(l.sala).toEqual({ ...sala, fora: false });
});

test('dial with the room standing is a voice-only outside call, and salaVoltar cancels it while it still rings', async ({ page }) => {
  await abrir(page, 'sala');
  // A Nova ligação, também com o video: true, vai em cima só com a voz e tira você da sala; o outro lado atende.
  await mandar(page, { cmd: 'dial', numero: '2010', video: true });
  let l = await ligacao(page);
  expect(l.top).toEqual({ id: 41, number: '2010', name: 'Financeiro', incoming: false, phase: 'dialing', activeSinceMs: 0, held: false, video: SEM_VIDEO });
  expect(l.second).toMatchObject({ id: 30, held: true });
  expect(l.secondKind).toBe('held');
  expect(l.sala.fora).toBe(true);
  await expect.poll(async () => (await ligacao(page)).top.phase, { timeout: 3_000 }).toBe('active');
  expect((await ligacao(page)).top.video).toEqual(SEM_VIDEO);
  // Atendida, o salaVoltar a põe em espera.
  await mandar(page, { cmd: 'salaVoltar' });
  l = await ligacao(page);
  expect([l.top.id, l.second.id, l.second.held, l.sala.fora]).toEqual([30, 41, true, false]);
  await mandar(page, { cmd: 'hangup', id: 41 });
  expect((await ligacao(page)).second).toBeNull();

  // A que ainda chama (o 180 só toca): o swap e o hold não a trocam; o salaVoltar a desliga, sem aviso, e a sala volta
  // sozinha.
  await mandar(page, { cmd: 'dial', numero: '180' });
  const chamando = await ligacao(page);
  expect(chamando.top).toMatchObject({ id: 42, number: '180', phase: 'dialing' });
  for (const comando of [{ cmd: 'swap' }, { cmd: 'hold' }]) {
    await mandar(page, comando);
    expect(await ligacao(page), comando.cmd).toEqual(chamando);
  }
  await mandar(page, { cmd: 'salaVoltar' });
  l = await ligacao(page);
  expect(l.top).toMatchObject({ id: 30, held: false });
  expect(l).toMatchObject({ second: null, secondKind: 'none' });
  expect(l.sala.fora).toBe(false);
  await page.waitForTimeout(300);
  await expect(page.locator('.toast-box')).toHaveCount(0);
});

test('the iPhone fake has no room', async ({ page }) => {
  await page.goto('/index.html?fake=sala&plataforma=ios');
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
  const antes = await ligacao(page);
  expect(antes.sala).toBeNull();
  for (const comando of [{ cmd: 'salaAdicionar', numero: '2005' }, { cmd: 'salaTirar', id: 12 }, { cmd: 'salaVoltar' }, { cmd: 'salaEncerrar' }]) {
    await mandar(page, comando);
    expect(await ligacao(page), comando.cmd).toEqual(antes);
  }
});
