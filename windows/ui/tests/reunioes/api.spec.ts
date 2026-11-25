// As rotas das reuniões da API do chat (docs/chat-protocolo.md, seção 9), no Node, sem página, contra o chat de teste
// do global-setup. As falhas do passe contam na janela de 20 tentativas por minuto do endereço, que todos os testes da
// rodada dividem: este arquivo provoca de verdade só uma (o código que não existe).
import { expect, test } from '@playwright/test';
import { criarApi, ErroChat } from '../../src/chat/api';
import { baseDoChat, empresaComPessoas, empresaComReunioes } from '../chat/servidor';

const RECEPCAO = { ramal: '2001', nome: 'Recepção' };

/** O erro com que a promessa rejeita, ou falha o teste se ela resolver. */
async function erroDe(p: Promise<unknown>): Promise<ErroChat> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroChat);
    return e as ErroChat;
  }
  throw new Error('era para rejeitar');
}

test('as rotas das reuniões: criar, listar, o passe e cancelar', async () => {
  const { pessoas } = await empresaComReunioes('Reunioes da API', [RECEPCAO]);
  const api = criarApi(baseDoChat(), pessoas[0].chave);
  const inicio = Date.now() + 3_600_000;
  const r = await api.criarReuniao({ assunto: 'Planejamento de dezembro', inicio, valeAte: inicio + 3_600_000 });
  expect(r.codigo).toMatch(/^[abcdefghjkmnpqrstvwxyz23456789]{10}$/);
  expect(r.link.endsWith(`/r/${r.codigo}`)).toBe(true);
  expect(r).toMatchObject({
    tipo: 'marcada',
    assunto: 'Planejamento de dezembro',
    inicio,
    criouEu: true,
    acontecendo: false,
    pessoas: 0,
  });
  expect(await api.reunioes()).toEqual([r]);
  const p = await api.passeDaReuniao(r.codigo);
  expect(p.passe).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(p.reuniao.codigo).toBe(r.codigo);
  await api.cancelarReuniao(r.codigo);
  expect(await api.reunioes()).toEqual([]);
});

test('os erros vêm como o ErroChat do protocolo', async () => {
  const sem = await empresaComPessoas('Sem reunioes da API', [RECEPCAO]);
  const apiSem = criarApi(baseDoChat(), sem.pessoas[0].chave);
  expect(await erroDe(apiSem.reunioes())).toMatchObject({ status: 403, erro: 'semReunioes' });

  const { pessoas } = await empresaComReunioes('Erros das reunioes da API', [RECEPCAO]);
  const api = criarApi(baseDoChat(), pessoas[0].chave);
  const inicio = Date.now() + 3_600_000;
  expect(await erroDe(api.criarReuniao({ inicio, valeAte: inicio - 1000 }))).toMatchObject({
    status: 400,
    erro: 'invalido',
    campo: 'valeAte',
  });
  expect(await erroDe(api.passeDaReuniao('aaaaaaaaaa'))).toMatchObject({ status: 404, erro: 'naoEncontrado' });

  const r = await api.criarReuniao({ inicio, valeAte: inicio + 3_600_000 });
  const fora = { status: 409, erro: 'foraDaReuniao' };
  expect(await erroDe(api.aceitarPedido(r.codigo, '0011223344556677'))).toMatchObject(fora);
  expect(await erroDe(api.recusarPedido(r.codigo, '0011223344556677'))).toMatchObject(fora);
  expect(await erroDe(api.pausarReuniao(r.codigo, true, 'p7Kq2'))).toMatchObject(fora);
  expect(await erroDe(api.participantesDaReuniao(r.codigo))).toMatchObject(fora);
});
