// A pergunta da atualização (o {"type":"update"} do C++, docs/ponte-windows.md): um <dialog> modal com a versão e as
// notas do versao.json. "Atualizar agora" manda updateNow; "Depois" (e o Esc) manda updateLater. O C++ confere a
// ligação antes de baixar ("Termine a chamada para atualizar." vem como toast); a interface só não cobre a tela da
// ligação com a pergunta (main.tsx).
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  versao: string;
  notas: string;
  onAnswer(agora: boolean): void;
}

export function Atualizacao({ versao, notas, onAnswer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialogo = ref.current!;
    if (!dialogo.open) dialogo.showModal();
    const cancelar = (e: Event) => {
      e.preventDefault();
      onAnswer(false);
    };
    dialogo.addEventListener('cancel', cancelar);
    return () => dialogo.removeEventListener('cancel', cancelar);
  }, [onAnswer]);
  return (
    <dialog ref={ref} class="dialog" aria-labelledby="update-title" aria-describedby="update-text">
      <h2 id="update-title">Atualização</h2>
      <p id="update-text">Nova versão do Starsonic Phone disponível ({versao}). Atualizar agora?</p>
      {notas && <p class="dialog-notes">{notas}</p>}
      <div class="dialog-actions">
        <button type="button" class="btn btn-outline mini" onClick={() => onAnswer(false)}>
          Depois
        </button>
        <button type="button" class="btn btn-cyan mini" autofocus onClick={() => onAnswer(true)}>
          Atualizar agora
        </button>
      </div>
    </dialog>
  );
}
