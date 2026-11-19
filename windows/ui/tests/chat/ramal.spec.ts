// O estado do ramal contado ao chat (a spec do estado dos ramais, seções 4.3 e 7.3; docs/chat-protocolo.md, seção 5,
// "Dizer o estado do ramal"): o app diz ao chat como está o ramal da conta em uso, e com isso a página de administração
// do chat mostra "Online" e "Sem registro". Contra o servidor do chat de teste: os pedidos do ramal que a página faz são
// contados aqui, e o resultado é lido na página de administração dele. Nada disso aparece na interface.
//
// O relógio da página é o do Playwright, parado depois de ela abrir. Com ele parado, a ponte falsa só entrega uma
// mensagem quando o relógio anda (ela usa um setTimeout, como o C++ usa o PostWebMessageAsJson): o `mudar` daqui manda
// o estado e anda uns milissegundos.
import { expect, test, type Page, type Request } from '@playwright/test';
import { mudarEstado } from '../helpers';
import { abrirNoChat, esperarOsEventos, pararORelogio } from './abrir';
import { empresaComPessoas, estadoNaAdministracao } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const CAMINHO_DO_RAMAL = '/api/v1/computadores/eu/ramal';
const COMPUTADOR_SAIU = 'Este computador saiu do chat. Fale com o suporte da Starsonic.';

type Estado = Record<string, any>;

/** Os pedidos do ramal que a página faz daqui em diante, na ordem. */
function pedidosDoRamal(page: Page): Request[] {
  const pedidos: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && new URL(r.url()).pathname === CAMINHO_DO_RAMAL) pedidos.push(r);
  });
  return pedidos;
}

/** O corpo de cada pedido. */
const corpos = (pedidos: Request[]): Array<{ estado: string; segundos: number }> => pedidos.map((p) => p.postDataJSON());

/** Manda um estado novo com o relógio parado, e anda 5 ms para a ponte falsa o entregar (e a resposta de um comando). */
async function mudar(page: Page, f: (s: Estado) => Estado): Promise<void> {
  await mudarEstado(page, f);
  for (let i = 0; i < 5; i++) await page.clock.runFor(1);
}

/** A conta em uso passa ao `status` dado (o que o núcleo diz do registro do ramal). */
const comOStatus =
  (status: string) =>
  (s: Estado): Estado => ({ ...s, conta: { ...s.conta, status } });

/** A conta em uso já conectou neste computador: é o que falta para o chat começar no cenário `chat-sem-conta`. */
const comAContaConectada = (s: Estado): Estado => ({ ...s, chat: { ...s.chat, contaConectada: true } });

const NA_ABERTURA = [
  { status: 'conectado', estado: 'conectado', mostra: { estado: 'Online', detalhe: 'há menos de 1 min' } },
  { status: 'conectando', estado: 'conectando', mostra: { estado: 'No chat', detalhe: 'registrando o ramal…' } },
  { status: 'erro', estado: 'erro', mostra: { estado: 'No chat', detalhe: 'registrando o ramal…' } },
  { status: 'sem_conexao', estado: 'semConexao', mostra: { estado: 'No chat', detalhe: 'registrando o ramal…' } },
];

for (const caso of NA_ABERTURA) {
  test(`o estado do ramal vai quando o canal abre: ${caso.status}`, async ({ page }) => {
    const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
    const pedidos = pedidosDoRamal(page);
    await page.clock.install();
    await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-sem-conta' });
    await pararORelogio(page);
    // O ramal chega ao estado do teste com o relógio parado (passando pelo outro lado, registrado ou sem registrar):
    // quando o canal abrir, o tempo dele é zero.
    await mudar(page, comOStatus(caso.status === 'conectado' ? 'erro' : 'conectado'));
    await mudar(page, comOStatus(caso.status));
    expect(pedidos).toHaveLength(0);

    await mudar(page, comAContaConectada);
    await esperarOsEventos(page);
    await expect.poll(() => corpos(pedidos)).toEqual([{ estado: caso.estado, segundos: 0 }]);
    expect((await pedidos[0].response())?.status()).toBe(204);
    await expect.poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome)).toEqual(caso.mostra);
    expect(pedidos).toHaveLength(1);
  });
}

test('o tempo conta desde que o app abriu', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = pedidosDoRamal(page);
  await page.clock.install();
  // O app abre com o ramal sem registrar (o "Erro no cadastro"), e o chat ainda não começa: a conta não conectou aqui.
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-sem-conta', extra: { status: 'erro' } });
  await pararORelogio(page);
  await page.clock.runFor(90_000);
  expect(pedidos).toHaveLength(0);

  await mudar(page, comAContaConectada);
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);
  const [corpo] = corpos(pedidos);
  expect(corpo.estado).toBe('erro');
  // Os 90 s que o relógio andou, e mais o tempo de verdade que a página levou para abrir (o relógio só para depois).
  expect(corpo.segundos).toBeGreaterThanOrEqual(90);
  expect(corpo.segundos).toBeLessThan(120);
  await expect
    .poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome))
    .toEqual({ estado: 'Sem registro', detalhe: 'há 1 min · o app diz “Erro no cadastro”' });
});

test('a cada volta do canal, o estado vai de novo', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = pedidosDoRamal(page);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);

  // O mesmo computador abre outro canal por fora: o chat fecha o da página (4000), e ela abre o dela de novo em 0,5 a
  // 1,5 s (o que fecha o de fora).
  const porFora = await pessoas[0].api.abrirCanal();
  await expect.poll(() => pedidos.length, { timeout: 15_000 }).toBe(2);
  expect(corpos(pedidos).map((c) => c.estado)).toEqual(['conectado', 'conectado']);
  expect((await pedidos[1].response())?.status()).toBe(204);
  porFora.close();
});

for (const caso of ['chat-desligado', 'chat-sem-conta', 'o computador tirado do chat'] as const) {
  test(`sem o chat, nada vai: ${caso}`, async ({ page }) => {
    const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
    const pedidos = pedidosDoRamal(page);
    const tirado = caso === 'o computador tirado do chat';
    // O computador tirado: a chave que o app guarda não vale mais.
    if (tirado) await pessoas[0].api.desligar();
    await page.clock.install();
    await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: tirado ? 'chat' : caso });
    if (tirado) await expect(page.getByText(COMPUTADOR_SAIU, { exact: true })).toBeVisible();
    await pararORelogio(page);

    for (const status of ['erro', 'conectando', 'conectado']) {
      await mudar(page, comOStatus(status));
      await page.clock.runFor(5000);
    }
    await page.clock.runFor(60_000);
    expect(pedidos).toHaveLength(0);
  });
}
