// Os Contatos: a busca por nome, número ou observação, o "+" (Novo contato), (rc.4) o "⋯" (Mais opções: Importar e
// Exportar planilha), a lista em ordem alfabética com as iniciais, e por contato o ramal ou número e a observação. Tocar
// no contato liga; o menu dele tem Editar e Remover. (rc.4) A lista junta os meus com os da lista da empresa (a última
// contatosEmpresa): os da empresa têm a etiqueta "Empresa", não têm o menu (mudam só na planilha) e ligam pela regra dos
// contatos, como os meus; um da empresa com o mesmo nome (sem acento e sem caixa) e os mesmos dígitos de um meu some
// (fica o meu). Com a planilha da empresa configurada, os filtros Todos, Meus e Empresa (os do Recentes) ficam em cima
// da lista; sem ela, a lista é a de todos.
// A lista da empresa pode ter 10.000 contatos: a junção, a ordem e a busca usam o que cada linha já tem calculado, e a
// linha de cada contato é montada uma vez e reaproveitada (o Preact pula o mesmo vnode), então um estado novo (um BLF,
// uma ligação) ou a busca não redesenham a lista inteira.
import type { VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Confirm } from '../components/Confirm';
import { Menu } from '../components/Menu';
import { contactNumberLine, digitsOnly, fold, groupLetter, initials } from '../format';
import { IconMore, IconPencil, IconPhone, IconPlus, IconSearch, IconTrash } from '../icons';
import type { CompanyContact, Contact } from '../state';
import type { Send } from '../types';

interface Props {
  contatos: Contact[];
  /** (rc.4) A lista da empresa (a última contatosEmpresa), na ordem da planilha. */
  daEmpresa: CompanyContact[];
  /** (rc.4) Há uma planilha da empresa configurada (`empresa.link`): os filtros aparecem. */
  comPlanilha: boolean;
  send: Send;
  onNew(): void;
  onEdit(contato: Contact): void;
}

type Filtro = 'todos' | 'meus' | 'empresa';

const FILTROS: Array<{ filtro: Filtro; texto: string }> = [
  { filtro: 'todos', texto: 'Todos' },
  { filtro: 'meus', texto: 'Meus' },
  { filtro: 'empresa', texto: 'Empresa' },
];

/** A lista vazia de cada filtro (sem busca). */
const VAZIA: Record<Filtro, string> = {
  todos: 'Nenhum contato ainda.',
  meus: 'Nenhum contato seu ainda.',
  empresa: 'Nenhum contato da empresa.',
};

/** Uma linha da lista: um contato meu (`meu`, com o menu) ou um da lista da empresa, com a busca e a ordem já calculadas. */
interface Linha {
  key: string;
  nome: string;
  numero: string;
  observacao: string;
  /** O meu contato (Editar e Remover); null num da empresa. */
  meu: Contact | null;
  /** O nome e a observação sem acento e sem caixa, e os dígitos do número. */
  nomeBusca: string;
  obsBusca: string;
  digitos: string;
  /** A letra do grupo ("#" para número ou símbolo). */
  letra: string;
}

function linha(key: string, c: CompanyContact, meu: Contact | null): Linha {
  return {
    key,
    nome: c.nome,
    numero: c.numero,
    observacao: c.observacao,
    meu,
    nomeBusca: fold(c.nome),
    obsBusca: fold(c.observacao),
    digitos: digitsOnly(c.numero),
    letra: groupLetter(c.nome),
  };
}

/** A ordem da lista: o grupo "#" primeiro e as letras depois; no grupo, o nome sem acento e sem caixa. */
function ordem(a: Linha, b: Linha): number {
  if (a.letra !== b.letra) return a.letra === '#' ? -1 : b.letra === '#' ? 1 : a.letra < b.letra ? -1 : 1;
  return a.nomeBusca < b.nomeBusca ? -1 : a.nomeBusca > b.nomeBusca ? 1 : 0;
}

/**
 * Os meus e os da empresa numa lista só, em ordem; some o da empresa com o mesmo nome e os mesmos dígitos de um meu. No
 * empate da ordem, os meus vêm antes (a ordenação é estável).
 */
function juntar(meus: Linha[], daEmpresa: Linha[]): Linha[] {
  const chave = (l: Linha) => `${l.digitos} ${l.nomeBusca}`;
  const minhas = new Set(meus.map(chave));
  return [...meus, ...daEmpresa.filter((l) => !minhas.has(chave(l)))].sort(ordem);
}

/** A busca no nome e na observação (sem acento e sem caixa) e nos dígitos do número. */
function bate(l: Linha, termo: string, digitos: string): boolean {
  if (!termo) return true;
  if (l.nomeBusca.includes(termo) || l.obsBusca.includes(termo)) return true;
  return digitos.length > 0 && l.digitos.includes(digitos);
}

/** O toque na linha liga: as iniciais, o nome (com a etiqueta "Empresa", num da empresa) e o ramal ou número. */
function rowHit(l: Linha, ligar: () => void): VNode {
  const sub = l.observacao ? `${contactNumberLine(l.numero)} · ${l.observacao}` : contactNumberLine(l.numero);
  return (
    <button type="button" class="row-hit" onClick={ligar}>
      <span class="avatar" aria-hidden="true">
        {initials(l.nome)}
      </span>
      <span class="row-main">
        {l.meu ? (
          <span class="row-title">{l.nome}</span>
        ) : (
          <span class="row-nome">
            <span class="row-title">{l.nome}</span>
            <span class="etiqueta">Empresa</span>
          </span>
        )}
        <span class="row-sub">{sub}</span>
      </span>
    </button>
  );
}

// O ícone de ligar é o mesmo em todas as linhas: um vnode só (sem um componente por linha, numa lista de 10.000).
const ICONE_LIGAR = IconPhone({ size: 'sm' });

function callButton(nome: string, ligar: () => void): VNode {
  return (
    <button type="button" class="row-call" aria-label={`Ligar para ${nome}`} title={`Ligar para ${nome}`} onClick={ligar}>
      {ICONE_LIGAR}
    </button>
  );
}

function ContactRow({ l, c, send, onEdit, onRemove }: { l: Linha; c: Contact; send: Send; onEdit(c: Contact): void; onRemove(c: Contact): void }) {
  const [menu, setMenu] = useState<'baixo' | 'cima' | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
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
      {rowHit(l, ligar)}
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
      {callButton(c.nome, ligar)}
      {menu && (
        <Menu label={`Opções de ${c.nome}`} anchor={botao} onClose={() => setMenu(null)} class={`popover-row popover-${menu}`}>
          <button type="button" role="menuitem" class="menuitem" onClick={() => (setMenu(null), onEdit(c))}>
            <IconPencil size="sm" />
            Editar
          </button>
          <button type="button" role="menuitem" class="menuitem" onClick={() => (setMenu(null), onRemove(c))}>
            <IconTrash size="sm" />
            Remover
          </button>
        </Menu>
      )}
    </li>
  );
}

/** (rc.4) Um contato da lista da empresa: sem o menu (muda só na planilha). Sem estado: um vnode, não um componente. */
function companyRow(l: Linha, send: Send): VNode {
  const ligar = () => send({ cmd: 'dial', numero: l.numero, contato: true });
  return (
    <li key={l.key} class="row row-empresa">
      {rowHit(l, ligar)}
      {callButton(l.nome, ligar)}
    </li>
  );
}

/** (rc.4) O "⋯" ao lado do "+": Importar e Exportar planilha (as janelas do Windows; o resultado vem num toast). */
function MaisOpcoes({ send }: { send: Send }) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  // Escolhido um item, o foco volta ao "⋯" (a tela continua a mesma).
  const escolher = (cmd: 'importContacts' | 'exportContacts') => {
    setAberto(false);
    botao.current?.focus();
    send({ cmd });
  };
  return (
    <div class="menu-wrap">
      <button
        ref={botao}
        type="button"
        class="row-call"
        aria-label="Mais opções"
        title="Mais opções"
        aria-haspopup="menu"
        aria-expanded={aberto}
        style={{ width: '44px', height: '44px' }}
        onClick={() => setAberto(!aberto)}
      >
        <IconMore />
      </button>
      {aberto && (
        <Menu label="Mais opções" anchor={botao} onClose={() => setAberto(false)} class="popover-menu">
          <button type="button" role="menuitem" class="menuitem" onClick={() => escolher('importContacts')}>
            Importar planilha…
          </button>
          <button type="button" role="menuitem" class="menuitem" onClick={() => escolher('exportContacts')}>
            Exportar planilha…
          </button>
        </Menu>
      )}
    </div>
  );
}

export function Contatos({ contatos, daEmpresa, comPlanilha, send, onNew, onEdit }: Props) {
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<Filtro>('todos');
  const [remover, setRemover] = useState<Contact | null>(null);
  // Sem a planilha da empresa, sem os filtros: a lista é a de todos. A planilha que sai com outro filtro escolhido volta
  // ao Todos (o padrão), também para quando uma planilha voltar.
  const filtro = comPlanilha ? escolhido : 'todos';
  useEffect(() => {
    if (!comPlanilha) setEscolhido('todos');
  }, [comPlanilha]);

  // Cada estado novo traz outra cópia dos meus contatos: a lista só muda quando eles mudam de verdade.
  const meusComoEstao = JSON.stringify(contatos);
  const meus = useMemo(() => contatos.map((c) => linha(c.id, c, c)), [meusComoEstao]);
  const daPlanilha = useMemo(() => daEmpresa.map((c, i) => linha(`empresa:${i}`, c, null)), [daEmpresa]);
  const todas = useMemo(() => juntar(meus, daPlanilha), [meus, daPlanilha]);
  const termo = fold(busca.trim());
  const digitos = digitsOnly(busca);
  const grupos = useMemo(() => {
    const lista: Array<{ letra: string; itens: Linha[] }> = [];
    for (const l of todas) {
      if ((filtro !== 'todos' && (filtro === 'meus') !== (l.meu !== null)) || !bate(l, termo, digitos)) continue;
      const ultimo = lista[lista.length - 1];
      if (ultimo && ultimo.letra === l.letra) ultimo.itens.push(l);
      else lista.push({ letra: l.letra, itens: [l] });
    }
    return lista;
  }, [todas, filtro, termo, digitos]);

  // A linha de cada contato, montada uma vez (o Editar chama o onEdit de agora).
  const editar = useRef(onEdit);
  editar.current = onEdit;
  const linhas = useMemo(() => new WeakMap<Linha, VNode>(), [send]);
  const linhaDe = (l: Linha): VNode => {
    let pronta = linhas.get(l);
    if (!pronta) {
      pronta = l.meu ? (
        <ContactRow key={l.key} l={l} c={l.meu} send={send} onEdit={(c) => editar.current(c)} onRemove={setRemover} />
      ) : (
        companyRow(l, send)
      );
      linhas.set(l, pronta);
    }
    return pronta;
  };

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
        <MaisOpcoes send={send} />
      </div>
      {comPlanilha && (
        <div class="filters">
          {FILTROS.map((f) => (
            <button
              key={f.filtro}
              type="button"
              class={filtro === f.filtro ? 'pill pill-on' : 'pill'}
              aria-pressed={filtro === f.filtro}
              onClick={() => setEscolhido(f.filtro)}
            >
              {f.texto}
            </button>
          ))}
        </div>
      )}
      {grupos.length === 0 && <p class="empty">{busca.trim() ? 'Nenhum contato encontrado.' : VAZIA[filtro]}</p>}
      {grupos.map((g) => (
        <section key={g.letra} aria-label={g.letra}>
          <h2 class="group">{g.letra}</h2>
          <ul class="list">{g.itens.map(linhaDe)}</ul>
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
