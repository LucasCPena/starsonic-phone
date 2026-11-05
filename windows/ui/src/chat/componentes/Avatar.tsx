// O avatar de uma conversa (os quadros Main e Conversa): as iniciais da pessoa num círculo com o gradiente da marca, ou
// o ícone do grupo num quadrado arredondado. Só o desenho: o nome fica no texto ao lado.
import { initials } from '../../format';
import { IconContacts } from '../../icons';
import type { Conversa } from '../tipos';

export function Avatar({ conversa }: { conversa: Conversa }) {
  return conversa.tipo === 'grupo' ? (
    <span class="chat-avatar-grupo" aria-hidden="true">
      <IconContacts />
    </span>
  ) : (
    <span class="chat-avatar" aria-hidden="true">
      {initials(conversa.com.nome)}
    </span>
  );
}
