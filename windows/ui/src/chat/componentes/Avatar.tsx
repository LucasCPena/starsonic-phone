// O avatar de uma conversa (os quadros Main e Conversa): as iniciais da pessoa num círculo com o gradiente da marca, ou
// o ícone do grupo num quadrado arredondado. (Task 5) O de uma pessoa (os colegas e os membros): as iniciais dela. Só o
// desenho: o nome fica no texto ao lado.
import { initials } from '../../format';
import { IconContacts } from '../../icons';
import type { Conversa, Pessoa } from '../tipos';

export function Avatar(p: { conversa: Conversa } | { pessoa: Pessoa }) {
  const pessoa = 'pessoa' in p ? p.pessoa : p.conversa.tipo === 'dupla' ? p.conversa.com : null;
  return pessoa ? (
    <span class="chat-avatar" aria-hidden="true">
      {initials(pessoa.nome)}
    </span>
  ) : (
    <span class="chat-avatar-grupo" aria-hidden="true">
      <IconContacts />
    </span>
  );
}
