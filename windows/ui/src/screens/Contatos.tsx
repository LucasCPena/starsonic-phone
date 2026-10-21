// Os Contatos: a busca por nome ou número, o "+" (Novo contato), a lista em ordem alfabética com as iniciais, e por
// contato o ramal ou número e a observação. Tocar no contato liga; o menu dele tem Editar e Remover.
import { useRef, useState } from 'preact/hooks';
import { Confirm } from '../components/Confirm';
import { Menu } from '../components/Menu';
import { contactNumberLine, digitsOnly, fold, groupLetter, initials } from '../format';
import { IconMore, IconPencil, IconPhone, IconPlus, IconSearch, IconTrash } from '../icons';
import type { Contact } from '../state';
import type { Send } from '../types';

interface Props {
  contatos: Contact[];
  send: Send;
  onNew(): void;
  onEdit(contato: Contact): void;
}

function matches(c: Contact, busca: string): boolean {
  const termo = fold(busca.trim());
  if (!termo) return true;
  if (fold(c.nome).includes(termo) || fold(c.observacao).includes(termo)) return true;
  const digitos = digitsOnly(busca);
  return digitos.length > 0 && digitsOnly(c.numero).includes(digitos);
}

function ContactRow({ c, send, onEdit, onRemove }: { c: Contact; send: Send; onEdit(): void; onRemove(): void }) {
  const [menu, setMenu] = useState<'baixo' | 'cima' | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const sub = c.observacao ? `${contactNumberLine(c.numero)} · ${c.observacao}` : contactNumberLine(c.numero);
  const ligar = () => send({ cmd: 'dial', numero: c.numero, contato: true });
  const abrirMenu = () => {
    if (menu) {
      setMenu(null);
      return;
    }
    // Perto do fim da janela, o menu abre para cima (não some atrás da navegação).
    const r = botao.current!.getBoundingClientRect();
    setMenu(r.bottom + 110 > window.innerHeight - 70 ? 'cima' : 'baixo');
  };
  return (
    <li class="row" style={{ position: 'relative' }}>
      <button type="button" class="row-hit" onClick={ligar}>
        <span class="avatar" aria-hidden="true">
          {initials(c.nome)}
        </span>
        <span class="row-main">
          <span class="row-title">{c.nome}</span>
          <span class="row-sub">{sub}</span>
        </span>
      </button>
      <button
        ref={botao}
        type="button"
        class="row-more"
        aria-label={`Mais opções para ${c.nome}`}
        title="Mais opções"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={abrirMenu}
      >
        <IconMore size="sm" />
      </button>
      <button type="button" class="row-call" aria-label={`Ligar para ${c.nome}`} title={`Ligar para ${c.nome}`} onClick={ligar}>
        <IconPhone size="sm" />
      </button>
      {menu && (
        <Menu label={`Opções de ${c.nome}`} anchor={botao} onClose={() => setMenu(null)} class={`popover-row popover-${menu}`}>
          <button type="button" role="menuitem" class="menuitem" onClick={() => (setMenu(null), onEdit())}>
            <IconPencil size="sm" />
            Editar
          </button>
          <button type="button" role="menuitem" class="menuitem" onClick={() => (setMenu(null), onRemove())}>
            <IconTrash size="sm" />
            Remover
          </button>
        </Menu>
      )}
    </li>
  );
}

export function Contatos({ contatos, send, onNew, onEdit }: Props) {
  const [busca, setBusca] = useState('');
  const [remover, setRemover] = useState<Contact | null>(null);
  const lista = contatos.filter((c) => matches(c, busca));
  const grupos: Array<{ letra: string; itens: Contact[] }> = [];
  for (const c of lista) {
    const letra = groupLetter(c.nome);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.letra === letra) ultimo.itens.push(c);
    else grupos.push({ letra, itens: [c] });
  }

  return (
    <div class="body scroll" style={{ gap: '10px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 'none' }}>
        <label class="search">
          <IconSearch size="sm" />
          <input
            type="search"
            aria-label="Buscar contato"
            placeholder="Buscar contato"
            autocomplete="off"
            value={busca}
            onInput={(e) => setBusca(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && busca) {
                e.stopPropagation();
                setBusca('');
              }
            }}
          />
        </label>
        <button type="button" class="row-call" aria-label="Novo contato" title="Novo contato" style={{ width: '44px', height: '44px' }} onClick={onNew}>
          <IconPlus />
        </button>
      </div>
      {lista.length === 0 && <p class="empty">{busca.trim() ? 'Nenhum contato encontrado.' : 'Nenhum contato ainda.'}</p>}
      {grupos.map((g) => (
        <section key={g.letra} aria-label={g.letra}>
          <h2 class="group">{g.letra}</h2>
          <ul class="list">
            {g.itens.map((c) => (
              <ContactRow key={c.id} c={c} send={send} onEdit={() => onEdit(c)} onRemove={() => setRemover(c)} />
            ))}
          </ul>
        </section>
      ))}
      {remover && (
        <Confirm
          title="Remover contato"
          message={`${remover.nome} sai da lista de contatos.`}
          confirmLabel="Remover"
          onCancel={() => setRemover(null)}
          onConfirm={() => {
            send({ cmd: 'removeContact', id: remover.id });
            setRemover(null);
          }}
        />
      )}
    </div>
  );
}
