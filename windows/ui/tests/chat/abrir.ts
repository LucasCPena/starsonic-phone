// Abre a interface com a ponte falsa ligada ao servidor do chat de teste (servidor.ts): o `chat=` troca o endereço do
// chat (só com a ponte falsa), a `chave` é a que o C++ de mentira guarda (sem ela, o computador fica fora do chat), e o
// `ramal` e o `nome` são os da conta em uso. O `extra` vai como mais parâmetros (o `plataforma=ios`, o `computador`).
import { expect, type Page } from '@playwright/test';
import { baseDoChat } from './servidor';

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
  await page.goto(`/index.html?${parametros}`);
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
}
