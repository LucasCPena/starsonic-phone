// O cabeçalho da marca: o logo negativo, o Menu (Configurações, Sobre, Sair), a conta em uso (a troca de conta)
// e os botões em pílula Não perturbe e Atender automático.
import { useRef, useState } from 'preact/hooks';
import { accountStatusLine, accountTitle } from '../format';
import { IconCheck, IconChevronDown, IconDnd, IconExit, IconIncoming, IconInfo, IconMenu, IconPlus, IconSettings } from '../icons';
import type { AppState, CurrentAccount } from '../state';
import type { Send, View } from '../types';
import { Menu } from './Menu';

interface Props {
  state: AppState;
  conta: CurrentAccount;
  send: Send;
  navigate(view: View): void;
  current: View;
}

export function Header({ state, conta, send, navigate, current }: Props) {
  const [aberto, setAberto] = useState<'menu' | 'contas' | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const contaRef = useRef<HTMLButtonElement>(null);
  const fechar = () => setAberto(null);
  const dotClass = conta.status === 'conectado' ? 'dot' : conta.status === 'erro' ? 'dot dot-err' : 'dot dot-off';

  return (
    <header class="brand">
      <div class="brand-glow" aria-hidden="true" />
      <div class="brand-row">
        <img class="logo" src="assets/starsonic-logo-negativo.png" width={160} height={49} alt="Starsonic soluções de voz e dados" />
        <div style={{ position: 'relative' }}>
          <button
            ref={menuRef}
            type="button"
            class="icon-btn"
            aria-label="Menu"
            title="Menu"
            aria-haspopup="menu"
            aria-expanded={aberto === 'menu'}
            onClick={() => setAberto(aberto === 'menu' ? null : 'menu')}
          >
            <IconMenu />
          </button>
          {aberto === 'menu' && (
            <Menu label="Menu" anchor={menuRef} onClose={fechar} class="popover-menu">
              <button type="button" role="menuitem" class="menuitem" onClick={() => (fechar(), navigate({ kind: 'configuracoes' }))}>
                <IconSettings size="sm" />
                Configurações
              </button>
              <button type="button" role="menuitem" class="menuitem" onClick={() => (fechar(), navigate({ kind: 'sobre' }))}>
                <IconInfo size="sm" />
                Sobre
              </button>
              <div class="menu-sep" role="separator" />
              <button type="button" role="menuitem" class="menuitem" onClick={() => (fechar(), send({ cmd: 'quit' }))}>
                <IconExit size="sm" />
                Sair
              </button>
            </Menu>
          )}
        </div>
      </div>
      <div style={{ position: 'relative', zIndex: 2 }}>
        <button
          ref={contaRef}
          type="button"
          class="account"
          title="Trocar de conta"
          aria-haspopup="menu"
          aria-expanded={aberto === 'contas'}
          onClick={() => setAberto(aberto === 'contas' ? null : 'contas')}
        >
          <span class="sr-only">Trocar de conta: </span>
          <span class={dotClass} aria-hidden="true" />
          <span class="account-text">
            <span class="account-name">{accountTitle(conta)}</span>
            <span class="account-sub">{accountStatusLine(conta)}</span>
          </span>
          <IconChevronDown size="sm" />
        </button>
        {aberto === 'contas' && (
          <Menu label="Contas" anchor={contaRef} onClose={fechar} class="popover-contas">
            {state.contas.map((c) => (
              <button
                type="button"
                key={c.id}
                role="menuitemradio"
                aria-checked={c.emUso}
                class="menuitem"
                onClick={() => (fechar(), send({ cmd: 'selectAccount', contaId: c.id }))}
              >
                <span class="check">{c.emUso ? <IconCheck size="sm" /> : null}</span>
                <span>
                  {accountTitle(c)}
                  <span class="menuitem-sub">{c.servidor}</span>
                </span>
              </button>
            ))}
            <div class="menu-sep" role="separator" />
            <button type="button" role="menuitem" class="menuitem" onClick={() => (fechar(), navigate({ kind: 'conta', back: current }))}>
              <IconPlus size="sm" />
              Adicionar conta
            </button>
          </Menu>
        )}
      </div>
      <div class="toggles">
        <button
          type="button"
          class={state.naoPerturbe ? 'chip chip-on' : 'chip'}
          aria-pressed={state.naoPerturbe}
          onClick={() => send({ cmd: 'setDnd', on: !state.naoPerturbe })}
        >
          <IconDnd />
          Não perturbe
        </button>
        <button
          type="button"
          class={state.atenderAutomatico.on ? 'chip chip-on' : 'chip'}
          aria-pressed={state.atenderAutomatico.on}
          onClick={() => send({ cmd: 'setAutoAnswer', on: !state.atenderAutomatico.on })}
        >
          <IconIncoming />
          Atender automático
        </button>
      </div>
    </header>
  );
}
