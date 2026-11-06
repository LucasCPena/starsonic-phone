// Abre a interface com a ponte falsa ligada ao servidor do chat de teste (servidor.ts): o `chat=` troca o endereço do
// chat (só com a ponte falsa), a `chave` é a que o C++ de mentira guarda (sem ela, o computador fica fora do chat), e o
// `ramal` e o `nome` são os da conta em uso. O `extra` vai como mais parâmetros (o `plataforma=ios`, o `computador`).
// (Task 6) A página conta os WebSockets abertos (o esperarOsEventos espera os eventos do chat no ar), e o
// abrirAConversa abre uma conversa pela linha dela na lista.
import { expect, type Page } from '@playwright/test';
import { baseDoChat } from './servidor';

/** As páginas que já contam os WebSockets abertos (o script vale para cada abertura da página). */
const vigiadas = new WeakSet<Page>();

/**
 * Conta os WebSockets abertos da página (o window.__eventosNoAr). Vai antes de a página abrir; com o
 * page.routeWebSocket (sem-conexao.spec.ts), depois dele: assim conta também o WebSocket da rota.
 */
async function vigiarOsEventos(page: Page): Promise<void> {
  if (vigiadas.has(page)) return;
  vigiadas.add(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __eventosNoAr?: number };
    if (w.__eventosNoAr !== undefined) return;
    w.__eventosNoAr = 0;
    const Base = window.WebSocket;
    window.WebSocket = class extends Base {
      constructor(endereco: string | URL, protocolos?: string | string[]) {
        super(endereco, protocolos);
        let aberto = false;
        this.addEventListener('open', () => {
          aberto = true;
          w.__eventosNoAr! += 1;
        });
        this.addEventListener('close', () => {
          if (aberto) w.__eventosNoAr! -= 1;
          aberto = false;
        });
      }
    };
  });
}

export async function abrirNoChat(
  page: Page,
  o: {
    chave: string;
    ramal: string;
    nome: string;
    empresa?: string;
    cenario?: 'chat' | 'chat-desligado' | 'chat-sem-conta' | 'chat-duas-contas';
    extra?: Record<string, string>;
  },
): Promise<void> {
  const parametros = new URLSearchParams({ fake: o.cenario ?? 'chat', chat: baseDoChat(), chave: o.chave, ramal: o.ramal, nome: o.nome });
  if (o.empresa !== undefined) parametros.set('empresa', o.empresa);
  for (const [nome, valor] of Object.entries(o.extra ?? {})) parametros.set(nome, valor);
  await vigiarOsEventos(page);
  await page.goto(`/index.html?${parametros}`);
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
}

/**
 * Os eventos do chat no ar: um WebSocket da página aberto. O servidor põe o computador no hub antes de aceitar a
 * conexão (chat-servidor/internal/api/eventos.go): uma mensagem mandada daqui em diante chega pelo evento.
 */
export async function esperarOsEventos(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __eventosNoAr?: number }).__eventosNoAr ?? 0)).toBe(1);
}

/** O texto inteiro, sem mais nada antes ou depois. */
export function exato(texto: string): RegExp {
  return new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/** Abre a conversa pela linha dela na lista da aba Chat (o nome como a lista mostra). */
export async function abrirAConversa(page: Page, nome: string): Promise<void> {
  await page.locator('.chat-linha').filter({ has: page.locator('.chat-nome', { hasText: exato(nome) }) }).click();
}
