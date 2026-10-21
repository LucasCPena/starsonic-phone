// Os tipos da ponte, versão 1 (docs/ponte-windows.md). Uma mudança no formato muda o documento, o
// starsonic/desktop/Protocol.cpp e este arquivo juntos. A interface só desenha este estado e manda comandos.

export const PROTOCOL_VERSION = 1;

export type Protocol = 'udp' | 'tcp';
export type Screen = 'entrar' | 'principal';
export type AccountStatus = 'conectado' | 'conectando' | 'sem_conexao' | 'erro';
export type RecentKind = 'feita' | 'recebida' | 'perdida';
export type CallPhase = 'ringing' | 'dialing' | 'active';
export type SecondKind = 'none' | 'ringing' | 'held' | 'active';
export type RingKind = 'completo' | 'espera' | 'parar';

/** A tela Entrar (também Adicionar e Editar conta). A senha nunca vem. */
export interface LoginForm {
  servidor: string;
  protocolo: Protocol;
  ramal: string;
  nome: string;
  /** A mensagem embaixo da senha ("" = nenhuma). */
  erro: string;
  /** Esperando o registro (ou o fim da ligação): "Conectando…", campos travados. */
  ocupado: boolean;
  /** A conta veio sem a senha: os campos vêm preenchidos e só falta a senha. */
  pedeSenha: boolean;
  /** A conta que a tela edita ("" = conta nova). */
  contaId: string;
}

/** A conta em uso (o cabeçalho). */
export interface CurrentAccount {
  id: string;
  /** Pode ser "" (a interface mostra o ramal). */
  nome: string;
  ramal: string;
  servidor: string;
  protocolo: Protocol;
  status: AccountStatus;
  /** A linha do cabeçalho; pode ser "" com sem_conexao. */
  texto: string;
}

export interface SavedAccount {
  id: string;
  nome: string;
  ramal: string;
  servidor: string;
  protocolo: Protocol;
  emUso: boolean;
}

export interface AutoAnswer {
  on: boolean;
  /** De 0 a 30. */
  segundos: number;
}

/** Um cartão da tela da ligação (os nomes do CallSnapshot do C++). */
export interface CallCard {
  /** O id da ligação no motor; 0 numa feita que ainda não tem id. */
  id: number;
  number: string;
  /** Já resolvido; "" sem contato nem nome da central (a interface mostra o número). */
  name: string;
  incoming: boolean;
  phase: CallPhase;
  /** ms desde 1970; 0: ainda não atendida. */
  activeSinceMs: number;
  held: boolean;
}

export interface CallState {
  top: CallCard;
  second: CallCard | null;
  /** Na conferência a outra vem como "active": a interface olha `conference` antes de `secondKind`. */
  secondKind: SecondKind;
  muted: boolean;
  conference: boolean;
  conferenceSinceMs: number;
  consulting: boolean;
  colleagueActive: boolean;
}

export interface RecentCall {
  numero: string;
  /** Já resolvido; "" = a interface mostra o número. */
  nome: string;
  tipo: RecentKind;
  /** ms desde 1970. */
  inicio: number;
  /** Desde o atendimento, em milissegundos (0 na perdida e na feita que não completou). */
  duracao: number;
  /** O contato com esse número ("" = nenhum: a linha oferece "Salvar contato"). */
  contatoId: string;
}

export interface Contact {
  id: string;
  nome: string;
  numero: string;
  observacao: string;
}

export interface AudioDevice {
  /** Só da lista de agora: a escolha vai pelo nome. */
  id: number;
  nome: string;
}

export interface AudioSettings {
  microfones: AudioDevice[];
  altoFalantes: AudioDevice[];
  /** O nome escolhido ("" = o padrão do Windows). */
  microfone: string;
  altoFalante: string;
  /** O deviceId do toque, da interface ("" = o padrão). */
  toque: string;
  /** Os nomes escolhidos que não estão conectados agora. */
  desconectados: string[];
}

export interface AppState {
  tela: Screen;
  entrar: LoginForm;
  conta: CurrentAccount | null;
  contas: SavedAccount[];
  naoPerturbe: boolean;
  atenderAutomatico: AutoAnswer;
  ligacao: CallState | null;
  /** A mais nova primeiro. */
  recentes: RecentCall[];
  perdidas: number;
  /** Em ordem alfabética (sem acento e sem caixa). */
  contatos: Contact[];
  audio: AudioSettings;
  iniciarComWindows: boolean;
  versao: string;
  teclado: string;
  tecladoVez: number;
}

/** C++ → interface. */
export type IncomingMessage =
  | { v: number; type: 'state'; state: AppState }
  | { v: number; type: 'toast'; texto: string }
  | { v: number; type: 'ring'; tipo: RingKind }
  | { v: number; type: 'update'; versao: string; notas: string };

/** Interface → C++ (sem o `v`, que a ponte acrescenta). */
export type Command =
  | { cmd: 'ready' }
  | { cmd: 'minimize' }
  | { cmd: 'closeToTray' }
  | { cmd: 'quit' }
  | { cmd: 'sendDiagnostics' }
  | { cmd: 'openExternal'; url: ExternalUrl }
  | {
      cmd: 'login';
      servidor: string;
      protocolo: Protocol;
      ramal: string;
      senha: string;
      nome?: string;
      contaId?: string;
    }
  | { cmd: 'selectAccount'; contaId: string }
  | { cmd: 'removeAccount'; contaId: string }
  | { cmd: 'dial'; numero: string; contato?: boolean }
  | { cmd: 'answer' }
  | { cmd: 'reject' }
  | { cmd: 'hangup'; id?: number }
  | { cmd: 'hold'; on?: boolean }
  | { cmd: 'mute'; on?: boolean }
  | { cmd: 'dtmf'; digitos: string }
  | { cmd: 'transfer'; numero: string }
  | { cmd: 'consult'; numero: string }
  | { cmd: 'completeTransfer' }
  | { cmd: 'cancelConsult' }
  | { cmd: 'swap' }
  | { cmd: 'join' }
  | { cmd: 'split' }
  | { cmd: 'setDnd'; on: boolean }
  | { cmd: 'setAutoAnswer'; on: boolean; segundos?: number }
  | { cmd: 'setAudio'; microfone?: string; altoFalante?: string; toque?: string }
  | { cmd: 'setSetting'; chave: 'iniciarComWindows'; valor: boolean }
  | { cmd: 'saveContact'; id?: string; nome: string; numero: string; observacao?: string }
  | { cmd: 'removeContact'; id: string }
  | { cmd: 'viewRecents' }
  | { cmd: 'updateNow' }
  | { cmd: 'updateLater' };

/** Os únicos endereços que o openExternal aceita. */
export const EXTERNAL_URLS = {
  site: 'https://starsonic.com.br',
  whatsapp: 'https://wa.me/551150603000',
  telefone: 'tel:+551150603000',
  codigo: 'https://github.com/LucasCPena/starsonic-phone',
} as const;
export type ExternalUrl = (typeof EXTERNAL_URLS)[keyof typeof EXTERNAL_URLS] | 'https://starsonic.com.br/';
