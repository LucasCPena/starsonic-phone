// O chat reinicia com a colega na reunião, de ponta a ponta (a etapa 2a): o reiniciarOChat para o chat de verdade e o
// sobe de novo, com os mesmos dados, e o que ele guardava na memória some (a reunião em andamento, as chaves do colega
// e as de volta). Dentro do app de mentira, a página da Ana Souza pede outro passe (o pronta) e entra de novo sozinha,
// sem a Maria Lima, de fora, perceber; no navegador, a Ana continua na reunião, mas deixa de cuidar dela, com o aviso à
// vista. As pessoas são as do colega.spec.ts: a Ana é a A, a Maria é a C e a Bia Ramos é a B.
import { expect, test } from '@playwright/test';
import { A, AMARELO, B, C, MOSAICO_2, VERMELHO } from './midia';
import { repetirAte } from './espera';
import { Pagina, type Mensagem } from './navegador';
import { ana, ligacoesPrincipais, reiniciarOChat } from './servidores';

const TITULO_DO_AVISO = 'Você deixou de cuidar desta reunião';
const TEXTO_DO_AVISO = 'Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app.';
const AVISO = `${TITULO_DO_AVISO}. ${TEXTO_DO_AVISO}`;
const FAIXA =
  'Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado.';

/** O cartão do pedido na página do colega. */
const cartao = (p: Pagina, nome: string) => p.tela.getByRole('region', { name: `${nome} quer entrar`, exact: true });
const botaoDosControles = (p: Pagina, nome: string) => p.controles().getByRole('button', { name: nome, exact: true });
const painel = (p: Pagina) => p.tela.getByRole('complementary', { name: 'Participantes' });
const doTipo = (lista: Mensagem[], tipo: string) => lista.filter((m) => m.tipo === tipo);

/** A pessoa de fora pede, e o colega aceita pelo cartão da página dele, que aparece em até 2 s. */
async function pedirEAceitarPelaPagina(colega: Pagina, fora: Pagina, codigo: string, nome: string): Promise<void> {
  await fora.entrar(codigo, nome);
  await expect(cartao(colega, nome)).toBeVisible({ timeout: 2_000 });
  await cartao(colega, nome).getByRole('button', { name: 'Aceitar', exact: true }).click();
  await expect(fora.controles()).toBeVisible({ timeout: 30_000 });
}

/** A Ana e a Maria se veem e se ouvem. */
async function asDuasSeVeemESeOuvem(anaP: Pagina, maria: Pagina, prazo = 20_000): Promise<void> {
  await anaP.esperarCores(MOSAICO_2, [VERMELHO, AMARELO], prazo);
  await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO], prazo);
  await maria.esperarFrequencia(A.som, prazo);
  await anaP.esperarFrequencia(C.som, prazo);
}

test('o chat reinicia com a colega na reunião, dentro do app de mentira', async () => {
  test.setTimeout(300_000);
  const app = ana();
  const codigo = await app.criarMarcada();
  let anaP: Pagina | undefined;
  let maria: Pagina | undefined;
  let bia: Pagina | undefined;
  try {
    anaP = await Pagina.abrir(A);
    await anaP.entrarComoColega(codigo, await app.passe(codigo), { noApp: true });
    await expect(anaP.controles()).toBeVisible({ timeout: 30_000 });
    maria = await Pagina.abrir(C);
    await pedirEAceitarPelaPagina(anaP, maria, codigo, 'Maria Lima');
    await asDuasSeVeemESeOuvem(anaP, maria);

    const antigo = anaP.participante();
    const prontas = async () => doTipo(await anaP!.recebidasDoApp(), 'pronta').length;
    expect(await prontas(), 'os pronta que o app recebeu antes do reinício').toBe(1);
    const daMariaAntes = maria.mensagensMandadas().length;

    await reiniciarOChat();

    // A página pede outro passe, e o app de mentira o dá, como o app de verdade.
    await repetirAte(
      60_000,
      200,
      prontas,
      (n) => n >= 2,
      (n) => `o app de mentira recebeu ${n} pronta em 60 s, e não o segundo`,
    );
    await anaP.doApp('passe', { passe: await app.passe(codigo), aparelhos: {} });

    // O segundo aceito, com outro participante, e depois dele a lista com a Ana e a Maria, que o chat não conhece
    // mais pelo nome.
    let novo = '';
    await expect
      .poll(
        () => {
          const aceitos = doTipo(anaP!.mensagensRecebidas(), 'aceito');
          novo = typeof aceitos[1]?.participante === 'string' ? aceitos[1].participante : '';
          return aceitos.length === 2 && novo !== antigo;
        },
        { message: 'o segundo aceito da Ana, com outro participante', timeout: 60_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () => {
          const recebidas = anaP!.mensagensRecebidas();
          const segundo = recebidas.filter((m) => m.tipo === 'aceito')[1];
          const depois = recebidas.slice(recebidas.indexOf(segundo) + 1);
          const lista = doTipo(depois, 'participantes').at(-1);
          const gente = (lista?.participantes ?? []) as Array<{ nome: string; voce: boolean }>;
          return gente.map(({ nome, voce }) => ({ nome, voce })).sort((x, y) => x.nome.localeCompare(y.nome));
        },
        { message: 'a lista dos participantes depois do segundo aceito', timeout: 60_000 },
      )
      .toEqual([
        { nome: '', voce: false },
        { nome: 'Ana Souza', voce: true },
      ]);
    await expect
      .poll(async () => [await ligacoesPrincipais(antigo), await ligacoesPrincipais(novo)], {
        message: 'as ligações principais do participante antigo e do novo, no agente',
        timeout: 60_000,
      })
      .toEqual([0, 1]);

    // As duas continuam se vendo e se ouvindo.
    await asDuasSeVeemESeOuvem(anaP, maria, 30_000);

    // A Ana entrou de novo pelo entrar, sem o voltar; a Maria, de fora, não precisou de nada disso.
    const daAna = anaP.mensagensMandadas().map((m) => m.tipo);
    expect(daAna.filter((t) => t === 'entrar'), 'os entrar que a Ana mandou').toHaveLength(2);
    expect(daAna, 'o que a Ana mandou').not.toContain('voltar');
    const daMaria = maria.mensagensMandadas().slice(daMariaAntes).map((m) => m.tipo);
    expect(daMaria, 'o que a Maria mandou depois do reinício').not.toContain('voltar');

    // A Ana volta a cuidar da reunião: ela aceita a Bia pela página.
    bia = await Pagina.abrir(B);
    await pedirEAceitarPelaPagina(anaP, bia, codigo, 'Bia Ramos');

    await anaP.conferirOConsole();
    await maria.conferirOConsole();
    await bia.conferirOConsole();
  } finally {
    await bia?.fechar();
    await maria?.fechar();
    await anaP?.fechar();
  }
});

test('o chat reinicia com a colega na reunião, no navegador', async () => {
  test.setTimeout(240_000);
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
    const participante = anaP.participante();
    const daAnaAntes = anaP.mensagensMandadas().length;

    await reiniciarOChat();

    // O aviso no lugar do cartão, e no painel dos participantes, sem as listas e sem o Encerrar para todos.
    const noLugar = anaP.tela.getByRole('region', { name: TITULO_DO_AVISO, exact: true });
    await expect(noLugar.getByRole('heading', { level: 2, name: TITULO_DO_AVISO, exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(noLugar.getByText(TEXTO_DO_AVISO, { exact: true })).toBeVisible();
    await anaP.tela.locator('button[data-botao="participantes"]').click();
    await expect(painel(anaP)).toBeVisible();
    await expect(painel(anaP).getByText(AVISO, { exact: true })).toBeVisible();
    await expect(painel(anaP).getByRole('button', { name: 'Encerrar para todos', exact: true })).toBeHidden();

    // Sem o voltar: a Ana continua na reunião, com a mesma ligação, e a Maria continua a ouvindo.
    const daAna = anaP.mensagensMandadas().slice(daAnaAntes).map((m) => m.tipo);
    expect(daAna, 'o que a Ana mandou depois do reinício').not.toContain('voltar');
    expect(await ligacoesPrincipais(participante), 'as ligações principais da Ana no agente').toBe(1);
    await maria.esperarFrequencia(A.som);

    // O Sair e o Entrar de novo: o chat não reconhece mais a Ana, e ela vai à entrada de quem é de fora, com a faixa.
    await botaoDosControles(anaP, 'Sair').click();
    await expect(anaP.titulo('Você saiu da reunião')).toBeVisible({ timeout: 10_000 });
    await anaP.botao('Entrar de novo').click();
    await expect(anaP.tela.getByLabel('Seu nome')).toBeVisible({ timeout: 30_000 });
    const entrada = anaP.tela.locator('section[data-tela="entrada"]');
    await expect(entrada.getByText(FAIXA, { exact: true })).toBeVisible();

    // O abrir do Entrar de novo, com a chave do colega que o chat esqueceu, responde 401: o erro de rede dele.
    await anaP.conferirOConsole(/status of 401\b/);
    await maria.conferirOConsole();
  } finally {
    await maria?.fechar();
    await anaP?.fechar();
  }
});
