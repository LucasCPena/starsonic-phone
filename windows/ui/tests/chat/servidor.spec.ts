// O servidor do chat de teste (global-setup.ts) e a ApiDeTeste: o que as specs do chat usam contra o servidor de verdade.
import { expect, test } from '@playwright/test';
import { empresaComPessoas } from './servidor';

test('the test chat server links two computers of one company and delivers a message', async () => {
  const { pessoas } = await empresaComPessoas('ACME Comércio Ltda', [
    { ramal: '2001', nome: 'Recepção' },
    { ramal: '2003', nome: 'Ana Souza' },
  ]);
  const [a, b] = pessoas;
  expect(a.chave).not.toBe(b.chave);

  const conversa = await a.api.criarDupla(b.pessoa.id);
  await a.api.enviarTexto(conversa, 'Bom dia');

  const mensagens = await b.api.mensagens(conversa);
  expect(mensagens).toHaveLength(1);
  expect(mensagens[0].texto).toBe('Bom dia');

  // Uma pessoa de outra empresa não enxerga a conversa.
  const outra = await empresaComPessoas('Outra Empresa Ltda', [{ ramal: '3001', nome: 'Carla' }]);
  const r = await outra.pessoas[0].api.pedir('GET', `/api/v1/conversas/${conversa}/mensagens`);
  expect(r.status).toBe(404);

  await Promise.all([...pessoas, ...outra.pessoas].map((p) => p.api.desligar()));
});
