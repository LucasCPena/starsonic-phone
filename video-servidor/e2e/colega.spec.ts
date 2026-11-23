// O colega pela página da reunião, de ponta a ponta (a etapa 2a): a Ana Souza abre a página com o passe que o app dela
// pede ao chat, no navegador (o #p= do endereço) e dentro do app de mentira (o cliente/app-falso.html, que mostra a
// página num iframe e conversa com ela por postMessage). Ela entra sem a sala de espera, responde aos pedidos de quem é
// de fora, tira e encerra pela página, e a pausa (a do app e a do canal) cala a reunião para ela e ela para a reunião.
// Cada navegador é uma pessoa, com a câmera de uma cor e o microfone de um tom (midia.ts): a Ana é a A, a Maria Lima é a
// C e a Bia Ramos é a B. Cada passe e cada chave do colega ficam anotados, e o último teste confere os registros.
import { expect, test } from '@playwright/test';
import { A, AMARELO, APARELHOS, B, C, CIANO, MOSAICO_1, MOSAICO_2, perto, TELA_2, VERDE, VERMELHO } from './midia';
import { repetirAte } from './espera';
import { Pagina, telaVerde } from './navegador';
import {
  ana,
  computadorDeOutraEmpresa,
  ligacoesPrincipais,
  papelDaSenha,
  segredosNosRegistros,
  segredosUsados,
  type Computador,
  type EventosDoApp,
} from './servidores';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** No navegador (no quadro da reunião): a página está na tela da reunião, em pausa — o Microfone e a Câmera dos
 * controles desligados, nenhuma câmera acesa e o som da reunião calado —, e o Date.now da leitura. */
function pausaNaTela(): { pausada: boolean; agora: number } {
  const controles = document.querySelector('nav[aria-label="Controles da reunião"]');
  const botao = (b: string) => controles?.querySelector(`[data-botao="${b}"]`)?.getAttribute('aria-pressed');
  const som = document.getElementById('som') as HTMLAudioElement | null;
  const cameras = (window as unknown as { camerasDoTeste?: MediaStreamTrack[] }).camerasDoTeste ?? [];
  const pausada =
    controles !== null &&
    controles.closest('[hidden]') === null &&
    botao('microfone') === 'false' &&
    botao('camera') === 'false' &&
    cameras.every((t) => t.readyState !== 'live') &&
    som?.muted === true;
  return { pausada, agora: Date.now() };
}

/** O cartão do pedido na página do colega. */
const cartao = (p: Pagina, nome: string) => p.tela.getByRole('region', { name: `${nome} quer entrar`, exact: true });
/** O cartão da pausa que chega pelo canal. */
const cartaoDaPausa = (p: Pagina) =>
  p.tela.getByRole('alertdialog', {
    name: 'Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você.',
    exact: true,
  });
const voltarDaPausa = (p: Pagina) => cartaoDaPausa(p).locator('[data-botao="voltarDaPausa"]');
const botaoDosControles = (p: Pagina, nome: string) => p.controles().getByRole('button', { name: nome, exact: true });

/** A pessoa de fora pede, e o colega aceita pelo cartão da página dele, que aparece em até 2 s. */
async function pedirEAceitarPelaPagina(colega: Pagina, fora: Pagina, codigo: string, nome: string): Promise<void> {
  await fora.entrar(codigo, nome);
  await expect(cartao(colega, nome)).toBeVisible({ timeout: 2_000 });
  await cartao(colega, nome).getByRole('button', { name: 'Aceitar', exact: true }).click();
  await expect(fora.controles()).toBeVisible({ timeout: 30_000 });
}

/** A Ana em pausa, em até prazo ms: a Maria não ouve o tom dela e vê o quadro dela sem imagem, e a página da Ana não
 * toca o som da reunião (o tom da Maria). */
async function aAnaEmPausa(anaP: Pagina, maria: Pagina, prazo: number): Promise<void> {
  await Promise.all([
    maria.esperarSemFrequencia(A.som, prazo),
    expect(maria.quadro('Ana Souza')).toHaveAttribute('data-mostra', 'sem-camera', { timeout: prazo }),
    expect.poll(() => anaP.tocaOSom(), { message: 'a página da Ana toca o som', timeout: prazo }).toBe(false),
  ]);
}

/** A Ana de volta, em até prazo ms: a Maria ouve o tom dela e vê a cor dela no quadro dela, e a página da Ana toca o
 * tom da Maria; o microfone e a câmera da Ana estão ligados, como ela entrou. */
async function aAnaDeVolta(anaP: Pagina, maria: Pagina, prazo: number): Promise<void> {
  await Promise.all([
    maria.esperarFrequencia(A.som, prazo),
    expect(maria.quadro('Ana Souza')).toHaveAttribute('data-mostra', 'video', { timeout: prazo }),
    expect
      .poll(async () => perto(await maria.corDoQuadro('Ana Souza'), VERMELHO), {
        message: 'o vermelho no quadro da Ana, na página da Maria',
        timeout: prazo,
      })
      .toBe(true),
    expect.poll(() => anaP.tocaOSom(), { message: 'a página da Ana toca o som', timeout: prazo }).toBe(true),
    anaP.esperarFrequencia(C.som, prazo),
  ]);
  await expect(botaoDosControles(anaP, 'Microfone')).toHaveAttribute('aria-pressed', 'true');
  await expect(botaoDosControles(anaP, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
}

// --- No navegador, com o passe no endereço ------------------------------------------------------------------------

test.describe.serial('o colega pela página, no navegador', () => {
  let codigo = '';
  let app: Computador | undefined;
  let eventos: EventosDoApp | undefined;
  let anaP: Pagina | undefined;
  let maria: Pagina | undefined;
  let bia: Pagina | undefined;
  let pedidoDaMaria = '';

  test.afterAll(async () => {
    eventos?.fechar();
    await bia?.fechar();
    await maria?.fechar();
    await anaP?.fechar();
  });

  test('o colega entra direto pelo passe', async () => {
    app = ana();
    codigo = await app.criarMarcada();
    eventos = await app.eventos();
    anaP = await Pagina.abrir(A);
    await anaP.entrarComoColega(codigo, await app.passe(codigo));
    await expect(anaP.controles()).toBeVisible({ timeout: 30_000 });
    await anaP.esperarCores(MOSAICO_1, [VERMELHO]);

    // O passe saiu do endereço, e a página entrou sem a sala de espera.
    expect(new URL(anaP.page.url()).hash, 'o fim do endereço depois do carregar').toBe('');
    const tipos = anaP.mensagensRecebidas().map((m) => m.tipo);
    expect(tipos.filter((t) => t === 'aguardando' || t === 'naoComecou'), 'a espera').toEqual([]);
    expect(anaP.mensagensMandadas().map((m) => m.tipo), 'o que a página mandou').not.toContain('pedir');

    // O quadro dela leva o nome do cadastro, e a ligação dela, no agente, é a de uma colega.
    await expect
      .poll(() => {
        const palco = anaP!.mensagensRecebidas().filter((m) => m.tipo === 'palco').at(-1);
        return palco?.quadros?.find((q: { voce?: boolean }) => q.voce)?.nome;
      })
      .toBe('Ana Souza');
    await anaP.esperarQuadros(['Você']);
    const aceito = anaP.mensagensRecebidas().find((m) => m.tipo === 'aceito');
    expect(papelDaSenha(aceito?.senha ?? ''), 'o papel da senha da Ana').toBe('colega');
    await expect.poll(() => ligacoesPrincipais(anaP!.participante()), { message: 'as ligações da Ana no agente' }).toBe(1);
    await anaP.conferirOConsole();
  });

  test('quem é de fora pede, e o colega aceita pela página', async () => {
    if (!anaP) throw new Error('o teste anterior não pôs a Ana na reunião');
    maria = await Pagina.abrir(C);
    await pedirEAceitarPelaPagina(anaP, maria, codigo, 'Maria Lima');
    await anaP.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarFrequencia(A.som);
    await anaP.esperarFrequencia(C.som);
    await expect(cartao(anaP, 'Maria Lima')).toBeHidden();
    await anaP.conferirOConsole();
    await maria.conferirOConsole();
  });

  test('o app também fica sabendo', async () => {
    if (!eventos) throw new Error('o primeiro teste não abriu os eventos do app');
    const pedido = await eventos.esperar(
      (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Maria Lima',
    );
    pedidoDaMaria = pedido.pedido.id;
    await eventos.esperar((e) => e.tipo === 'reuniaoPedidoFim' && e.reuniao === codigo && e.pedido === pedidoDaMaria);
  });

  test('o aceitar pelo app vale para a página', async () => {
    if (!anaP || !app || !eventos) throw new Error('o primeiro teste não pôs a Ana na reunião');
    bia = await Pagina.abrir(B);
    await bia.entrar(codigo, 'Bia Ramos');
    await expect(cartao(anaP, 'Bia Ramos')).toBeVisible({ timeout: 2_000 });
    const pedido = await eventos.esperar(
      (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Bia Ramos',
    );
    await app.aceitar(codigo, pedido.pedido.id);
    await expect(cartao(anaP, 'Bia Ramos')).toBeHidden({ timeout: 5_000 });
    await expect(bia.controles()).toBeVisible({ timeout: 30_000 });
    await anaP.conferirOConsole();
  });

  test('tirar e encerrar pela página', async () => {
    if (!anaP || !maria || !bia) throw new Error('os testes anteriores não puseram as três na reunião');
    await anaP.tela.locator('button[data-botao="participantes"]').click();
    const painel = anaP.tela.getByRole('complementary', { name: 'Participantes' });
    await expect(painel).toBeVisible();

    // O Tirar em dois cliques: o da pessoa e o da pergunta.
    await anaP.botao('Tirar Maria Lima da reunião').click();
    await expect(anaP.tela.getByText('Tirar Maria Lima?', { exact: true })).toBeVisible();
    await anaP.botao('Tirar').click();
    await expect(maria.titulo('Você foi tirado da reunião')).toBeVisible({ timeout: 10_000 });
    await expect(painel.getByText('Maria Lima', { exact: true })).toHaveCount(0);

    // O Encerrar para todos acaba a reunião para as duas que ficaram.
    await painel.getByRole('button', { name: 'Encerrar para todos', exact: true }).click();
    const dialogo = anaP.tela.getByRole('alertdialog', { name: 'Encerrar a reunião para todos?' });
    await dialogo.getByRole('button', { name: 'Encerrar para todos', exact: true }).click();
    await expect(anaP.titulo('A reunião acabou')).toBeVisible({ timeout: 10_000 });
    await expect(bia.titulo('A reunião acabou')).toBeVisible({ timeout: 10_000 });
    await anaP.conferirOConsole();
    await maria.conferirOConsole();
    await bia.conferirOConsole();
  });
});

// --- Dentro do app de mentira -------------------------------------------------------------------------------------

test.describe.serial('o colega dentro do app de mentira', () => {
  let codigo = '';
  let app: Computador | undefined;
  let anaP: Pagina | undefined;
  let maria: Pagina | undefined;

  test.afterAll(async () => {
    await maria?.fechar();
    await anaP?.fechar();
  });

  test('a página dentro do app de mentira', async () => {
    app = ana();
    codigo = await app.criarMarcada();
    anaP = await Pagina.abrir(A, { doisAparelhos: true });
    await anaP.page.addInitScript(telaVerde);
    // O pronta, o passe por mensagem, a entrada do colega e o Entrar.
    await anaP.entrarComoColega(codigo, await app.passe(codigo), { noApp: true });
    expect(await anaP.esperarDoApp('pronta')).toEqual({ starsonic: 1, tipo: 'pronta' });
    await expect(anaP.controles()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await anaP!.recebidasDoApp()).filter((m) => m.tipo === 'estado').map((m) => m.fase))
      .toEqual(['entrada', 'naReuniao']);

    // A imagem e o som chegam nos dois sentidos.
    maria = await Pagina.abrir(C);
    await pedirEAceitarPelaPagina(anaP, maria, codigo, 'Maria Lima');
    await anaP.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarFrequencia(A.som);
    await anaP.esperarFrequencia(C.som);
    await maria.esperarQuadros(['Ana Souza', 'Você']);
    await anaP.conferirOConsole();
    await maria.conferirOConsole();
  });

  test('a tela compartilhada de dentro do iframe', async () => {
    if (!anaP || !maria) throw new Error('o teste anterior não pôs as duas na reunião');
    await anaP.botao('Compartilhar a tela').click();
    await expect(anaP.tela.getByText('Você está compartilhando a tela', { exact: true })).toBeVisible({ timeout: 20_000 });
    await maria.esperarTamanho(1920, 1620);
    await maria.esperarCores([TELA_2], [VERDE]);
    await anaP.botao('Parar de compartilhar').click();
    await maria.esperarTamanho(1920, 1080);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await anaP.conferirOConsole();
  });

  test('a pausa do app', async () => {
    if (!anaP || !maria) throw new Error('o primeiro teste não pôs as duas na reunião');
    await expect.poll(async () => perto(await maria!.corDoQuadro('Ana Souza'), VERMELHO)).toBe(true);
    await anaP.doApp('pausar');
    await aAnaEmPausa(anaP, maria, 2_000);
    // Dentro do app, o cartão da pausa é do app: a página não o mostra.
    await expect(cartaoDaPausa(anaP)).toBeHidden();
    await anaP.doApp('retomar');
    await aAnaDeVolta(anaP, maria, 2_000);
    await anaP.conferirOConsole();
  });

  test('a troca do microfone e da câmera no meio da reunião', async () => {
    if (!anaP || !maria) throw new Error('o primeiro teste não pôs as duas na reunião');
    // Os segundos aparelhos: a Maria ouve o outro tom, e não o primeiro, e vê a outra cor.
    await anaP.doApp('aparelhos', { aparelhos: APARELHOS.segundos });
    await maria.esperarFrequencia(APARELHOS.som);
    await maria.esperarCores(MOSAICO_2, [CIANO, AMARELO]);
    await expect.poll(async () => perto(await maria!.corDoQuadro('Ana Souza'), CIANO)).toBe(true);
    expect(await anaP.camerasVivas(), 'as câmeras vivas na página da Ana').toBe(1);

    // Os primeiros de volta: o primeiro tom e a primeira cor.
    await anaP.doApp('aparelhos', { aparelhos: APARELHOS.primeiros });
    await maria.esperarFrequencia(A.som);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    expect(await anaP.camerasVivas(), 'as câmeras vivas na página da Ana').toBe(1);
    await expect(botaoDosControles(anaP, 'Microfone')).toHaveAttribute('aria-pressed', 'true');
    await expect(botaoDosControles(anaP, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
    await anaP.conferirOConsole();
  });

  test('o microfone trocado que acaba sozinho', async () => {
    if (!anaP || !maria) throw new Error('o primeiro teste não pôs as duas na reunião');
    // A troca para o segundo microfone, que a Maria ouve.
    await anaP.doApp('aparelhos', { aparelhos: APARELHOS.segundos });
    await maria.esperarFrequencia(APARELHOS.som);
    // Ele acaba sozinho: a Maria deixa de ouvi-lo, e o Microfone da Ana passa a faltar, como o primeiro microfone que
    // acaba; a câmera fica como estava. O app recebe o estado com o microfone desligado.
    await anaP.acabarSozinha('audio');
    await maria.esperarSemFrequencia(APARELHOS.som);
    await expect(botaoDosControles(anaP, 'Microfone')).toBeDisabled();
    await expect(botaoDosControles(anaP, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => (await anaP!.recebidasDoApp()).filter((m) => m.tipo === 'estado').at(-1))
      .toEqual({ starsonic: 1, tipo: 'estado', fase: 'naReuniao', microfone: false });
    await expect(anaP.controles()).toBeVisible();
    await anaP.conferirOConsole();
  });
});

// A pausa que o app manda assim que a página diz que entrou (Ruling 17): o app de mentira a manda sozinho, sem ida e volta
// pelo teste. A Maria, de fora, só entra numa reunião que já começou: ela entra depois, aceita pelo app da Ana.
test('a pausa na hora em que a página entra', async () => {
  const app = ana();
  const codigo = await app.criarMarcada();
  const eventos = await app.eventos();
  let anaP: Pagina | undefined;
  let maria: Pagina | undefined;
  try {
    anaP = await Pagina.abrir(A);
    await anaP.entrarComoColega(codigo, await app.passe(codigo), { noApp: true, pausarAoEntrar: true });
    // A página está em pausa em até 2 s do naReuniao que o app recebeu (a hora que o app de mentira guardou, no mesmo
    // relógio do quadro): o microfone e a câmera desligados, sem a câmera acesa, e o som da reunião calado. A tela é
    // lida de 50 em 50 ms, desde antes da entrada.
    const pausada = await repetirAte(
      30_000,
      50,
      async () => ({ tela: await anaP!.tela.evaluate(pausaNaTela), naReuniaoEm: await anaP!.naReuniaoNoApp() }),
      (l) => l.tela.pausada && l.naReuniaoEm !== null,
      (l) => `a página da Ana não ficou em pausa depois de entrar; a última leitura: ${JSON.stringify(l)}`,
    );
    const demorou = pausada.tela.agora - (pausada.naReuniaoEm as number);
    expect(demorou, 'os ms do naReuniao até a pausa na tela da Ana').toBeLessThanOrEqual(2_000);
    const estados = (await anaP.recebidasDoApp()).filter((m) => m.tipo === 'estado');
    expect(estados.at(-1), 'o último estado que o app recebeu').toEqual({
      starsonic: 1,
      tipo: 'estado',
      fase: 'naReuniao',
      microfone: false,
    });

    maria = await Pagina.abrir(C);
    await maria.entrar(codigo, 'Maria Lima');
    const pedido = await eventos.esperar(
      (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Maria Lima',
    );
    await app.aceitar(codigo, pedido.pedido.id);
    await expect(maria.controles()).toBeVisible({ timeout: 30_000 });
    // Na reunião, com o mosaico chegando, a Maria não ouve nem vê a Ana, e a página da Ana não toca o tom dela; e
    // continua assim (o que não chegou ainda não conta).
    await maria.esperarTamanho(1920, 1080);
    await aAnaEmPausa(anaP, maria, 2_000);
    await esperar(2_000);
    await aAnaEmPausa(anaP, maria, 1_000);

    // O retomar devolve os três em até 2 s, com o microfone e a câmera ligados, como a Ana entrou.
    await anaP.doApp('retomar');
    await aAnaDeVolta(anaP, maria, 2_000);
    await anaP.conferirOConsole();
    await maria.conferirOConsole();
  } finally {
    eventos.fechar();
    await maria?.fechar();
    await anaP?.fechar();
  }
});

// A pausa pela rota do app, que o chat repassa à página do colega no navegador pelo canal (a mensagem pausa), com o
// cartão "Você está numa ligação…".
test('a pausa pelo chat, no navegador', async () => {
  const app = ana();
  const codigo = await app.criarMarcada();
  let anaP: Pagina | undefined;
  let maria: Pagina | undefined;
  try {
    anaP = await Pagina.abrir(A);
    await anaP.entrarComoColega(codigo, await app.passe(codigo));
    await expect(anaP.controles()).toBeVisible({ timeout: 30_000 });
    maria = await Pagina.abrir(C);
    await pedirEAceitarPelaPagina(anaP, maria, codigo, 'Maria Lima');
    await maria.esperarFrequencia(A.som);
    await expect.poll(async () => perto(await maria!.corDoQuadro('Ana Souza'), VERMELHO)).toBe(true);
    await anaP.esperarFrequencia(C.som);

    // A pausa, com o cartão à vista; o pausada falso a desfaz em até 3 s.
    expect(await app.pausa(codigo, true, 'ligacao1'), 'a pausa').toBe(204);
    await aAnaEmPausa(anaP, maria, 2_000);
    await expect(cartaoDaPausa(anaP)).toBeVisible();
    expect(await app.pausa(codigo, false, 'ligacao1'), 'o fim da pausa').toBe(204);
    await aAnaDeVolta(anaP, maria, 3_000);
    await expect(cartaoDaPausa(anaP)).toBeHidden();

    // Uma pausa nova: o Voltar para a reunião a desfaz, e a mesma vez (a repetição do app) não pausa de novo.
    expect(await app.pausa(codigo, true, 'ligacao2'), 'a pausa nova').toBe(204);
    await aAnaEmPausa(anaP, maria, 2_000);
    await voltarDaPausa(anaP).click();
    await aAnaDeVolta(anaP, maria, 3_000);
    expect(await app.pausa(codigo, true, 'ligacao2'), 'a repetição da pausa').toBe(204);
    await esperar(3_000);
    await expect(cartaoDaPausa(anaP)).toBeHidden();
    expect(await anaP.tocaOSom(), 'a página da Ana toca o som').toBe(true);
    await maria.esperarFrequencia(A.som, 1_000);
    await expect(maria.quadro('Ana Souza')).toHaveAttribute('data-mostra', 'video');
    await anaP.conferirOConsole();

    // Depois do Sair, com a página aberta no "Você saiu da reunião", a pausa não tem a quem ir: a rota passa a
    // responder 409 foraDaReuniao quando a saída da câmera chega ao chat.
    await botaoDosControles(anaP, 'Sair').click();
    await expect(anaP.titulo('Você saiu da reunião')).toBeVisible();
    await expect
      .poll(
        async () => {
          const r = await app.pedir('POST', `/api/v1/reunioes/${encodeURIComponent(codigo)}/pausa`, {
            pausada: true,
            vez: 'ligacao3',
          });
          return `${r.status} ${r.json?.erro}`;
        },
        { message: 'a pausa depois do Sair', timeout: 10_000 },
      )
      .toBe('409 foraDaReuniao');
    await expect(anaP.titulo('Você saiu da reunião')).toBeVisible();

    // O Entrar de novo põe a Ana de volta: uma pausa nova vale de novo, e o pausada falso a desfaz.
    await anaP.botao('Entrar de novo').click();
    await expect(anaP.controles()).toBeVisible({ timeout: 30_000 });
    await maria.esperarFrequencia(A.som);
    await expect.poll(async () => perto(await maria!.corDoQuadro('Ana Souza'), VERMELHO)).toBe(true);
    await anaP.esperarFrequencia(C.som);
    expect(await app.pausa(codigo, true, 'ligacao4'), 'a pausa depois do Entrar de novo').toBe(204);
    await aAnaEmPausa(anaP, maria, 2_000);
    await expect(cartaoDaPausa(anaP)).toBeVisible();
    expect(await app.pausa(codigo, false, 'ligacao4'), 'o fim dessa pausa').toBe(204);
    await aAnaDeVolta(anaP, maria, 3_000);
    await expect(cartaoDaPausa(anaP)).toBeHidden();
    await anaP.conferirOConsole();
  } finally {
    await maria?.fechar();
    await anaP?.fechar();
  }
});

test('o colega de outra empresa não tem passe', async () => {
  const codigo = await ana().criarMarcada();
  const outro = await computadorDeOutraEmpresa();
  const r = await outro.pedir('POST', `/api/v1/reunioes/${encodeURIComponent(codigo)}/passe`);
  expect(r.status).toBe(403);
  expect(r.json).toEqual({ erro: 'outraEmpresa' });
});

// A conferência do fim do ambiente (segredosNosRegistros), com os passes e as chaves do colega que os testes daqui
// anotaram: nenhum deles, nem os nomes, está nas saídas dos três servidores.
test('os registros não têm segredo nem nome', async () => {
  const usados = segredosUsados();
  expect(usados.passes.length, 'os testes anotaram os passes').toBeGreaterThan(0);
  expect(usados.chavesDoColega.length, 'os testes anotaram as chaves do colega').toBeGreaterThan(0);
  expect(segredosNosRegistros(), 'o que os registros têm e não podiam ter').toEqual([]);
});
