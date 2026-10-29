// A janela principal: recebe o estado do C++ pela ponte e desenha a tela que ele pede (Entrar ou a principal, com
// as abas Teclado, Atalhos, Recentes e Contatos, as Configurações, o Sobre, os formulários e a área do administrador).
// Não decide nenhuma regra. Com uma ligação (`ligacao`), a tela da ligação toma a janela; quando a última acaba, volta
// o Teclado. O `ring` toca aqui, também o bipe do fim da ligação (o aviso do canto, aviso.tsx, recebe as mesmas
// mensagens e não toca). O Ctrl + P (rc.3) é só desta janela: abre o diálogo da área do administrador, um por vez e
// nunca por cima da ligação, de outro diálogo ou de um menu aberto; com a área aberta, vai direto para ela. O app não
// imprime: o Ctrl + P nunca chega ao imprimir do navegador. (rc.4) A lista da empresa (a contatosEmpresa) fica guardada
// aqui, a de `vez` mais alta, também a que chega antes do primeiro estado, e vai à tela Contatos.
import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createBridge } from './bridge';
import { AdminLogin } from './components/AdminLogin';
import { Atualizacao } from './components/Atualizacao';
import { BackBar } from './components/BackBar';
import { Header } from './components/Header';
import { Nav, TABS } from './components/Nav';
import { TitleBar } from './components/TitleBar';
import { Toast } from './components/Toast';
import { Admin } from './screens/Admin';
import { AtalhoForm } from './screens/AtalhoForm';
import { Atalhos, FOCO_TITULO } from './screens/Atalhos';
import { Configuracoes } from './screens/Configuracoes';
import { ContatoForm } from './screens/ContatoForm';
import { Contatos } from './screens/Contatos';
import { Entrar } from './screens/Entrar';
import { Ligacao } from './screens/Ligacao';
import { Recentes } from './screens/Recentes';
import { Sobre } from './screens/Sobre';
import { Teclado } from './screens/Teclado';
import { createRinger } from './ring';
import type { AppState, CompanyContact } from './state';
import { accountDot, accountTitle } from './format';
import { useLayout } from './layout';
import type { Send, Tab, View } from './types';

const bridge = createBridge();
const ringer = createRinger();
const TOAST_MS = 2000;
/** Ctrl+1 a 4: as abas na ordem da navegação. */
const TECLA_ABA: Record<string, Tab> = Object.fromEntries(TABS.map((t, i) => [String(i + 1), t.tab]));

/**
 * (rc.4) A mesma lista da empresa (cada leitura boa vem com outra `vez`, também a de uma planilha que não mudou): a de
 * antes fica, e a tela Contatos não refaz uma lista que pode ter 10.000 contatos.
 */
function mesmaLista(a: CompanyContact[], b: CompanyContact[]): boolean {
  return a.length === b.length && a.every((c, i) => c.nome === b[i].nome && c.numero === b[i].numero && c.observacao === b[i].observacao);
}

function initialView(): View {
  const v = bridge.initialView;
  if (v === 'configuracoes' || v === 'sobre') return { kind: v };
  return { kind: 'tab', tab: v ?? 'teclado' };
}

/** A área do administrador por cima da tela de agora (Voltar volta para ela). */
function comAdmin(v: View): View {
  return v.kind === 'admin' ? v : { kind: 'admin', back: v };
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [toast, setToast] = useState<{ texto: string; vez: number } | null>(null);
  // O último toast e quantos chegaram (nunca volta a zero): a edição do atalho sabe que o C++ recusou (o motivo vem num
  // toast, com o texto da loja) e distingue essa resposta de um aviso de outra coisa.
  const [toasts, setToasts] = useState({ n: 0, texto: '' });
  const [reinstalar, setReinstalar] = useState(false);
  // A pergunta da atualização aberta (o `update` do C++), até a resposta.
  const [atualizacao, setAtualizacao] = useState<{ versao: string; notas: string; vez: number } | null>(null);
  // (rc.4) A lista da empresa da última contatosEmpresa (a de `vez` mais alta: uma mais velha que chega atrasada não vale).
  const [daEmpresa, setDaEmpresa] = useState<{ vez: number; contatos: CompanyContact[] }>({ vez: 0, contatos: [] });
  // O diálogo da área do administrador (o Ctrl + P).
  const [adminLogin, setAdminLogin] = useState(false);
  const [numero, setNumero] = useState('');
  const tecladoVez = useRef(0);
  // As saídas de som de agora (o `ring` vem logo depois do estado): o Toque e o alto-falante da ligação.
  const saidas = useRef({ toque: '', altoFalante: '' });
  // O estado de agora para os atalhos de teclado (registrados uma vez).
  const atual = useRef<AppState | null>(null);
  atual.current = state;

  const send = useCallback<Send>((command) => bridge.send(command), []);
  const layout = useLayout();

  useEffect(() => {
    bridge.onVersionMismatch(() => setReinstalar(true));
    const parar = bridge.subscribe((msg) => {
      if (msg.type === 'state') {
        saidas.current = { toque: msg.state.audio.toque, altoFalante: msg.state.audio.altoFalante };
        setState(msg.state);
      } else if (msg.type === 'toast') {
        setToast((t) => ({ texto: msg.texto, vez: (t?.vez ?? 0) + 1 }));
        setToasts((t) => ({ n: t.n + 1, texto: msg.texto }));
      } else if (msg.type === 'ring') ringer.play(msg.tipo, saidas.current);
      else if (msg.type === 'update') setAtualizacao((a) => ({ versao: msg.versao, notas: msg.notas, vez: (a?.vez ?? 0) + 1 }));
      else if (msg.type === 'contatosEmpresa') {
        setDaEmpresa((atual) =>
          msg.vez > atual.vez ? { vez: msg.vez, contatos: mesmaLista(atual.contatos, msg.contatos) ? atual.contatos : msg.contatos } : atual,
        );
      }
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

  // O Toque ou o alto-falante trocado com o toque tocando: o toque passa para a saída nova.
  useEffect(() => {
    if (state) ringer.setOutputs({ toque: state.audio.toque, altoFalante: state.audio.altoFalante });
  }, [state?.audio.toque, state?.audio.altoFalante]);

  // A última ligação acabou: volta ao Teclado (spec da W1, 7.2). Uma ligação que chega fecha o diálogo do
  // administrador (ele não volta sozinho depois dela).
  const emLigacao = state?.ligacao != null;
  const estavaEmLigacao = useRef(false);
  useEffect(() => {
    if (estavaEmLigacao.current && !emLigacao) setView({ kind: 'tab', tab: 'teclado' });
    if (emLigacao) setAdminLogin(false);
    estavaEmLigacao.current = emLigacao;
  }, [emLigacao]);

  // O foco de volta (`foco` da aba) vale uma vez: a aba que o recebeu já o aplicou, no efeito da montagem dela, e uma
  // tela guardada em `back` por outro lugar (o Menu, o Ctrl + P) não o repete.
  useEffect(() => {
    if (view.kind === 'tab' && view.foco !== undefined) setView({ kind: 'tab', tab: view.tab });
  }, [view]);

  // A área do administrador fechou no C++ (Sair, 10 min sem uso, a janela fechou): a tela dela sai.
  const adminAberto = state?.admin.aberto === true;
  useEffect(() => {
    if (state && !adminAberto && view.kind === 'admin') setView(view.back);
  }, [adminAberto, view.kind, state !== null]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // Ctrl+1 a 4 trocam a aba; Ctrl + P abre a área do administrador.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.code === 'KeyP' || (e.key ?? '').toLowerCase() === 'p') {
        e.preventDefault();
        const s = atual.current;
        // Nada por cima da ligação, de outro diálogo ou de um menu aberto (o Menu, as contas, o ⋯ de um atalho).
        if (!s || s.ligacao || document.querySelector('dialog[open], [role="menu"]')) return;
        if (s.admin.aberto) setView(comAdmin);
        else setAdminLogin(true);
        return;
      }
      const aba = TECLA_ABA[e.key];
      if (!aba || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      setView({ kind: 'tab', tab: aba });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const mudarNumero = useCallback((update: (atual: string) => string) => setNumero(update), []);
  const responderAtualizacao = useCallback((agora: boolean) => {
    setAtualizacao(null);
    bridge.send({ cmd: agora ? 'updateNow' : 'updateLater' });
  }, []);
  const fecharAdminLogin = useCallback(() => setAdminLogin(false), []);
  const adminAbriu = useCallback(() => {
    setAdminLogin(false);
    setView(comAdmin);
  }, []);

  if (!bridge.available) {
    return (
      <div class="win" data-layout={layout}>
        <TitleBar send={send} />
        <p class="fatal" role="alert">
          Não foi possível iniciar a interface. Reinstale o Starsonic Phone.
        </p>
      </div>
    );
  }
  if (reinstalar) {
    return (
      <div class="win" data-layout={layout}>
        <TitleBar send={send} />
        <p class="fatal" role="alert">
          Reinstale o Starsonic Phone.
        </p>
      </div>
    );
  }
  if (!state) {
    return (
      <div class="win" data-layout={layout}>
        <TitleBar send={send} />
      </div>
    );
  }

  const toastEl = <Toast texto={toast?.texto ?? null} vez={toast?.vez ?? 0} />;
  // A pergunta da atualização e o diálogo do administrador nunca cobrem a tela da ligação.
  const avisos = (
    <>
      {toastEl}
      {atualizacao && !state.ligacao && (
        <Atualizacao key={atualizacao.vez} versao={atualizacao.versao} notas={atualizacao.notas} onAnswer={responderAtualizacao} />
      )}
      {adminLogin && !state.ligacao && <AdminLogin entrarAdmin={state.entrarAdmin} send={send} onCancel={fecharAdminLogin} onOpened={adminAbriu} />}
    </>
  );

  // A ligação vem antes de tudo, também da tela Entrar (a troca para uma conta sem a senha deixa a conta em uso
  // registrada, e uma ligação dela precisa do Atender e do Desligar); a Entrar volta quando ela acaba.
  if (state.ligacao) {
    return (
      <div class="win call" data-layout={layout}>
        {/* No Compacto e no Mínimo, sem o "Starsonic Phone · ", para a conta caber ao lado do estado (no Mínimo, só o
            ramal). */}
        <TitleBar
          send={send}
          title={
            !state.conta
              ? undefined
              : layout === 'normal'
                ? `Starsonic Phone · ${accountTitle(state.conta)}`
                : layout === 'compacto'
                  ? accountTitle(state.conta)
                  : state.conta.ramal
          }
          status={state.conta ? accountDot(state.conta, true, state.naoPerturbe) : undefined}
        />
        <Ligacao state={state} ligacao={state.ligacao} send={send} />
        {toastEl}
      </div>
    );
  }

  // A área do administrador (aberta no C++), também por cima da tela Entrar (os servidores antes da primeira conta).
  if (view.kind === 'admin' && state.admin.aberto) {
    return (
      <div class="win" data-layout={layout}>
        <TitleBar send={send} title="Starsonic Phone · Administrador" />
        <Admin admin={state.admin} send={send} onBack={() => setView(view.back)} onLeave={() => setView({ kind: 'tab', tab: 'teclado' })} />
        {avisos}
      </div>
    );
  }

  if (state.tela === 'entrar') {
    return (
      <div class="win" data-layout={layout}>
        <TitleBar send={send} closeLabel="Fechar" />
        <Entrar state={state} send={send} mode="entrar" />
        {avisos}
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
    case 'atalho':
      conteudo = (
        <AtalhoForm
          key={view.atalho?.id ?? 'novo'}
          atalho={view.atalho}
          posicao={view.posicao}
          atalhos={state.atalhos}
          toasts={toasts}
          blfDoAdmin={state.admin.blf}
          send={send}
          onClose={() => setView(view.back)}
          onRemoved={() => setView({ kind: 'tab', tab: 'atalhos', foco: FOCO_TITULO })}
        />
      );
      break;
    case 'tab':
    case 'admin':
      break;
  }

  if (conteudo) {
    return (
      <div class="win" data-layout={layout}>
        <TitleBar send={send} />
        {conteudo}
        {avisos}
      </div>
    );
  }

  const tab = view.kind === 'tab' ? view.tab : 'teclado';
  const conta = state.conta;
  return (
    <div class="win" data-layout={layout}>
      <TitleBar send={send} />
      {conta && <Header state={state} conta={conta} send={send} navigate={setView} current={view} layout={layout} />}
      <main class="main" aria-label={TABS.find((t) => t.tab === tab)!.label}>
        {tab === 'teclado' && <Teclado numero={numero} setNumero={mudarNumero} contatos={state.contatos} recentes={state.recentes} send={send} />}
        {tab === 'atalhos' && (
          <Atalhos
            atalhos={state.atalhos}
            ligacao={state.ligacao}
            send={send}
            puxa={state.admin.puxa === true}
            foco={view.kind === 'tab' ? view.foco : undefined}
            onNew={(posicao, foco) => setView({ kind: 'atalho', posicao, back: { kind: 'tab', tab: 'atalhos', foco } })}
            onEdit={(atalho, posicao, foco) => setView({ kind: 'atalho', atalho, posicao, back: { kind: 'tab', tab: 'atalhos', foco } })}
          />
        )}
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
            daEmpresa={daEmpresa.contatos}
            comPlanilha={state.empresa.link !== ''}
            send={send}
            onNew={() => setView({ kind: 'contato', back: view })}
            onEdit={(contato) => setView({ kind: 'contato', contato, back: view })}
          />
        )}
      </main>
      <Nav tab={tab} onSelect={(t) => setView({ kind: 'tab', tab: t })} />
      {avisos}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
