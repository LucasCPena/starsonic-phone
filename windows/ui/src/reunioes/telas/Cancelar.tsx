// O cancelar de uma reunião (o quadro Cancelar, a tela 5): "Cancelar a reunião?", o assunto e a hora, o que acontece
// com o link e com quem está nela, o "Voltar" e o "Cancelar a reunião". Um <dialog> modal (o showModal, como o
// EncerrarSala), com o foco no Voltar. O Voltar e o Esc fecham com o close() antes de avisar, e quem mostra a pergunta
// devolve o foco ao botão do menu. A falha fica num `alert` dentro do diálogo, que continua aberto; com o pedido no ar,
// o "Cancelar a reunião" fica desligado. Se a reunião sai da tela com a pergunta aberta (o cancelar deu certo, e a
// lista foi relida), o foco vai para o "Nova reunião", esteja ele dentro do diálogo ou solto no `body`: o botão que
// estava com o foco fica desligado com o pedido no ar (o `disabled`, que o teste da pergunta confere), e o Chromium
// tira o foco de um botão desligado.
import type { VNode } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { quando, textoDoCancelar } from '../formato';
import {
  CANCELAR_A_REUNIAO,
  CANCELAR_A_REUNIAO_PERGUNTA,
  SEM_ASSUNTO,
  SERVIDOR_NAO_RESPONDEU,
  VOLTAR,
} from '../textos';
import type { Reuniao } from '../tipos';

interface Props {
  reuniao: Reuniao;
  agora: number;
  /** O pedido de cancelar está no ar. */
  ocupado: boolean;
  /** O último pedido falhou: o `alert` diz o que houve. */
  falhou: boolean;
  /** O Voltar e o Esc. */
  onVoltar(): void;
  onCancelar(): void;
}

/** "Planejamento de dezembro · hoje, 14:00": o `quando` da lista, com a primeira letra minúscula. */
function quemEQuando(r: Reuniao, agora: number): string {
  const assunto = r.assunto || SEM_ASSUNTO;
  if (r.inicio === null) return assunto;
  const q = quando(r.inicio, agora);
  return `${assunto} · ${q[0].toLowerCase()}${q.slice(1)}`;
}

export function Cancelar({ reuniao, agora, ocupado, falhou, onVoltar, onCancelar }: Props): VNode {
  const ref = useRef<HTMLDialogElement>(null);
  // O voltar de agora para o `cancel` do Esc, que o efeito ouve uma vez só.
  const voltarRef = useRef<() => void>(() => {});
  const voltar = () => {
    // O close() antes: o foco sai do diálogo, e quem mostra a pergunta o põe no botão do menu.
    ref.current?.close();
    onVoltar();
  };
  voltarRef.current = voltar;
  // O Esc com o pedido no ar não fecha a pergunta.
  const ocupadoRef = useRef(ocupado);
  ocupadoRef.current = ocupado;

  useLayoutEffect(() => {
    const dialogo = ref.current!;
    if (!dialogo.open) dialogo.showModal();
    const esc = (e: Event) => {
      e.preventDefault();
      if (!ocupadoRef.current) voltarRef.current();
    };
    dialogo.addEventListener('cancel', esc);
    return () => {
      dialogo.removeEventListener('cancel', esc);
      // O diálogo ainda aberto na saída: o cancelar deu certo e a reunião saiu da tela. O foco está dentro dele ou,
      // com o "Cancelar a reunião" desligado (o foco sai de um botão `disabled`), solto no `body`.
      const foco = document.activeElement;
      if (dialogo.open && (dialogo.contains(foco) || foco === null || foco === document.body)) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.reun-nova')?.focus());
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class="reun-cancelar"
      role="alertdialog"
      aria-labelledby="cancelar-titulo"
      aria-describedby="cancelar-texto"
    >
      <h2 id="cancelar-titulo">{CANCELAR_A_REUNIAO_PERGUNTA}</h2>
      <p class="reun-cancelar-quem">{quemEQuando(reuniao, agora)}</p>
      <p id="cancelar-texto">{textoDoCancelar(reuniao)}</p>
      {falhou && (
        <p class="reun-cancelar-erro" role="alert">
          {SERVIDOR_NAO_RESPONDEU}
        </p>
      )}
      <div class="reun-cancelar-botoes">
        <button type="button" class="reun-cancelar-voltar" autofocus onClick={voltar}>
          {VOLTAR}
        </button>
        <button type="button" class="reun-cancelar-ok" disabled={ocupado} onClick={onCancelar}>
          {CANCELAR_A_REUNIAO}
        </button>
      </div>
    </dialog>
  );
}
