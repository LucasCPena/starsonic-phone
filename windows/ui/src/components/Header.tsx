// O cabeçalho da marca: o logo negativo, o Menu (Configurações, Sobre, Sair), a conta em uso (a troca de conta),
// Não perturbe e Atender automático. Três layouts (layout.ts, app.css):
// - Normal: o logo de 160 px, a conta em duas linhas e os botões em pílula com o texto;
// - Compacto: o logo de 118 px, Não perturbe e Atender automático em botões redondos de 32 px (só o ícone) ao lado
//   do Menu, e a conta numa linha (a bolinha, o ramal e o estado com reticências);
// - Mínimo: sem o logo, uma faixa de 44 px com a conta (a bolinha, o ramal e o estado), o Não perturbe e o Menu; o
//   Atender automático fica nas Configurações.
// A bolinha (accountDot, a tabela da rc.3): cinza sem internet, ciano conectando, cinza no erro do cadastro (com o
// triângulo de atenção) e sem conexão, vermelho em ligação e no Não perturbe, verde conectado; o texto do estado fica
// sempre ao lado. (rc.3) O administrador pode esconder o Não perturbe e o Atender automático (`admin`): escondidos,
// eles somem em todos os layouts.
// (iPhone) Uma conta só: a conta aparece sem a troca de conta (sem o menu Contas e sem a seta). O Menu tem
// Configurações, Editar conta (a conta em uso), Sobre e Sair; o Sair pergunta antes ("Sair da conta?") e é o
// removeAccount da conta em uso (o app do iPhone não fecha).
import { useEffect, useRef, useState } from 'preact/hooks';
import { accountDot, accountTitle, statusWord } from '../format';
import { IconCheck, IconChevronDown, IconDnd, IconExit, IconIncoming, IconInfo, IconMenu, IconPencil, IconPlus, IconSettings, IconWarning } from '../icons';
import type { Layout } from '../layout';
import { isIos } from '../plataforma';
import type { AppState, CurrentAccount } from '../state';
import type { Send, View } from '../types';
import { Confirm } from './Confirm';
import { Menu } from './Menu';

interface Props {
  state: AppState;
  conta: CurrentAccount;
  send: Send;
  navigate(view: View): void;
  current: View;
  layout: Layout;
}

export function Header({ state, conta, send, navigate, current, layout }: Props) {
  const [aberto, setAberto] = useState<'menu' | 'contas' | null>(null);
  // (iPhone) A confirmação do Sair.
  const [sair, setSair] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const contaRef = useRef<HTMLButtonElement>(null);
  const fechar = () => setAberto(null);
  const ios = isIos(state);
  const estado = accountDot(conta, state.ligacao !== null, state.naoPerturbe);
  const mostrarDnd = state.admin.naoPerturbe;
  const mostrarAuto = state.admin.atenderAuto;

  // O Cancelar da confirmação devolve o foco ao Menu (o item que a abriu saiu com o menu).
  const perguntando = useRef(false);
  useEffect(() => {
    if (perguntando.current && !sair) menuRef.current?.focus();
    perguntando.current = sair;
  }, [sair]);

  const logo = <img class="logo" src="assets/starsonic-logo-negativo.png" width={160} height={49} alt="Starsonic soluções de voz e dados" />;

  const menu = (
    <div class="menu-wrap">
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
          {ios && (
            <button type="button" role="menuitem" class="menuitem" onClick={() => (fechar(), navigate({ kind: 'conta', contaId: conta.id, back: current }))}>
              <IconPencil size="sm" />
              Editar conta
            </button>
          )}
          <button type="button" role="menuitem" class="menuitem" onClick={() => (fechar(), navigate({ kind: 'sobre' }))}>
            <IconInfo size="sm" />
            Sobre
          </button>
          <div class="menu-sep" role="separator" />
          <button type="button" role="menuitem" class="menuitem" onClick={() => (fechar(), ios ? setSair(true) : send({ cmd: 'quit' }))}>
            <IconExit size="sm" />
            Sair
          </button>
        </Menu>
      )}
    </div>
  );

  const nome = layout === 'normal' ? accountTitle(conta) : conta.ramal;
  const texto = layout === 'minimo' ? statusWord(estado.texto) : estado.texto;
  const contaTexto = (
    <>
      <span class={estado.dot} aria-hidden="true" />
      <span class="account-text">
        <span class="account-name">{nome}</span>
        <span class="account-sub">{texto}</span>
      </span>
      {estado.atencao && <IconWarning />}
    </>
  );
  const contaEl = ios ? (
    <div class="account-wrap">
      <div class="account">{contaTexto}</div>
    </div>
  ) : (
    <div class="account-wrap">
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
        {contaTexto}
        {layout !== 'minimo' && <IconChevronDown size="sm" />}
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
  );

  const dnd = () => send({ cmd: 'setDnd', on: !state.naoPerturbe });
  const auto = () => send({ cmd: 'setAutoAnswer', on: !state.atenderAutomatico.on });
  // Os botões redondos do Compacto e do Mínimo: só o ícone, o nome no aria-label e no title.
  const redondo = (nome: string, ligado: boolean, Icon: typeof IconDnd, onClick: () => void) => (
    <button type="button" class={ligado ? 'toggle toggle-on' : 'toggle'} aria-label={nome} title={nome} aria-pressed={ligado} onClick={onClick}>
      <Icon />
    </button>
  );

  let cabecalho;
  if (layout === 'minimo') {
    cabecalho = (
      <header class="brand brand-strip">
        {contaEl}
        {mostrarDnd && redondo('Não perturbe', state.naoPerturbe, IconDnd, dnd)}
        {menu}
      </header>
    );
  } else if (layout === 'compacto') {
    cabecalho = (
      <header class="brand">
        <div class="brand-glow" aria-hidden="true" />
        <div class="brand-row">
          {logo}
          <div class="brand-actions">
            {mostrarDnd && redondo('Não perturbe', state.naoPerturbe, IconDnd, dnd)}
            {mostrarAuto && redondo('Atender automático', state.atenderAutomatico.on, IconIncoming, auto)}
            {menu}
          </div>
        </div>
        {contaEl}
      </header>
    );
  } else {
    cabecalho = (
      <header class="brand">
        <div class="brand-glow" aria-hidden="true" />
        <div class="brand-row">
          {logo}
          {menu}
        </div>
        {contaEl}
        {(mostrarDnd || mostrarAuto) && (
          <div class="toggles">
            {mostrarDnd && (
              <button type="button" class={state.naoPerturbe ? 'chip chip-on' : 'chip'} aria-pressed={state.naoPerturbe} onClick={dnd}>
                <IconDnd />
                Não perturbe
              </button>
            )}
            {mostrarAuto && (
              <button type="button" class={state.atenderAutomatico.on ? 'chip chip-on' : 'chip'} aria-pressed={state.atenderAutomatico.on} onClick={auto}>
                <IconIncoming />
                Atender automático
              </button>
            )}
          </div>
        )}
      </header>
    );
  }

  // A confirmação fica fora do cabeçalho: dentro dele, o diálogo herdaria o foco ciano das áreas escuras.
  return (
    <>
      {cabecalho}
      {sair && (
        <Confirm
          title="Sair da conta?"
          message="Este iPhone deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha."
          confirmLabel="Sair"
          onCancel={() => setSair(false)}
          onConfirm={() => {
            setSair(false);
            send({ cmd: 'removeAccount', contaId: conta.id });
          }}
        />
      )}
    </>
  );
}
