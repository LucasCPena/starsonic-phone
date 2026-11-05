// Os eventos do chat (docs/chat-protocolo.md, seção 7): o bilhete, pedido com a chave, e o WebSocket dele, no mesmo
// endereço da API (https vira wss). O evento `fora` e o fechamento com 4001 (o computador saiu do chat) param tudo, como
// um 401 no bilhete. Os outros fechamentos (4000: o computador conectou de novo; 4002: ele ficou lento; 1001: o
// servidor vai desligar) e a queda sem código reconectam depois do esperaDaVez; um 429 no bilhete espera o
// esperarSegundos dele. Quem chama relê o que perdeu a cada `conectou`.
import { ErroChat, type ApiChat } from './api';
import type { Evento } from './tipos';

/** As esperas da reconexão, uma por tentativa; depois da última, ela vale para todas. */
export const ESPERAS_MS = [1000, 2000, 5000, 10000, 30000];
/** Um 429 espera o esperarSegundos, no máximo isto. */
const ESPERA_MAXIMA_DO_LIMITE_MS = 60_000;
/** O fechamento do computador que saiu do chat. */
const FECHOU_FORA = 4001;

/** A espera antes da tentativa (0, a primeira): a da tabela vezes um fator entre 0,5 e 1,5 (`aleatorio` de 0 a 1). */
export function esperaDaVez(tentativa: number, aleatorio: number): number {
  return ESPERAS_MS[Math.min(tentativa, ESPERAS_MS.length - 1)] * (0.5 + aleatorio);
}

/** A espera de um 429 (o `limite` ou as `tentativas`): o esperarSegundos, no máximo 60 s. */
export function esperaDoLimite(e: ErroChat): number {
  return Math.min(Math.max(0, e.esperarSegundos ?? 0) * 1000, ESPERA_MAXIMA_DO_LIMITE_MS);
}

const numero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** O evento de uma mensagem do WebSocket; null para o que não é um evento conhecido. */
function lerEvento(dados: unknown): Evento | null {
  let e: unknown;
  try {
    e = typeof dados === 'string' ? JSON.parse(dados) : null;
  } catch {
    return null;
  }
  if (!objeto(e)) return null;
  switch (e.tipo) {
    case 'mensagem':
      return objeto(e.mensagem) && numero(e.mensagem.id) && numero(e.mensagem.conversa) ? (e as Evento) : null;
    case 'lida':
      return numero(e.conversa) && numero(e.ate) ? (e as Evento) : null;
    case 'conversa':
      return objeto(e.conversa) && numero(e.conversa.id) ? (e as Evento) : null;
    case 'conversaSaiu':
      return numero(e.conversa) ? (e as Evento) : null;
    case 'computadorNovo':
      return typeof e.computador === 'string' ? (e as Evento) : null;
    case 'fora':
      return { tipo: 'fora' };
    default:
      return null;
  }
}

export function conectarEventos(
  base: string,
  api: Pick<ApiChat, 'bilhete'>,
  ao: { evento(e: Evento): void; conectou(): void; caiu(): void; fora(): void },
): { parar(): void } {
  const endereco = `${base.replace(/^http/i, 'ws')}/api/v1/eventos`;
  let parado = false;
  let socket: WebSocket | null = null;
  let espera: ReturnType<typeof setTimeout> | undefined;
  let tentativa = 0;

  const parar = () => {
    parado = true;
    clearTimeout(espera);
    const s = socket;
    socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = null;
      s.close();
    }
  };
  // O computador saiu do chat: uma vez só (o `fora` vem antes do 4001).
  const sair = () => {
    if (parado) return;
    parar();
    ao.fora();
  };
  const deNovo = (ms: number) => {
    if (parado) return;
    ao.caiu();
    espera = setTimeout(abrir, ms);
  };
  const depoisDaFalha = () => deNovo(esperaDaVez(tentativa++, Math.random()));

  async function abrir(): Promise<void> {
    let bilhete: string;
    try {
      bilhete = await api.bilhete();
    } catch (e) {
      if (parado) return;
      if (e instanceof ErroChat && e.status === 401) sair();
      else if (e instanceof ErroChat && e.status === 429) deNovo(esperaDoLimite(e));
      else depoisDaFalha();
      return;
    }
    if (parado) return;
    let s: WebSocket;
    try {
      s = new WebSocket(`${endereco}?bilhete=${encodeURIComponent(bilhete)}`);
    } catch {
      depoisDaFalha();
      return;
    }
    socket = s;
    s.onopen = () => {
      tentativa = 0;
      ao.conectou();
    };
    s.onmessage = (m) => {
      const e = lerEvento(m.data);
      if (!e) return;
      if (e.tipo === 'fora') sair();
      else ao.evento(e);
    };
    s.onclose = (f) => {
      socket = null;
      if (f.code === FECHOU_FORA) sair();
      else depoisDaFalha();
    };
  }

  void abrir();
  return { parar };
}
