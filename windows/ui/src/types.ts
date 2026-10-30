// Tipos da navegação da interface (o que não vem do C++).
import type { Command, Contact, Shortcut } from './state';

export type Send = (command: Command) => void;

/** As abas, na ordem da navegação (Ctrl+1 a 4). */
export type Tab = 'teclado' | 'atalhos' | 'recentes' | 'contatos';

export type View =
  /** `foco`: o que volta a ter o foco quando a aba volta de uma edição (o `data-foco` do botão que a abriu); vale uma vez. */
  | { kind: 'tab'; tab: Tab; foco?: string }
  | { kind: 'configuracoes' }
  | { kind: 'sobre' }
  /** Adicionar (sem contaId) ou Editar conta: a tela Entrar como formulário. */
  | { kind: 'conta'; contaId?: string; back: View }
  /** Novo contato (com o número e o nome dos Recentes, se vier de lá) ou Editar. */
  | { kind: 'contato'; contato?: Contact; numero?: string; nome?: string; back: View }
  /** rc.3: Adicionar (sem atalho) ou Editar atalho; `posicao` é o "<n> de 8" do alto. */
  | { kind: 'atalho'; atalho?: Shortcut; posicao: number; back: View }
  /** rc.3: a área do administrador (só com ela aberta no C++). */
  | { kind: 'admin'; back: View }
  /** (iPhone) Os avisos de licença, abertos pelo Sobre. */
  | { kind: 'licencas'; back: View };
