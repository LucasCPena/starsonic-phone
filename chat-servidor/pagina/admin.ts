// O que os testes da página de administração usam (testes/admin.spec.ts): entrar com o usuário de teste do chat.ts,
// criar uma empresa pela própria página, e um computador de mentira, que fala a API do chat como o app
// (docs/chat-protocolo.md): liga-se à empresa pelo código, entra como uma pessoa, abre o canal dos eventos e diz o
// estado do ramal.
import { expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { CHAT } from './chat';

/** Entra na administração pela página de entrada, com o usuário `teste` e a senha da rodada (o CHAT_ADMIN_SENHA). */
export async function entrar(page: Page): Promise<void> {
  const senha = process.env.CHAT_ADMIN_SENHA;
  if (!senha) throw new Error('sem o CHAT_ADMIN_SENHA: o chat.ts (o globalSetup) não rodou');
  await page.goto('/admin/entrar');
  await page.getByLabel('Usuário').fill('teste');
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin\/$/);
}

/**
 * Cria uma empresa pela página, com um nome que nenhum outro teste usa (os testes rodam ao mesmo tempo, no mesmo chat).
 * Devolve o nome, o código e o caminho da página dela.
 */
export async function criarEmpresa(page: Page, prefixo: string): Promise<{ nome: string; codigo: string; caminho: string }> {
  const nome = `${prefixo} ${randomBytes(4).toString('hex')}`;
  await page.goto('/admin/empresas/nova');
  await page.getByLabel('Nome da empresa').fill(nome);
  await page.getByRole('button', { name: 'Criar a empresa' }).click();
  await expect(page).toHaveURL(/\/admin\/empresas\/\d+$/);
  const codigo = ((await page.locator('#codigo').textContent()) ?? '').trim();
  return { nome, codigo, caminho: new URL(page.url()).pathname };
}

async function pedir(chave: string | null, metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(CHAT + caminho, {
    method: metodo,
    headers: {
      ...(chave !== null ? { authorization: `Bearer ${chave}` } : {}),
      ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  return { status: r.status, json: texto ? JSON.parse(texto) : null };
}

/** Um computador de mentira: fala com a API do chat como o app. */
export class Computador {
  private canal: WebSocket | null = null;

  private constructor(private readonly chave: string) {}

  /** Liga um computador à empresa do código e entra nele como a pessoa do ramal. */
  static async ligar(codigo: string, nome: string, ramal: string, pessoa: string): Promise<Computador> {
    const ligado = await pedir(null, 'POST', '/api/v1/computadores', { codigo, computador: nome });
    if (ligado.status !== 201) throw new Error(`ligar o computador respondeu ${ligado.status}`);
    const c = new Computador(ligado.json.chave);
    const entrou = await pedir(c.chave, 'POST', '/api/v1/pessoas/eu', { ramal, nome: pessoa });
    if (entrou.status !== 200) throw new Error(`entrar como a pessoa respondeu ${entrou.status}`);
    return c;
  }

  /** Abre o canal dos eventos (o bilhete e o WebSocket) e espera abrir: daqui em diante o computador está ligado ao chat. */
  async abrirCanal(): Promise<void> {
    const bilhete = await pedir(this.chave, 'POST', '/api/v1/eventos/bilhete');
    if (bilhete.status !== 200) throw new Error(`o bilhete respondeu ${bilhete.status}`);
    // O WebSocket do Node não manda o cabeçalho Origin, e sem ele o chat aceita o bilhete sozinho.
    const ws = new WebSocket(`${CHAT.replace(/^http/, 'ws')}/api/v1/eventos?bilhete=${encodeURIComponent(bilhete.json.bilhete)}`);
    await new Promise<void>((ok, falha) => {
      ws.onopen = () => ok();
      ws.onerror = () => falha(new Error('o canal dos eventos não abriu'));
    });
    this.canal = ws;
  }

  /** Fecha o canal e espera o chat dar o computador por desligado (o estado do ramal deixa de ser aceito: 409). */
  async fecharCanal(): Promise<void> {
    this.canal?.close();
    this.canal = null;
    await expect.poll(() => this.dizerRamal('conectado', 0)).toBe(409);
  }

  /** O PUT do estado do ramal. Devolve o status. */
  async dizerRamal(estado: string, segundos: number): Promise<number> {
    return (await pedir(this.chave, 'PUT', '/api/v1/computadores/eu/ramal', { estado, segundos })).status;
  }
}
