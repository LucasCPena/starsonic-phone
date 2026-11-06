// De ponta a ponta (Task 8; a spec do chat, seção 11.2): dois apps de teste conversam pelo servidor do chat de verdade
// (o de teste, que o global-setup.ts sobe). São duas páginas, em dois contextos do navegador, cada uma com a sua ponte
// falsa e a chave do seu computador: a A, da Recepção (2001), e a B, da Ana Souza (2003), da mesma empresa. O Carlos Lima
// (2011) entra pela ApiDeTeste. O texto, a foto (a miniatura que o app da B faz e o da A mostra), o PDF (o chatDownload da
// B com o id do servidor), o grupo com os avisos e a mensagem do Carlos nas duas páginas. Um teste de verificação (o
// código já existe).
import { expect, test, type Page } from '@playwright/test';
import { esperarComando } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos, exato } from './abrir';
import { escolher, imagemDaPagina, type ArquivoDeTeste } from './anexar';
import { empresaComPessoas } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const CARLOS = { ramal: '2011', nome: 'Carlos Lima' };

const abaChat = (page: Page) => page.getByRole('navigation', { name: 'Seções' }).locator('.tab-chat');
const linhaDe = (page: Page, nome: string) => page.locator('.chat-linha').filter({ has: page.locator('.chat-nome', { hasText: exato(nome) }) });
const voltar = (page: Page) => page.getByRole('button', { name: 'Voltar para as conversas' }).click();

/** Escolhe um arquivo pelo clipe (a janela de escolher do Windows) e manda. */
async function mandarPeloClipe(page: Page, arquivo: ArquivoDeTeste): Promise<void> {
  await escolher(page, [arquivo]);
  await expect(page.locator('.anexo .anexo-nome')).toHaveText([arquivo.name]);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
}

test('two apps talk through the real server with text, photo, file and group', async ({ browser }) => {
  const { pessoas } = await empresaComPessoas('ACME Comércio Ltda', [RECEPCAO, ANA, CARLOS]);
  const [a, ana, carlos] = pessoas;
  const contextos = [await browser.newContext(), await browser.newContext()];
  try {
    const [pa, pb] = await Promise.all(contextos.map((c) => c.newPage()));
    await abrirNoChat(pa, { chave: a.chave, ...RECEPCAO });
    await abrirNoChat(pb, { chave: ana.chave, ...ANA });
    for (const p of [pa, pb]) {
      await expect(p.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
      await esperarOsEventos(p);
    }

    // 1. A abre a Nova conversa, escolhe a Ana e manda "Bom dia".
    await pa.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
    await pa.getByRole('menuitem', { name: 'Nova conversa' }).click();
    await pa.getByRole('list', { name: 'Colegas no chat' }).getByRole('button', { name: /^Ana Souza/ }).click();
    const conversaA = pa.getByRole('log', { name: 'Mensagens com Ana Souza' });
    const campoA = pa.getByRole('textbox', { name: 'Mensagem para Ana Souza' });
    await expect(campoA).toBeFocused();
    await campoA.fill('Bom dia');
    await campoA.press('Enter');
    await expect(conversaA.locator('.balao-meu .balao-texto')).toHaveText(['Bom dia']);
    // Chegou ao servidor: a hora no lugar do "Enviando…".
    await expect(conversaA.locator('.balao-meu .balao-hora')).toHaveText([/^\d\d:\d\d$/]);

    // 2. A lista da B mostra a conversa com 1 não lida. A B abre, e o número some.
    const daRecepcao = linhaDe(pb, 'Recepção');
    await expect(daRecepcao.locator('.chat-previa')).toHaveText('Bom dia');
    await expect(daRecepcao.locator('.chat-numero')).toHaveText('1');
    await expect(abaChat(pb)).toHaveAccessibleName('Chat, 1 mensagem não lida');
    await esperarComando(pb, { cmd: 'chatBadge', n: 1 });
    await daRecepcao.click();
    const conversaB = pb.getByRole('log', { name: 'Mensagens com Recepção' });
    await expect(conversaB.locator('.balao-outro .balao-texto')).toHaveText(['Bom dia']);
    await esperarComando(pb, { cmd: 'chatBadge', n: 0 });
    await voltar(pb);
    await expect(daRecepcao.locator('.chat-numero')).toHaveCount(0);
    await expect(abaChat(pb)).toHaveAccessibleName('Chat');
    await expect.poll(async () => (await ana.api.conversas()).map((c) => c.naoLidas)).toEqual([0]);
    await daRecepcao.click();
    await expect(conversaB.locator('.balao-texto')).toHaveText(['Bom dia']);

    // 3. A B manda uma foto, e a A vê a miniatura (a de 480 px que o app da B fez, e não a foto de 1200).
    await mandarPeloClipe(pb, { name: 'Vitrine da loja.png', mimeType: 'image/png', buffer: await imagemDaPagina(pb, 1200, 900, 'image/png') });
    const miniaturaNaA = conversaA.getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).locator('img');
    await expect(miniaturaNaA).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => miniaturaNaA.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBe(480);
    await expect.poll(() => miniaturaNaA.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBe(360);

    // 4. A manda um PDF. A B clica, e sai o chatDownload com o id certo (o do arquivo no servidor).
    const pdf = Buffer.from('%PDF-1.4 a proposta da ACME');
    await mandarPeloClipe(pa, { name: 'Proposta ACME.pdf', mimeType: 'application/pdf', buffer: pdf });
    const pdfNaB = conversaB.getByRole('button', { name: `Abrir Proposta ACME.pdf, ${pdf.length} bytes`, exact: true });
    await expect(pdfNaB).toBeVisible();
    const [dupla] = await ana.api.conversas();
    const mensagem = (await ana.api.mensagens(dupla.id)).find((m) => m.arquivo?.nome === 'Proposta ACME.pdf');
    expect(mensagem?.arquivo.id).toMatch(/^[0-9a-f]{32}$/);
    await pdfNaB.click();
    await esperarComando(pb, { cmd: 'chatDownload', arquivo: mensagem.arquivo.id, nome: 'Proposta ACME.pdf' });

    // 5. A cria o grupo "Comercial" com a Ana e o Carlos. A B vê o grupo e os avisos.
    await voltar(pa);
    await pa.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
    await pa.getByRole('menuitem', { name: 'Novo grupo' }).click();
    await pa.getByRole('textbox', { name: 'Nome do grupo' }).fill('Comercial');
    await pa.getByRole('checkbox', { name: /^Ana Souza/ }).check();
    await pa.getByRole('checkbox', { name: /^Carlos Lima/ }).check();
    await pa.getByRole('button', { name: 'Criar grupo com 3 pessoas' }).click();
    const grupoA = pa.getByRole('log', { name: 'Mensagens do grupo Comercial' });
    await expect(grupoA.locator('.conversa-aviso')).toHaveText(['Você criou o grupo', 'Você pôs Ana Souza no grupo', 'Você pôs Carlos Lima no grupo']);
    await voltar(pb);
    await expect(linhaDe(pb, 'Comercial').locator('.chat-previa')).toHaveText('Recepção pôs Carlos Lima no grupo');
    await abrirAConversa(pb, 'Comercial');
    const grupoB = pb.getByRole('log', { name: 'Mensagens do grupo Comercial' });
    await expect(grupoB.locator('.conversa-aviso')).toHaveText(['Recepção criou o grupo', 'Recepção pôs você no grupo', 'Recepção pôs Carlos Lima no grupo']);
    await expect(pb.getByRole('button', { name: 'Ver os membros do grupo Comercial' })).toContainText('3 pessoas · ver os membros');

    // 6. O Carlos manda uma mensagem pela API, e as duas páginas a mostram, com o nome dele em cima.
    const grupo = (await carlos.api.conversas()).find((c) => c.tipo === 'grupo' && c.nome === 'Comercial');
    await carlos.api.enviarTexto(grupo.id, 'Bom dia, pessoal. Já estou no grupo.');
    for (const log of [grupoA, grupoB]) {
      await expect(log.locator('.balao-outro .balao-autor')).toHaveText(['Carlos Lima']);
      await expect(log.locator('.balao-outro .balao-texto')).toHaveText(['Bom dia, pessoal. Já estou no grupo.']);
    }
  } finally {
    for (const c of contextos) await c.close();
  }
});
