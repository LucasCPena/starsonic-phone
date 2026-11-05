// Tipos da navegação da interface (o que não vem do C++).
import type { Command, Contact, Shortcut } from './state';

export type Send = (command: Command) => void;

/** As abas, na ordem da navegação (Ctrl+1 a 5). (0.2.0) O Chat só aparece com o computador ligado ao chat. */
export type Tab = 'teclado' | 'atalhos' | 'recentes' | 'contatos' | 'chat';

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
  | { kind: 'licencas'; back: View }
  /** (0.2.0) O chat: a conversa (Task 6), a nova conversa e o novo grupo (Task 5), os membros e o pôr pessoas no grupo
   *  (Task 5). Até a tela de cada uma existir, o main.tsx mostra o Teclado no lugar. */
  | { kind: 'chatConversa'; conversa: number; back: View }
  | { kind: 'chatNova'; back: View }
  | { kind: 'chatNovoGrupo'; back: View }
  | { kind: 'chatMembros'; conversa: number; back: View }
  | { kind: 'chatPor'; conversa: number; back: View };
