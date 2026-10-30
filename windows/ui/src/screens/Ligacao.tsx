// A tela da ligação, sempre na seção escura: uma ligação, a segunda tocando (a faixa "Ligação de …"), duas (o
// cartão "Em espera"), a consulta ("Consultando" e o cliente "Em espera · transferência") e a conferência.
// A interface não decide nenhuma regra: o que aparece e o que fica travado vem só do `ligacao` do estado
// (docs/ponte-windows.md). A conferência é olhada antes do `secondKind` (nela a segunda vem "active").
// Teclado físico: os dígitos, * e # mandam DTMF só com o teclado da ligação aberto; Esc fecha o teclado e o painel
// Atalhos. (rc.3) O botão Atalhos (com uma ligação atendida, fora da consulta e da conferência) abre o painel com os
// atalhos no lugar dos controles. As sugestões do número do Transferir e da Nova ligação vêm de `contatos`: os do estado
// e, no iPhone, os da agenda (um por número; um contato sem nome mostra o número).
// (iPhone) O botão Áudio mostra a saída de agora (a `rotaAudio`: "iPhone", "Viva-voz" ou o nome do fone; "Áudio" sem
// saber), com o nome "Áudio: <saída>", e pede a escolha do iPhone (o `audioRoute`: o hospedeiro mostra a dele), no
// lugar do menu dos dispositivos; sem o botão Atalhos (fora da 1.0), uma ligação fica em três colunas (6 controles) e
// duas em quatro (7). Cada tecla do teclado da ligação manda, junto do dtmf, o `keyTone` com ela, com o Bipe ao digitar
// ligado (o `config.bipeTecla`).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AtalhosPainel } from '../components/AtalhosPainel';
import { Menu } from '../components/Menu';
import { Rediscar } from '../components/Rediscar';
import { callTimer, contactNumberLine, digitsOnly, firstName, initials, nameOrNumber } from '../format';
import { isIos } from '../plataforma';
import {
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconClose,
  IconKeypad,
  IconMerge,
  IconMic,
  IconMicOff,
  IconPause,
  IconPhone,
  IconPlus,
  IconSpeaker,
  IconSpeaking,
  IconSplit,
  IconSwap,
} from '../icons';
import type { AppState, CallCard, CallState, Contact } from '../state';
import type { Send } from '../types';

interface Props {
  state: AppState;
  ligacao: CallState;
  /** As sugestões do número (o Transferir e a Nova ligação): os `contatos` do estado; no iPhone, os da agenda. */
  contatos: Contact[];
  send: Send;
}

type Painel = 'teclado' | 'transferir' | 'nova' | 'atalhos' | null;

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const PADRAO = 'Padrão do Windows';

/** Em andamento e confirmada pelo motor (o Alternar, o Juntar e o Concluir só valem entre ligações assim). */
function confirmada(card: CallCard): boolean {
  return card.phase === 'active' && card.activeSinceMs > 0;
}

/** Os últimos dígitos mandados (os que cabem na linha). */
function ultimos(digitos: string): string {
  return digitos.length > 18 ? `…${digitos.slice(-17)}` : digitos;
}

/** Re-renderiza a cada segundo (o tempo da ligação). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** O estado da ligação de cima: "Chamando…", "Conectando…" (atendida, sem a confirmação) ou o tempo. */
function statusLine(card: CallCard, now: number): string {
  if (card.phase === 'dialing') return 'Chamando…';
  if (card.phase === 'ringing') return '';
  if (card.activeSinceMs <= 0) return 'Conectando…';
  return callTimer(now - card.activeSinceMs);
}

function Avatar({ card, large }: { card: CallCard; large?: boolean }) {
  return (
    <span class={large ? 'avatar avatar-lg' : 'avatar'} aria-hidden="true">
      {card.name ? initials(card.name) : <IconPhone size={large ? 'lg' : 'sm'} />}
    </span>
  );
}

interface CtrlProps {
  /** O rótulo embaixo do círculo (também o nome do botão, sem o `nome`). */
  label: ComponentChildren;
  /** (iPhone) O nome do botão, quando o rótulo não diz tudo (o Áudio: "Áudio: <saída>"). */
  nome?: string;
  icon: ComponentChildren;
  onClick(): void;
  pressed?: boolean;
  disabled?: boolean;
  popup?: boolean;
  expanded?: boolean;
  ctrlRef?: { current: HTMLButtonElement | null };
}

function Ctrl({ label, nome, icon, onClick, pressed, disabled, popup, expanded, ctrlRef }: CtrlProps) {
  const classes = ['ctrl', pressed ? 'ctrl-on' : '', disabled ? 'ctrl-off' : ''].filter(Boolean).join(' ');
  return (
    <button
      ref={ctrlRef}
      type="button"
      class={classes}
      aria-label={nome}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-haspopup={popup ? 'menu' : undefined}
      aria-expanded={popup ? expanded === true : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span class="ctrl-c">{icon}</span>
      {label}
    </button>
  );
}

/** Um botão redondo grande com o rótulo fora (Desligar e Recusar em vermelho, Atender em ciano). */
function RoundAction({ label, kind, onClick }: { label: string; kind: 'hang' | 'answer'; onClick(): void }) {
  return (
    <div class="round-action">
      <button type="button" class={kind === 'hang' ? 'hang' : 'hang answer'} aria-label={label} onClick={onClick}>
        <IconPhone size="lg" />
      </button>
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

/** O menu Áudio: o alto-falante e o microfone da ligação (o `setAudio` pelo nome; "" = o padrão do Windows). */
function AudioMenu({ state, send, anchor, onClose }: { state: AppState; send: Send; anchor: { current: HTMLElement | null }; onClose(): void }) {
  const { audio } = state;
  const grupo = (titulo: string, lista: string[], escolhido: string, mandar: (nome: string) => void) => {
    const nomes = [...lista];
    if (escolhido && !nomes.includes(escolhido)) nomes.push(escolhido);
    const id = `audio-${titulo === 'Microfone' ? 'mic' : 'falante'}`;
    return (
      <div role="group" aria-labelledby={id}>
        <p class="menu-group" id={id}>
          {titulo}
        </p>
        {['', ...nomes].map((nome) => {
          const fora = nome !== '' && audio.desconectados.includes(nome);
          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={nome === escolhido}
              class="menuitem"
              key={nome || 'padrao'}
              onClick={() => (onClose(), mandar(nome))}
            >
              <span class="check-slot">{nome === escolhido && <IconCheck size="sm" class="check" />}</span>
              {nome === '' ? PADRAO : fora ? `${nome} (desconectado)` : nome}
            </button>
          );
        })}
      </div>
    );
  };
  return (
    <Menu label="Áudio" anchor={anchor as { current: HTMLElement }} onClose={onClose} class="popover-audio">
      {grupo('Alto-falante', audio.altoFalantes.map((d) => d.nome), audio.altoFalante, (nome) => send({ cmd: 'setAudio', altoFalante: nome }))}
      <div class="menu-sep" role="separator" />
      {grupo('Microfone', audio.microfones.map((d) => d.nome), audio.microfone, (nome) => send({ cmd: 'setAudio', microfone: nome }))}
    </Menu>
  );
}

interface NumberPanelProps {
  titulo: string;
  rotulo: string;
  contatos: Contact[];
  onCancel(): void;
  /** O toque numa sugestão (null: a sugestão só preenche o número). */
  onContact: ((c: Contact) => void) | null;
  /** Os botões do painel, com o número digitado. */
  actions(numero: string): ComponentChildren;
  /** O Enter no campo (null: nada). */
  onEnter: ((numero: string) => void) | null;
}

/** O número do Transferir e da Nova ligação, com as sugestões dos contatos (como o Teclado). */
function NumberPanel({ titulo, rotulo, contatos, onCancel, onContact, actions, onEnter }: NumberPanelProps) {
  const [numero, setNumero] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);
  const digitos = digitsOnly(numero);
  const sugestoes = digitos.length >= 2 ? contatos.filter((c) => digitsOnly(c.numero).includes(digitos)).slice(0, 2) : [];
  return (
    <div class="call-panel">
      <h2 class="call-panel-title">{titulo}</h2>
      <input
        ref={campo}
        class="call-number"
        type="tel"
        aria-label={rotulo}
        placeholder="Digite o número"
        autocomplete="off"
        spellcheck={false}
        value={numero}
        onInput={(e) => {
          const valor = e.currentTarget.value.replace(/[^0-9*#+]/g, '');
          e.currentTarget.value = valor;
          setNumero(valor);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && onEnter && numero) {
            e.preventDefault();
            onEnter(numero);
          }
        }}
      />
      {/* As sugestões ficam com o espaço que sobra (numa janela pequena, uma lista que rola sozinha). */}
      {sugestoes.length > 0 && (
        <div class="call-suggestions">
          {sugestoes.map((c) => (
            <button type="button" key={c.id} class="suggest call-suggest" onClick={() => (onContact ? onContact(c) : setNumero(c.numero))}>
              <span class="avatar" aria-hidden="true">
                {initials(c.nome)}
              </span>
              <span class="row-main">
                <span class="row-title">{c.nome || c.numero}</span>
                <span class="row-sub">Contato · {c.numero}</span>
              </span>
              <IconArrowRight size="sm" />
            </button>
          ))}
        </div>
      )}
      <div class="call-panel-actions">{actions(numero)}</div>
      <button type="button" class="btn btn-ghost-dark" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

export function Ligacao({ state, ligacao: l, contatos, send }: Props) {
  const now = useNow();
  const [painelPedido, setPainel] = useState<Painel>(null);
  const [digitos, setDigitos] = useState('');
  const [audioAberto, setAudioAberto] = useState(false);
  const audioRef = useRef<HTMLButtonElement>(null);
  // O botão Atalhos recebe o foco de volta quando o painel fecha pelo Fechar atalhos ou pelo Esc.
  const atalhosRef = useRef<HTMLButtonElement>(null);
  const [focarAtalhos, setFocarAtalhos] = useState(false);
  const painelDe = useRef(l.top.id);
  const top = l.top;
  const ios = isIos(state);
  // (iPhone) O bipe de cada tecla, com o Bipe ao digitar ligado.
  const bipe = ios && state.config.bipeTecla === true;

  // Os painéis são da ligação de cima: quando ela troca (a segunda atendida, Alternar, a volta da em espera), eles
  // fecham e os dígitos saem.
  useEffect(() => {
    if (top.id === painelDe.current) return;
    painelDe.current = top.id;
    setPainel(null);
    setDigitos('');
    setAudioAberto(false);
  }, [top.id]);

  const conferencia = l.conference && l.second !== null;
  const tocando = top.phase === 'ringing';
  const segundaTocando = !conferencia && l.secondKind === 'ringing' ? l.second : null;
  const outra = !conferencia && l.secondKind === 'held' ? l.second : null;
  const consulta = l.consulting && outra !== null;
  const falando = confirmada(top);
  const ambas = outra !== null && falando && confirmada(outra);

  // O painel só vale enquanto o estado deixa (a ligação que cai, a segunda que chega). Os atalhos, só com uma ligação
  // atendida (nunca com só uma recebida tocando), fora da consulta e da conferência, e com algum atalho.
  const temAtalhos = state.atalhos.length > 0;
  const painel: Painel =
    painelPedido === 'teclado' && falando && !tocando && !consulta
      ? 'teclado'
      : painelPedido === 'transferir' && falando && !consulta && !conferencia
        ? 'transferir'
        : painelPedido === 'nova' && falando && l.second === null
          ? 'nova'
          : painelPedido === 'atalhos' && falando && !tocando && !consulta && !conferencia && temAtalhos
            ? 'atalhos'
            : null;

  const fecharAtalhos = () => {
    setPainel(null);
    setFocarAtalhos(true);
  };
  const fecharAtalhosRef = useRef(fecharAtalhos);
  fecharAtalhosRef.current = fecharAtalhos;
  useEffect(() => {
    if (!focarAtalhos || painel !== null) return;
    setFocarAtalhos(false);
    atalhosRef.current?.focus();
  }, [focarAtalhos, painel]);

  const dtmf = (tecla: string) => {
    send({ cmd: 'dtmf', digitos: tecla });
    if (bipe) send({ cmd: 'keyTone', tecla });
    setDigitos((d) => d + tecla);
  };
  const dtmfRef = useRef(dtmf);
  dtmfRef.current = dtmf;
  const painelRef = useRef(painel);
  painelRef.current = painel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      const alvo = e.target as HTMLElement;
      if (alvo.closest('input, textarea, select, [role="menu"], dialog')) return;
      if (painelRef.current === 'atalhos' && e.key === 'Escape') {
        e.preventDefault();
        fecharAtalhosRef.current();
        return;
      }
      if (painelRef.current !== 'teclado') return;
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault();
        dtmfRef.current(e.key);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPainel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const desligar = (card: CallCard) => send({ cmd: 'hangup', id: card.id });
  const contaNome = state.conta ? state.conta.nome || state.conta.ramal : '';
  const status = statusLine(top, now);
  const compacto = painel !== null;

  // O que fica no alto: a faixa da segunda que toca, ou o cartão da outra (em espera).
  let alto = null;
  if (segundaTocando) {
    alto = (
      <div class="vcard vcard-on" role="alert">
        <Avatar card={segundaTocando} />
        <span class="row-main">
          <span class="row-title">Ligação de {nameOrNumber(segundaTocando)}</span>
          <span class="row-sub">{segundaTocando.name ? `${contactNumberLine(segundaTocando.number)} · tocando` : 'tocando'}</span>
        </span>
        <button type="button" class="round-sm round-danger" aria-label="Recusar" title="Recusar" onClick={() => send({ cmd: 'reject' })}>
          <IconPhone class="ic-hang" />
        </button>
        <button type="button" class="round-sm round-cyan" aria-label="Atender" title="Atender" onClick={() => send({ cmd: 'answer' })}>
          <IconPhone />
        </button>
      </div>
    );
  } else if (outra) {
    const tempo = outra.activeSinceMs > 0 ? callTimer(now - outra.activeSinceMs) : statusLine(outra, now);
    // Na consulta com o colega em cima, o cartão é o cliente: "Em espera · transferência".
    const selo = consulta && l.colleagueActive ? 'Em espera · transferência' : 'Em espera';
    alto = (
      <div class="vcard">
        <Avatar card={outra} />
        <span class="row-main">
          <span class="row-title">{nameOrNumber(outra)}</span>
          <span class="row-sub">{outra.name ? `${contactNumberLine(outra.number)} · ${tempo}` : tempo}</span>
          {/* O selo longo vai embaixo do nome, para o nome e o tempo caberem inteiros. */}
          {consulta && <span class="tag tag-below">{selo}</span>}
        </span>
        {!consulta && <span class="tag">{selo}</span>}
        {!consulta && (
          <button
            type="button"
            class="round-sm round-danger round-xs"
            aria-label={`Desligar ${nameOrNumber(outra)}`}
            title={`Desligar ${nameOrNumber(outra)}`}
            onClick={() => desligar(outra)}
          >
            <IconPhone size="sm" class="ic-hang" />
          </button>
        )}
      </div>
    );
  }

  // Quem fala: a conferência (os dois), ou a ligação de cima.
  let quem;
  if (conferencia && l.second) {
    const segunda = l.second;
    quem = (
      <>
        <div class="who who-conf">
          <span class="eyebrow">Conferência</span>
          <span class="who-name">
            Você, {firstName(top)} e {firstName(segunda)}
          </span>
          <span class="timer">{callTimer(now - l.conferenceSinceMs)}</span>
          {painel === 'teclado' && digitos && <span class="dtmf">{ultimos(digitos)}</span>}
        </div>
        {!compacto && (
          <ul class="conf-list" aria-label="Participantes">
            {[top, segunda].map((card) => (
              <li class="vcard" key={card.id || card.number}>
                <Avatar card={card} />
                <span class="row-main">
                  <span class="row-title">{nameOrNumber(card)}</span>
                  {card.name && <span class="row-sub">{contactNumberLine(card.number)}</span>}
                </span>
                <IconSpeaking class="conf-ic" />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else {
    const eyebrow = tocando ? `Ligação recebida · ${contaNome}` : consulta && l.colleagueActive ? 'Consultando' : 'Em ligação';
    quem = (
      <div class={compacto ? 'who who-compact' : 'who'}>
        <span class="eyebrow">{eyebrow}</span>
        {!compacto && <Avatar card={top} large />}
        <span class="who-name">{nameOrNumber(top)}</span>
        {top.name && <span class="who-sub">{contactNumberLine(top.number)}</span>}
        {status && <span class="timer">{status}</span>}
        {top.held && !outra && <span class="tag">Em espera</span>}
        {painel === 'teclado' && digitos && <span class="dtmf">{ultimos(digitos)}</span>}
      </div>
    );
  }

  const mudo = (
    <Ctrl
      label="Mudo"
      icon={l.muted ? <IconMicOff /> : <IconMic />}
      pressed={l.muted}
      onClick={() => send({ cmd: 'mute', on: !l.muted })}
    />
  );
  const teclado = (
    <Ctrl
      label="Teclado"
      icon={<IconKeypad />}
      pressed={painel === 'teclado'}
      disabled={!falando}
      onClick={() => setPainel(painel === 'teclado' ? null : 'teclado')}
    />
  );
  // (iPhone) A saída de agora, numa linha só (um nome de fone comprido sai com reticências; o nome do botão o tem inteiro),
  // e o toque pede a escolha do iPhone.
  const rota = state.rotaAudio ?? '';
  const audioCtrl = ios ? (
    <Ctrl
      label={<span class="ctrl-rota">{rota || 'Áudio'}</span>}
      nome={rota ? `Áudio: ${rota}` : undefined}
      icon={<IconSpeaker />}
      onClick={() => send({ cmd: 'audioRoute' })}
    />
  ) : (
    <div class="ctrl-wrap">
      <Ctrl
        label="Áudio"
        icon={<IconSpeaker />}
        popup
        expanded={audioAberto}
        ctrlRef={audioRef}
        onClick={() => setAudioAberto(!audioAberto)}
      />
      {audioAberto && <AudioMenu state={state} send={send} anchor={audioRef} onClose={() => setAudioAberto(false)} />}
    </div>
  );
  const espera = (
    <Ctrl label="Espera" icon={<IconPause />} pressed={top.held} disabled={!falando} onClick={() => send({ cmd: 'hold', on: !top.held })} />
  );
  const transferir = <Ctrl label="Transferir" icon={<IconArrowRight />} disabled={!falando} onClick={() => setPainel('transferir')} />;
  const alternar = <Ctrl label="Alternar" icon={<IconSwap />} disabled={!ambas} onClick={() => send({ cmd: 'swap' })} />;
  // rc.3: o painel com os atalhos (atendida, como o Transferir; sem nenhum atalho, nada a abrir). (iPhone) Sem ele.
  const atalhos = ios ? null : (
    <Ctrl label="Atalhos" icon={<IconBolt />} disabled={!falando || !temAtalhos} ctrlRef={atalhosRef} onClick={() => setPainel('atalhos')} />
  );

  // Os controles: na conferência, Mudo, Teclado e Separar; na consulta, Mudo, Alternar e Cancelar; com duas,
  // Mudo, Teclado, Áudio, Espera, Transferir, Alternar, Juntar e Atalhos; com uma, Mudo, Teclado, Áudio, Espera,
  // Transferir, Nova ligação e Atalhos (as duas em quatro colunas). (iPhone) Sem o Atalhos.
  let controles;
  if (conferencia) {
    controles = (
      <>
        {mudo}
        {teclado}
        <Ctrl label="Separar" icon={<IconSplit />} onClick={() => send({ cmd: 'split' })} />
      </>
    );
  } else if (consulta) {
    controles = (
      <>
        {mudo}
        {alternar}
        <Ctrl label="Cancelar" icon={<IconClose />} onClick={() => send({ cmd: 'cancelConsult' })} />
      </>
    );
  } else if (outra) {
    controles = (
      <>
        {mudo}
        {teclado}
        {audioCtrl}
        {espera}
        {transferir}
        {alternar}
        <Ctrl label="Juntar" icon={<IconMerge />} disabled={!ambas || l.consulting} onClick={() => send({ cmd: 'join' })} />
        {atalhos}
      </>
    );
  } else {
    controles = (
      <>
        {mudo}
        {teclado}
        {audioCtrl}
        {espera}
        {transferir}
        <Ctrl label="Nova ligação" icon={<IconPlus />} disabled={!falando || l.second !== null} onClick={() => setPainel('nova')} />
        {atalhos}
      </>
    );
  }

  let meio;
  if (tocando) {
    meio = null;
  } else if (painel === 'teclado') {
    meio = (
      <div class="call-keys" role="group" aria-label="Teclado da ligação">
        {TECLAS.map((tecla) => (
          <button type="button" class="key" key={tecla} onClick={() => dtmf(tecla)}>
            <b>{tecla}</b>
          </button>
        ))}
      </div>
    );
  } else if (painel === 'transferir') {
    meio = (
      <NumberPanel
        titulo="Transferir para"
        rotulo="Número para transferir"
        contatos={contatos}
        onCancel={() => setPainel(null)}
        onContact={null}
        onEnter={null}
        actions={(numero) => (
          <>
            {/* O Consultar é a segunda ligação: com duas, não. */}
            <button
              type="button"
              class="btn btn-outline-dark"
              disabled={!numero || l.second !== null}
              onClick={() => (setPainel(null), send({ cmd: 'consult', numero }))}
            >
              Consultar
            </button>
            <button type="button" class="btn btn-cyan" disabled={!numero} onClick={() => (setPainel(null), send({ cmd: 'transfer', numero }))}>
              Transferir agora
            </button>
          </>
        )}
      />
    );
  } else if (painel === 'nova') {
    const ligar = (numero: string) => (setPainel(null), send({ cmd: 'dial', numero }));
    meio = (
      <NumberPanel
        titulo="Nova ligação"
        rotulo="Número da nova ligação"
        contatos={contatos}
        onCancel={() => setPainel(null)}
        onContact={(c) => (setPainel(null), send({ cmd: 'dial', numero: c.numero, contato: true }))}
        onEnter={ligar}
        actions={(numero) => (
          // O Rediscar da Nova ligação: a feita mais nova, pelo mesmo caminho do Ligar do painel.
          <div class="call-row">
            <Rediscar recentes={state.recentes} id="rediscar-nova" onDial={ligar} />
            <button type="button" class="btn btn-cyan btn-block" disabled={!numero} onClick={() => ligar(numero)}>
              <IconPhone size="sm" />
              Ligar
            </button>
          </div>
        )}
      />
    );
  } else if (painel === 'atalhos') {
    meio = <AtalhosPainel atalhos={state.atalhos} ligacao={l} send={send} onClose={fecharAtalhos} onUsed={fecharAtalhos} />;
  } else {
    // Com uma ligação (7 controles) ou duas (8), quatro colunas; na consulta e na conferência, três. (iPhone) Sem o
    // Atalhos, uma ligação (6) fica em três colunas, e duas (7) em quatro.
    const muitos = !conferencia && !consulta && (!ios || outra !== null);
    meio = <div class={muitos ? 'ctrls ctrls-4' : 'ctrls'}>{controles}</div>;
  }

  let baixo;
  if (tocando) {
    baixo = (
      <div class="call-actions">
        <RoundAction label="Recusar" kind="hang" onClick={() => send({ cmd: 'reject' })} />
        <RoundAction label="Atender" kind="answer" onClick={() => send({ cmd: 'answer' })} />
      </div>
    );
  } else if (consulta && outra) {
    const cliente = l.colleagueActive ? outra : top;
    const colega = l.colleagueActive ? top : outra;
    baixo = (
      <div class="consult-actions">
        <button type="button" class="btn btn-cyan btn-block btn-complete" disabled={!ambas} onClick={() => send({ cmd: 'completeTransfer' })}>
          <IconCheck />
          Concluir transferência
        </button>
        <p class="consult-note">
          {nameOrNumber(cliente)} passa a falar com {nameOrNumber(colega)}, e as duas ligações saem daqui.
        </p>
      </div>
    );
  } else {
    baixo = (
      <div class={painel === 'teclado' ? 'call-actions call-actions-keys' : 'call-actions'}>
        {painel === 'teclado' && <div class="call-side">{teclado}</div>}
        <RoundAction label={conferencia ? 'Desligar para todos' : 'Desligar'} kind="hang" onClick={() => desligar(top)} />
        {painel === 'teclado' && <div class="call-side" />}
      </div>
    );
  }

  // O painel de número (Transferir, Nova ligação) com um cartão em cima: na janela baixa, o bloco de quem fala sai
  // (app.css), para o painel caber entre o cartão e o Desligar.
  const painelComCartao = alto !== null && (painel === 'transferir' || painel === 'nova' || painel === 'atalhos');
  return (
    <main class={painelComCartao ? 'call-body call-painel-cartao' : 'call-body'} aria-label={conferencia ? 'Conferência' : 'Ligação'}>
      {alto}
      {quem}
      <div class="call-middle">{meio}</div>
      {baixo}
    </main>
  );
}
