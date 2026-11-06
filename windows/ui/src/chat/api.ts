// A API do chat (docs/chat-protocolo.md, seções 5 e 6): um método para cada operação. A chave vai só no Authorization e
// só para o endereço do chat (a `base`); nenhum pedido segue um redirecionamento nem leva cookies, e nenhum espera mais de
// 20 s pela resposta. Os erros vêm como ErroChat, com o status e o `erro` do protocolo (seção 2). Os arquivos (enviar, a
// miniatura e baixar) vêm na Task 7.
import type { Conversa, Membro, Mensagem, Pessoa } from './tipos';

/** As mensagens vêm em páginas de 50 (o máximo do protocolo). */
const POR_PAGINA = 50;

/**
 * Um pedido sem a resposta inteira em 20 s desiste, como a abertura do WebSocket (eventos.ts): um servidor ou um proxy
 * que segura a conexão aberta sem responder vira a falta de rede, com a faixa e outra tentativa (R14).
 */
export const PRAZO_DA_RESPOSTA_MS = 20_000;

/** Um erro da API. Status 0 com o `erro` 'rede': o pedido não teve resposta. */
export class ErroChat extends Error {
  readonly status: number;
  readonly erro: string;
  readonly campo?: string;
  readonly esperarSegundos?: number;

  constructor(status: number, erro: string, extra: { campo?: string; esperarSegundos?: number } = {}) {
    super(`chat: ${status} ${erro}`);
    this.name = 'ErroChat';
    this.status = status;
    this.erro = erro;
    this.campo = extra.campo;
    this.esperarSegundos = extra.esperarSegundos;
  }
}

/** O 401: a chave não vale mais (em qualquer pedido, ou no bilhete), e o computador sai do chat. */
export const ehChave = (e: unknown): boolean => e instanceof ErroChat && e.status === 401;

export interface ApiChat {
  desligar(): Promise<void>;
  entrar(ramal: string, nome: string): Promise<Pessoa>;
  colegas(): Promise<Pessoa[]>;
  conversas(): Promise<Conversa[]>;
  criarDupla(com: number): Promise<Conversa>;
  criarGrupo(nome: string, pessoas: number[]): Promise<Conversa>;
  membros(conversa: number): Promise<Membro[]>;
  porMembros(conversa: number, pessoas: number[]): Promise<void>;
  tirarMembro(conversa: number, pessoa: number): Promise<void>;
  mensagens(conversa: number, q: { antes?: number; depois?: number }): Promise<{ mensagens: Mensagem[]; temMais: boolean }>;
  enviar(conversa: number, corpo: { idLocal: string; texto: string } | { idLocal: string; arquivo: string }): Promise<Mensagem>;
  marcarLida(conversa: number, ate: number): Promise<void>;
  bilhete(): Promise<string>;
}

/**
 * Um pedido à API: o JSON da resposta (null num 204), ou o ErroChat. O prazo vale até o corpo inteiro chegar, num
 * setTimeout (o relógio dos testes o controla); o pedido que passa dele é cancelado e vira `rede`.
 */
async function pedir(base: string, chave: string | null, metodo: string, caminho: string, corpo?: object): Promise<unknown> {
  const cabecalhos: Record<string, string> = {};
  if (chave !== null) cabecalhos.Authorization = `Bearer ${chave}`;
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json; charset=utf-8';
  const cancelar = new AbortController();
  const prazo = setTimeout(() => cancelar.abort(), PRAZO_DA_RESPOSTA_MS);
  try {
    let resposta: Response;
    try {
      resposta = await fetch(`${base}/api/v1${caminho}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: cancelar.signal,
      });
    } catch {
      throw new ErroChat(0, 'rede');
    }
    let json: unknown = null;
    try {
      const texto = await resposta.text();
      json = texto ? JSON.parse(texto) : null;
    } catch {
      // O corpo que não chegou inteiro (também o do prazo), ou que não é o JSON do chat (o de um proxy): sem resposta.
      if (resposta.ok) throw new ErroChat(0, 'rede');
    }
    if (resposta.ok) return json;
    const e = (json ?? {}) as { erro?: unknown; campo?: unknown; esperarSegundos?: unknown };
    throw new ErroChat(resposta.status, typeof e.erro === 'string' ? e.erro : 'servidor', {
      campo: typeof e.campo === 'string' ? e.campo : undefined,
      esperarSegundos: typeof e.esperarSegundos === 'number' ? e.esperarSegundos : undefined,
    });
  } finally {
    clearTimeout(prazo);
  }
}

/** Liga o computador à empresa do código (o POST /api/v1/computadores, sem chave). A chave aparece só aqui. */
export async function ligarComputador(base: string, codigo: string, computador: string): Promise<{ chave: string; empresa: string }> {
  const r = (await pedir(base, null, 'POST', '/computadores', { codigo, computador })) as { chave?: unknown; empresa?: { nome?: unknown } } | null;
  const chave = r?.chave;
  const empresa = r?.empresa?.nome;
  if (typeof chave !== 'string' || typeof empresa !== 'string') throw new ErroChat(500, 'servidor');
  return { chave, empresa };
}

export function criarApi(base: string, chave: string): ApiChat {
  const p = (metodo: string, caminho: string, corpo?: object) => pedir(base, chave, metodo, caminho, corpo);
  return {
    async desligar() {
      await p('DELETE', '/computadores/eu');
    },
    async entrar(ramal, nome) {
      return ((await p('POST', '/pessoas/eu', { ramal, nome })) as { pessoa: Pessoa }).pessoa;
    },
    async colegas() {
      return ((await p('GET', '/pessoas')) as { pessoas: Pessoa[] }).pessoas;
    },
    async conversas() {
      return ((await p('GET', '/conversas')) as { conversas: Conversa[] }).conversas;
    },
    async criarDupla(com) {
      return ((await p('POST', '/conversas', { tipo: 'dupla', com })) as { conversa: Conversa }).conversa;
    },
    async criarGrupo(nome, pessoas) {
      return ((await p('POST', '/conversas', { tipo: 'grupo', nome, pessoas })) as { conversa: Conversa }).conversa;
    },
    async membros(conversa) {
      return ((await p('GET', `/conversas/${conversa}/membros`)) as { membros: Membro[] }).membros;
    },
    async porMembros(conversa, pessoas) {
      await p('POST', `/conversas/${conversa}/membros`, { pessoas });
    },
    async tirarMembro(conversa, pessoa) {
      await p('DELETE', `/conversas/${conversa}/membros/${pessoa}`);
    },
    async mensagens(conversa, q) {
      const busca = new URLSearchParams({ limite: String(POR_PAGINA) });
      if (q.antes !== undefined) busca.set('antes', String(q.antes));
      if (q.depois !== undefined) busca.set('depois', String(q.depois));
      return (await p('GET', `/conversas/${conversa}/mensagens?${busca}`)) as { mensagens: Mensagem[]; temMais: boolean };
    },
    async enviar(conversa, corpo) {
      return ((await p('POST', `/conversas/${conversa}/mensagens`, corpo)) as { mensagem: Mensagem }).mensagem;
    },
    async marcarLida(conversa, ate) {
      await p('POST', `/conversas/${conversa}/lida`, { ate });
    },
    async bilhete() {
      return ((await p('POST', '/eventos/bilhete')) as { bilhete: string }).bilhete;
    },
  };
}
