// Os objetos do chat, como o servidor os manda (docs/chat-protocolo.md, seção 4) e os eventos do WebSocket (seção 7).
// As horas são milissegundos desde 1970 (UTC).

export interface Pessoa {
  id: number;
  ramal: string;
  nome: string;
  /** A pessoa foi tirada do chat: o nome aparece com " (saiu)". */
  saiu: boolean;
}

export interface Arquivo {
  /** 32 caracteres hexadecimais. */
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  foto: boolean;
  miniatura: boolean;
  expirado: boolean;
}

/** `quem` é quem fez; o `alvo` é null no `criou` e no `saiu`. */
export interface AvisoDeGrupo {
  acao: 'criou' | 'pos' | 'tirou' | 'saiu';
  quem: Pessoa;
  alvo: Pessoa | null;
}

export interface Mensagem {
  id: number;
  conversa: number;
  autor: Pessoa | null;
  tipo: 'texto' | 'arquivo' | 'aviso';
  /** Só no tipo texto. */
  texto?: string;
  /** Só no tipo arquivo. */
  arquivo?: Arquivo;
  /** Só no tipo aviso. */
  aviso?: AvisoDeGrupo;
  idLocal: string | null;
  criadaEm: number;
}

/** A conversa a dois (`com` é a outra pessoa) ou o grupo (`cuida`: se eu cuido dele). */
export type Conversa =
  | { id: number; tipo: 'dupla'; com: Pessoa; ultima: Mensagem | null; naoLidas: number; atualizadaEm: number }
  | { id: number; tipo: 'grupo'; nome: string; pessoas: number; cuida: boolean; ultima: Mensagem | null; naoLidas: number; atualizadaEm: number };

export interface Membro {
  pessoa: Pessoa;
  cuida: boolean;
  criou: boolean;
}

export type Evento =
  | { tipo: 'mensagem'; mensagem: Mensagem }
  | { tipo: 'lida'; conversa: number; ate: number }
  | { tipo: 'conversa'; conversa: Conversa }
  | { tipo: 'conversaSaiu'; conversa: number }
  | { tipo: 'computadorNovo'; computador: string }
  | { tipo: 'fora' };
