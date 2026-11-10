// O "Ligar com vídeo" no cabeçalho da conversa (video etapa 2, Task 3), contra o servidor do chat de teste.
import { expect, test } from '@playwright/test';
import { esperarComando } from '../helpers';
import { abrirAConversa, abrirNoChat } from './abrir';
import { empresaComPessoas, tirarPessoa } from './servidor';

test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };

test('the conversation has Ligar com vídeo next to Ligar', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Me liga quando puder.');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await page.getByRole('button', { name: 'Ligar com vídeo para Ana Souza, ramal 2003' }).click();
  await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true, video: true });
});

test('with Ana out of the chat both call buttons are gone', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Hoje é o meu último dia.');
  await tirarPessoa(empresaId, ana.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza (saiu)');
  await expect(page.getByRole('heading', { name: 'Ana Souza (saiu)', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ligar/ })).toHaveCount(0);
});
