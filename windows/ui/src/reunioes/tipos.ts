// Os tipos das reuniões na interface (docs/chat-protocolo.md, seções 9 e 11).

/** Uma reunião do chat (a Reunião da seção 9). */
export interface Reuniao {
  codigo: string;
  link: string;
  tipo: 'marcada' | 'naHora';
  assunto: string | null;
  inicio: number | null;
  valeAte: number | null;
  criouEu: boolean;
  acontecendo: boolean;
  pessoas: number;
}

/** Quem pede para entrar na reunião (o `id` tem 16 caracteres hexadecimais). */
export interface Pedido {
  id: string;
  nome: string;
}

/** Quem está na reunião. */
export interface Participante {
  id: string;
  nome: string;
  deFora: boolean;
  tela: boolean;
}

/** Os eventos das reuniões que o chat manda a quem está nelas (seção 11). */
export type EventoDaReuniao =
  | { tipo: 'reuniaoPedido'; reuniao: string; pedido: Pedido }
  | { tipo: 'reuniaoPedidoFim'; reuniao: string; pedido: string }
  | { tipo: 'reuniaoParticipantes'; reuniao: string; participantes: Participante[]; pedidos: Pedido[] }
  | { tipo: 'reuniaoAcabou'; reuniao: string };
