// Tipos da navegação da interface (o que não vem do C++).
import type { Command, Contact } from './state';

export type Send = (command: Command) => void;

export type Tab = 'teclado' | 'recentes' | 'contatos';

export type View =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'configuracoes' }
  | { kind: 'sobre' }
  /** Adicionar (sem contaId) ou Editar conta: a tela Entrar como formulário. */
  | { kind: 'conta'; contaId?: string; back: View }
  /** Novo contato (com o número e o nome dos Recentes, se vier de lá) ou Editar. */
  | { kind: 'contato'; contato?: Contact; numero?: string; nome?: string; back: View };
