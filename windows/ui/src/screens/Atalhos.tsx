// A aba Atalhos (rc.3, spec 3): a grade de duas colunas com até 8 cartões, "<n> de 8" no alto e "Adicionar atalho" nos
// espaços vazios. Cada cartão tem o ícone da ação, o nome, a ação e o número e, embaixo, a linha do BLF (só com
// `estado`: a bolinha e a palavra ao lado) com o "Mais opções" (⋯) no canto de baixo à direita. O clique usa o atalho
// (useShortcut: o que ele faz, e o puxar ligação de um ramal tocando, são do C++); o botão direito, ou o ⋯ pelo
// teclado, abre a edição (Editar e Remover, que pede a confirmação). Enviar teclas fica desativado fora da ligação (o
// C++ recusaria). Numa janela pequena, a grade rola dentro do corpo da aba (a navegação fica inteira). Ao voltar da
// edição, o foco volta ao que a abriu (o cartão, o "Mais opções" ou o "Adicionar atalho"): cada um leva um `data-foco`,
// e o `foco` que a aba recebe diz qual; sem ele (o atalho saiu, a grade encheu), o foco vai ao título. A ajuda de baixo só
// fala do puxar ligação com o `admin.puxa` (o BLF, o puxar e o código ligados): sem isso o clique num ramal tocando não puxa.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BlfBadge } from '../components/Blf';
import { Confirm } from '../components/Confirm';
import { Menu } from '../components/Menu';
import { shortcutLine, shortcutUsable } from '../format';
import { IconMore, IconPencil, IconPlus, IconTrash, ShortcutActionIcon } from '../icons';
import type { CallState, Shortcut } from '../state';
import type { Send } from '../types';

/** Quantos atalhos cabem (a loja do C++ recusa o 9º). */
export const MAX_ATALHOS = 8;

// Os `data-foco` dos botões a que o foco volta quando a edição fecha (os espaços vazios levam todos o mesmo: vale o primeiro).
const FOCO_NOVO = 'novo';
export const FOCO_TITULO = 'titulo';
const focoDoCartao = (id: string) => `cartao:${id}`;
const focoDoMais = (id: string) => `mais:${id}`;

interface Props {
  atalhos: Shortcut[];
  ligacao: CallState | null;
  send: Send;
  /** O clique num ramal tocando puxa a ligação (`admin.puxa`): só então a ajuda diz isso. */
  puxa: boolean;
  /** O que volta a ter o foco na montagem (o `foco` que o onNew ou o onEdit deu, da edição que acaba de fechar). */
  foco?: string;
  /** Adicionar atalho; `posicao` é o "<n> de 8" do formulário e `foco` o que volta a ter o foco quando ela fechar. */
  onNew(posicao: number, foco: string): void;
  onEdit(atalho: Shortcut, posicao: number, foco: string): void;
}

interface CartaoProps {
  atalho: Shortcut;
  usavel: boolean;
  /** A coluna da grade: o menu do ⋯ abre para o lado que cabe na janela (na esquerda, para a direita). */
  coluna: 'esquerda' | 'direita';
  send: Send;
  /** Abrir a edição; `foco` é o botão que volta a ter o foco quando ela fechar (o cartão ou o "Mais opções"). */
  onEdit(foco: string): void;
  onRemove(): void;
}

function Cartao({ atalho, usavel, coluna, send, onEdit, onRemove }: CartaoProps) {
  const [menu, setMenu] = useState<'baixo' | 'cima' | null>(null);
  const mais = useRef<HTMLButtonElement>(null);
  const abrirMenu = () => {
    if (menu) {
      setMenu(null);
      return;
    }
    // Perto do fim da janela, o menu abre para cima (não some atrás da navegação).
    const r = mais.current!.getBoundingClientRect();
    setMenu(r.bottom + 110 > window.innerHeight - 70 ? 'cima' : 'baixo');
  };
  return (
    <li class="atalho">
      {/* aria-disabled (e não disabled): o desativado continua recebendo o botão direito, que abre a edição. */}
      <button
        type="button"
        class="atalho-usar"
        data-foco={focoDoCartao(atalho.id)}
        aria-disabled={usavel ? undefined : 'true'}
        onClick={() => usavel && send({ cmd: 'useShortcut', id: atalho.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit(focoDoCartao(atalho.id));
        }}
      >
        <span class="tile atalho-tile" aria-hidden="true">
          <ShortcutActionIcon acao={atalho.acao} size="sm" />
        </span>
        <span class="atalho-texto">
          <span class="atalho-nome">{atalho.nome}</span>
          <span class="atalho-detalhe">{shortcutLine(atalho)}</span>
        </span>
        {/* A linha do BLF, embaixo de tudo: o "Mais opções" fica no fim dela (o nome tem a linha inteira). */}
        <span class="atalho-rodape">{atalho.estado !== null && <BlfBadge estado={atalho.estado} />}</span>
      </button>
      <button
        ref={mais}
        type="button"
        class="atalho-mais"
        data-foco={focoDoMais(atalho.id)}
        aria-label={`Mais opções para ${atalho.nome}`}
        title="Mais opções"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={abrirMenu}
      >
        <IconMore size="sm" />
      </button>
      {menu && (
        <Menu label={`Opções de ${atalho.nome}`} anchor={mais} onClose={() => setMenu(null)} class={`popover-atalho popover-${menu} popover-${coluna}`}>
          <button type="button" role="menuitem" class="menuitem" onClick={() => (setMenu(null), onEdit(focoDoMais(atalho.id)))}>
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

/** A confirmação antes de remover um atalho (na aba e na edição). */
export function RemoverAtalho({ atalho, onCancel, onConfirm }: { atalho: Shortcut; onCancel(): void; onConfirm(): void }) {
  return (
    <Confirm
      title="Remover atalho"
      message={`${atalho.nome} sai da lista de atalhos.`}
      confirmLabel="Remover"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function Atalhos({ atalhos, ligacao, send, puxa, foco, onNew, onEdit }: Props) {
  const [remover, setRemover] = useState<Shortcut | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const vazios = Math.max(0, MAX_ATALHOS - atalhos.length);
  // Voltando da edição: o foco vai ao que a abriu; se ele não existe mais, ao título (nunca fica no <body>).
  useEffect(() => {
    if (foco === undefined) return;
    const alvos = Array.from(raiz.current?.querySelectorAll<HTMLElement>('[data-foco]') ?? []);
    (alvos.find((e) => e.dataset.foco === foco) ?? alvos.find((e) => e.dataset.foco === FOCO_TITULO))?.focus();
  }, []);
  return (
    <div ref={raiz} class="body scroll atalhos">
      <div class="atalhos-topo">
        <h1 class="atalhos-titulo" data-foco={FOCO_TITULO} tabIndex={-1}>
          Atalhos
        </h1>
        <span class="atalhos-conta">{`${atalhos.length} de ${MAX_ATALHOS}`}</span>
      </div>
      <ul class="atalhos-grade">
        {atalhos.map((a, i) => (
          <Cartao
            key={a.id}
            atalho={a}
            usavel={shortcutUsable(a.acao, ligacao)}
            coluna={i % 2 === 0 ? 'esquerda' : 'direita'}
            send={send}
            onEdit={(volta) => onEdit(a, i + 1, volta)}
            onRemove={() => setRemover(a)}
          />
        ))}
        {Array.from({ length: vazios }, (_, i) => (
          <li class="atalho-vazio" key={`vazio-${i}`}>
            <button type="button" class="atalho-novo" data-foco={FOCO_NOVO} onClick={() => onNew(atalhos.length + 1, FOCO_NOVO)}>
              <IconPlus size="sm" />
              Adicionar atalho
            </button>
          </li>
        ))}
      </ul>
      <p class="atalhos-ajuda">
        Clique para usar. Clique com o botão direito para editar.
        {puxa && ' Num ramal tocando, o clique puxa a ligação.'}
      </p>
      {remover && (
        <RemoverAtalho
          atalho={remover}
          onCancel={() => setRemover(null)}
          onConfirm={() => {
            send({ cmd: 'removeShortcut', id: remover.id });
            setRemover(null);
          }}
        />
      )}
    </div>
  );
}
