// A janela principal: recebe o estado do C++ pela ponte e desenha a tela que ele pede (Entrar ou a principal, com
// as abas Teclado, Recentes e Contatos, as Configurações, o Sobre e os formulários). Não decide nenhuma regra.
// Com uma ligação (`ligacao`), a tela da ligação toma a janela; quando a última acaba, volta o Teclado. O `ring`
// toca aqui (o aviso do canto, aviso.tsx, recebe as mesmas mensagens e não toca).
import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createBridge } from './bridge';
import { BackBar } from './components/BackBar';
import { Header } from './components/Header';
import { Nav } from './components/Nav';
import { TitleBar } from './components/TitleBar';
import { Toast } from './components/Toast';
import { Configuracoes } from './screens/Configuracoes';
import { ContatoForm } from './screens/ContatoForm';
import { Contatos } from './screens/Contatos';
import { Entrar } from './screens/Entrar';
import { Ligacao } from './screens/Ligacao';
import { Recentes } from './screens/Recentes';
import { Sobre } from './screens/Sobre';
import { Teclado } from './screens/Teclado';
import { createRinger } from './ring';
import type { AppState } from './state';
import { accountTitle } from './format';
import type { Send, Tab, View } from './types';

const bridge = createBridge();
const ringer = createRinger();
const TOAST_MS = 2000;
const TECLA_ABA: Record<string, Tab> = { '1': 'teclado', '2': 'recentes', '3': 'contatos' };

function initialView(): View {
  const v = bridge.initialView;
  if (v === 'configuracoes' || v === 'sobre') return { kind: v };
  return { kind: 'tab', tab: v ?? 'teclado' };
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [toast, setToast] = useState<{ texto: string; vez: number } | null>(null);
  const [reinstalar, setReinstalar] = useState(false);
  const [numero, setNumero] = useState('');
  const tecladoVez = useRef(0);
  // O dispositivo de Toque de agora (o `ring` vem logo depois do estado).
  const toque = useRef('');

  const send = useCallback<Send>((command) => bridge.send(command), []);

  useEffect(() => {
    bridge.onVersionMismatch(() => setReinstalar(true));
    const parar = bridge.subscribe((msg) => {
      if (msg.type === 'state') {
        toque.current = msg.state.audio.toque;
        setState(msg.state);
      } else if (msg.type === 'toast') setToast((t) => ({ texto: msg.texto, vez: (t?.vez ?? 0) + 1 }));
      else if (msg.type === 'ring') ringer.play(msg.tipo, toque.current);
    });
    bridge.send({ cmd: 'ready' });
    return parar;
  }, []);

  useEffect(() => {
    if (state) document.body.dataset.pronto = '1';
  }, [state !== null]);

  // Um link tel:/sip:/callto: põe o número no Teclado (a cada vez que `tecladoVez` muda; nunca liga sozinho).
  useEffect(() => {
    if (!state || state.tecladoVez === tecladoVez.current) return;
    tecladoVez.current = state.tecladoVez;
    setNumero(state.teclado);
    setView({ kind: 'tab', tab: 'teclado' });
  }, [state?.tecladoVez]);

  // O Toque trocado nas Configurações com o toque tocando passa para o dispositivo novo.
  useEffect(() => {
    if (state) ringer.setDevice(state.audio.toque);
  }, [state?.audio.toque]);

  // A última ligação acabou: volta ao Teclado (spec da W1, 7.2).
  const emLigacao = state?.ligacao != null;
  const estavaEmLigacao = useRef(false);
  useEffect(() => {
    if (estavaEmLigacao.current && !emLigacao) setView({ kind: 'tab', tab: 'teclado' });
    estavaEmLigacao.current = emLigacao;
  }, [emLigacao]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // Ctrl+1, 2 e 3 trocam a aba.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const aba = TECLA_ABA[e.key];
      if (!aba || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      setView({ kind: 'tab', tab: aba });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const mudarNumero = useCallback((update: (atual: string) => string) => setNumero(update), []);

  if (!bridge.available) {
    return (
      <div class="win">
        <TitleBar send={send} />
        <p class="fatal" role="alert">
          Não foi possível iniciar a interface. Reinstale o Starsonic Phone.
        </p>
      </div>
    );
  }
  if (reinstalar) {
    return (
      <div class="win">
        <TitleBar send={send} />
        <p class="fatal" role="alert">
          Reinstale o Starsonic Phone.
        </p>
      </div>
    );
  }
  if (!state) {
    return (
      <div class="win">
        <TitleBar send={send} />
      </div>
    );
  }

  const toastEl = <Toast texto={toast?.texto ?? null} vez={toast?.vez ?? 0} />;

  if (state.tela === 'entrar') {
    return (
      <div class="win">
        <TitleBar send={send} closeLabel="Fechar" />
        <Entrar state={state} send={send} mode="entrar" />
        {toastEl}
      </div>
    );
  }

  if (state.ligacao) {
    return (
      <div class="win call">
        <TitleBar send={send} title={state.conta ? `Starsonic Phone · ${accountTitle(state.conta)}` : undefined} />
        <Ligacao state={state} ligacao={state.ligacao} send={send} />
        {toastEl}
      </div>
    );
  }

  const voltarAoTeclado = () => setView({ kind: 'tab', tab: 'teclado' });
  let conteudo;
  switch (view.kind) {
    case 'configuracoes':
      conteudo = (
        <Configuracoes
          state={state}
          send={send}
          onBack={voltarAoTeclado}
          onEditAccount={(contaId) => setView({ kind: 'conta', contaId, back: view })}
          onAddAccount={() => setView({ kind: 'conta', back: view })}
        />
      );
      break;
    case 'sobre':
      conteudo = <Sobre versao={state.versao} send={send} onBack={voltarAoTeclado} />;
      break;
    case 'conta': {
      const conta = view.contaId ? state.contas.find((c) => c.id === view.contaId) : undefined;
      conteudo =
        view.contaId && !conta ? (
          // A conta saiu (removida em outro lugar): nada a editar.
          <BackBar title="Editar conta" onBack={() => setView(view.back)} />
        ) : (
          <Entrar
            key={view.contaId ?? 'nova'}
            state={state}
            send={send}
            mode={conta ? 'editar' : 'adicionar'}
            conta={conta}
            onClose={() => setView(view.back)}
          />
        );
      break;
    }
    case 'contato':
      conteudo = <ContatoForm contato={view.contato} numero={view.numero} nome={view.nome} send={send} onClose={() => setView(view.back)} />;
      break;
    case 'tab':
      break;
  }

  if (conteudo) {
    return (
      <div class="win">
        <TitleBar send={send} />
        {conteudo}
        {toastEl}
      </div>
    );
  }

  const tab = view.kind === 'tab' ? view.tab : 'teclado';
  const conta = state.conta;
  return (
    <div class="win">
      <TitleBar send={send} />
      {conta && <Header state={state} conta={conta} send={send} navigate={setView} current={view} />}
      <main class="main" aria-label={tab === 'teclado' ? 'Teclado' : tab === 'recentes' ? 'Recentes' : 'Contatos'}>
        {tab === 'teclado' && <Teclado numero={numero} setNumero={mudarNumero} contatos={state.contatos} send={send} />}
        {tab === 'recentes' && (
          <Recentes
            recentes={state.recentes}
            perdidas={state.perdidas}
            send={send}
            onSaveContact={(n, nome) => setView({ kind: 'contato', numero: n, nome, back: view })}
          />
        )}
        {tab === 'contatos' && (
          <Contatos
            contatos={state.contatos}
            send={send}
            onNew={() => setView({ kind: 'contato', back: view })}
            onEdit={(contato) => setView({ kind: 'contato', contato, back: view })}
          />
        )}
      </main>
      <Nav tab={tab} onSelect={(t) => setView({ kind: 'tab', tab: t })} />
      {toastEl}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
