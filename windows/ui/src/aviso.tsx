// O aviso de ligação recebida: a janela de 380×168 que o executável mostra no canto da tela, sempre por cima e
// sem tomar o foco, quando uma ligação toca com a janela principal fora da frente (spec da W1, 4.1 e 7.2).
// Usa a mesma ponte da janela principal: recebe o mesmo `state` e manda `answer`/`reject` (o executável traz a
// janela principal para a frente no Atender). Mostra a que toca: a de cima (uma recebida) ou a segunda. Sem
// nenhuma tocando, fica vazio (o executável esconde a janela). O toque é da janela principal: o aviso não toca.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { createBridge } from './bridge';
import { contactNumberLine, initials, nameOrNumber } from './format';
import { IconPhone } from './icons';
import type { AppState, CallCard } from './state';

const bridge = createBridge();

/** A ligação que toca agora (a conferência nunca tem uma segunda tocando). */
function ringingCard(state: AppState): CallCard | null {
  const l = state.ligacao;
  if (!l) return null;
  if (l.top.phase === 'ringing') return l.top;
  if (!l.conference && l.secondKind === 'ringing' && l.second) return l.second;
  return null;
}

function Aviso() {
  const [state, setState] = useState<AppState | null>(null);
  const [reinstalar, setReinstalar] = useState(false);

  useEffect(() => {
    bridge.onVersionMismatch(() => setReinstalar(true));
    const parar = bridge.subscribe((msg) => {
      if (msg.type === 'state') setState(msg.state);
      // O `ring` e o `toast` são da janela principal.
    });
    bridge.send({ cmd: 'ready' });
    return parar;
  }, []);

  useEffect(() => {
    if (state) document.body.dataset.pronto = '1';
  }, [state !== null]);

  if (!bridge.available || reinstalar) {
    return (
      <div class="aviso aviso-erro" role="alert">
        {reinstalar ? 'Reinstale o Starsonic Phone.' : 'Não foi possível iniciar a interface. Reinstale o Starsonic Phone.'}
      </div>
    );
  }
  const card = state ? ringingCard(state) : null;
  if (!state || !card) return <div class="aviso aviso-vazio" />;
  const conta = state.conta ? state.conta.nome || state.conta.ramal : '';
  const nome = nameOrNumber(card);
  return (
    <div class="aviso" role="alertdialog" aria-label={`Ligação recebida de ${nome}`}>
      <div class="aviso-quem">
        <span class="avatar aviso-avatar" aria-hidden="true">
          {card.name ? initials(card.name) : <IconPhone size="sm" />}
        </span>
        <div class="aviso-texto">
          <span class="eyebrow">{conta ? `Ligação recebida · ${conta}` : 'Ligação recebida'}</span>
          <span class="aviso-nome">{nome}</span>
          {card.name && <span class="aviso-sub">{contactNumberLine(card.number)}</span>}
        </div>
      </div>
      <div class="aviso-botoes">
        <button type="button" class="btn aviso-recusar" onClick={() => bridge.send({ cmd: 'reject' })}>
          <IconPhone size="sm" class="ic-hang" />
          Recusar
        </button>
        <button type="button" class="btn btn-cyan" onClick={() => bridge.send({ cmd: 'answer' })}>
          <IconPhone size="sm" />
          Atender
        </button>
      </div>
    </div>
  );
}

render(<Aviso />, document.getElementById('aviso')!);
