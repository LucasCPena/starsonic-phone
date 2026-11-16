// (0.4.0) O Desligar da sala pergunta antes (o quadro Encerrar): "Encerrar a sala para todos?", com os nomes de quem está
// nela, que a pergunta acompanha. Um <dialog> modal (o showModal, como o Confirm), com o foco no Cancelar. O Encerrar manda
// o `salaEncerrar` e não fecha a pergunta: ela some quando a sala acaba (a tela da sala sai, e o diálogo com ela). O
// Cancelar e o Esc fecham com o close() antes de avisar, para o foco voltar ao Desligar. No Windows, o Encerrar e o
// Cancelar ignoram o segundo clique de um clique duplo (o NoWindows de quem mostra a pergunta): o segundo clique cairia na
// tela que fica quando a sala acaba. Se a sala acaba sozinha com a pergunta aberta, o foco vai para um controle da tela que
// fica, e não se perde no `body`.
import type { VNode } from 'preact';
import { useContext, useEffect, useRef } from 'preact/hooks';
import { semSegundoClique } from '../plataforma';
import { NoWindows } from '../screens/controlesDaLigacao';
import type { SalaDaLigacao } from '../state';
import type { Send } from '../types';
import { nomesDaSala } from './estado';
import { ENCERRAR, ENCERRAR_A_SALA, ligacoesVaoDesligar } from './textos';

/** O primeiro controle da tela que fica: o do `main` (a ligação ou o Teclado) ou, no grande, o do `.grande` (a sala tem o `role="main"`). */
const CONTROLE_QUE_FICA = ['main', '[role="main"]', '.grande'].map((raiz) => `${raiz} :is(input, button, [tabindex]):not([disabled], [tabindex="-1"])`).join(', ');

interface Props {
  sala: SalaDaLigacao;
  send: Send;
  /** O Cancelar e o Esc: a pergunta fecha, e a sala fica como está. */
  onFechar(): void;
}

export function EncerrarSala({ sala, send, onFechar }: Props): VNode {
  const noWindows = useContext(NoWindows);
  const ref = useRef<HTMLDialogElement>(null);
  // O fechar de agora para o `cancel` do Esc, que o efeito ouve uma vez só.
  const fecharRef = useRef<() => void>(() => {});
  const fechar = () => {
    // O close() antes: o foco volta a quem o tinha (o Desligar), como no Esc de um diálogo comum.
    ref.current?.close();
    onFechar();
  };
  fecharRef.current = fechar;

  useEffect(() => {
    const dialogo = ref.current!;
    if (!dialogo.open) dialogo.showModal();
    const cancelar = (e: Event) => {
      e.preventDefault();
      fecharRef.current();
    };
    dialogo.addEventListener('cancel', cancelar);
    return () => {
      dialogo.removeEventListener('cancel', cancelar);
      // A sala acabou com a pergunta aberta (a tela saiu, e o diálogo com ela): o foco que estava nele iria para o `body`.
      // Ele vai para o primeiro controle da tela que fica (a ligação ou o Teclado).
      if (dialogo.open && dialogo.contains(document.activeElement)) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>(CONTROLE_QUE_FICA)?.focus());
      }
    };
  }, []);

  return (
    <dialog ref={ref} class="encerrar" role="alertdialog" aria-labelledby="encerrar-titulo" aria-describedby="encerrar-texto">
      <h2 id="encerrar-titulo">{ENCERRAR_A_SALA}</h2>
      <p id="encerrar-texto">{ligacoesVaoDesligar(nomesDaSala(sala))}</p>
      <div class="encerrar-botoes">
        <button type="button" class="encerrar-cancelar" autofocus onClick={semSegundoClique(noWindows, fechar)}>
          Cancelar
        </button>
        <button type="button" class="encerrar-ok" onClick={semSegundoClique(noWindows, () => send({ cmd: 'salaEncerrar' }))}>
          {ENCERRAR}
        </button>
      </div>
    </dialog>
  );
}
