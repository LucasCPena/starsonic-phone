// A janela principal: recebe o estado do C++ pela ponte e desenha a tela que ele pede (Entrar ou a principal, com
// as abas Teclado, Atalhos, Recentes e Contatos, as Configurações, o Sobre, os formulários e a área do administrador).
// Não decide nenhuma regra. Com uma ligação (`ligacao`), a tela da ligação toma a janela; quando a última acaba, volta
// o Teclado. O `ring` toca aqui, também o bipe do fim da ligação (o aviso do canto, aviso.tsx, recebe as mesmas
// mensagens e não toca). O Ctrl + P (rc.3) é só desta janela: abre o diálogo da área do administrador, um por vez e
// nunca por cima da ligação, de outro diálogo ou de um menu aberto; com a área aberta, vai direto para ela. O app não
// imprime: o Ctrl + P nunca chega ao imprimir do navegador. (rc.4) A lista da empresa (a contatosEmpresa) fica guardada
// aqui, a de `vez` mais alta, também a que chega antes do primeiro estado, e vai à tela Contatos.
// (iPhone) O estado com `plataforma: "ios"` liga o modo iPhone (plataforma.ts): o .win leva o data-plataforma="ios" (a
// área segura e o toque do app.css), o viewport vai até as bordas da tela, e saem a barra de título (com as zonas de
// redimensionar), os atalhos de teclado (Ctrl+1 a 4 e Ctrl + P), a pergunta da atualização, a área do administrador, o
// toque (o `ring` e o `update` são ignorados) e a aba Atalhos. A mensagem `abrir` (o toque no aviso da perdida) leva aos
// Recentes, como a última ligação que acaba volta ao Teclado. A agenda do iPhone (a mensagem `agenda`) fica guardada
// aqui, como a lista da empresa (a de `vez` mais alta): vai à aba Contatos do iPhone (Agenda.tsx) e às sugestões do
// Teclado, do Transferir e da Nova ligação, no lugar dos `contatos`.
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createBridge } from './bridge';
import { AdminLogin } from './components/AdminLogin';
import { Atualizacao } from './components/Atualizacao';
import { BackBar } from './components/BackBar';
import { Header } from './components/Header';
import { Nav, TABS } from './components/Nav';
import { TitleBar } from './components/TitleBar';
import { Toast } from './components/Toast';
import { Admin } from './screens/Admin';
import { Agenda } from './screens/Agenda';
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
import type { AgendaContact, AgendaSummary, AppState, CompanyContact } from './state';
import { accountDot, accountTitle, agendaSuggestions } from './format';
import { useLayout } from './layout';
import { applyIphoneViewport, IPHONE_TABS, isIos } from './plataforma';
import type { Send, Tab, View } from './types';

const bridge = createBridge();
const ringer = createRinger();
const TOAST_MS = 2000;
/** As abas do Windows, na ordem da navegação. */
const ABAS_DO_WINDOWS = TABS.map((t) => t.tab);
/** Ctrl+1 a 4: as abas na ordem da navegação. */
const TECLA_ABA: Record<string, Tab> = Object.fromEntries(TABS.map((t, i) => [String(i + 1), t.tab]));

/**
 * (rc.4) A mesma lista da empresa (cada leitura boa vem com outra `vez`, também a de uma planilha que não mudou): a de
 * antes fica, e a tela Contatos não refaz uma lista que pode ter 10.000 contatos.
 */
function mesmaLista(a: CompanyContact[], b: CompanyContact[]): boolean {
  return a.length === b.length && a.every((c, i) => c.nome === b[i].nome && c.numero === b[i].numero && c.observacao === b[i].observacao);
}

/**
 * (iPhone) A mesma agenda (a aba Contatos que abre lê a agenda de novo, e a lista vem com outra `vez`): a de antes fica, e
 * nem a aba nem as sugestões refazem uma lista que pode ter milhares de contatos.
 */
function mesmaAgenda(a: AgendaContact[], b: AgendaContact[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.nome === b[i].nome && c.numeros.length === b[i].numeros.length && c.numeros.every((n, j) => n === b[i].numeros[j]))
  );
}

/** (iPhone) Um estado do iPhone sem o `agenda` (fora do contrato): a aba fica como sem a permissão. */
const SEM_AGENDA: AgendaSummary = { permissao: 'pendente', vez: 0, quantos: 0 };

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
  // (iPhone) A agenda da última mensagem `agenda` (a de `vez` mais alta, como a da empresa) e as sugestões dela.
  const [daAgenda, setDaAgenda] = useState<{ vez: number; contatos: AgendaContact[] }>({ vez: 0, contatos: [] });
  const sugestoesDaAgenda = useMemo(() => agendaSuggestions(daAgenda.contatos), [daAgenda.contatos]);
  // O diálogo da área do administrador (o Ctrl + P).
  const [adminLogin, setAdminLogin] = useState(false);
  const [numero, setNumero] = useState('');
  const tecladoVez = useRef(0);
  // As saídas de som de agora (o `ring` vem logo depois do estado): o Toque e o alto-falante da ligação.
  const saidas = useRef({ toque: '', altoFalante: '' });
  // O estado de agora para os atalhos de teclado (registrados uma vez).
  const atual = useRef<AppState | null>(null);
  atual.current = state;
  // (iPhone) O modo do último estado que chegou, para as mensagens que vêm logo depois dele (o toque, a atualização, o
  // `abrir` que o `ready` traz depois do estado) e para as teclas.
  const noIphone = useRef(false);

  const send = useCallback<Send>((command) => bridge.send(command), []);
  const layout = useLayout();
  const ios = isIos(state);

  useEffect(() => {
    bridge.onVersionMismatch(() => setReinstalar(true));
    const parar = bridge.subscribe((msg) => {
      if (msg.type === 'state') {
        const iphone = isIos(msg.state);
        // (iPhone) No primeiro estado do modo iPhone, antes de a primeira tela dele ser desenhada, a página vai até as
        // bordas da tela e fica sem o zoom.
        if (iphone && !noIphone.current) applyIphoneViewport();
        noIphone.current = iphone;
        saidas.current = { toque: msg.state.audio.toque, altoFalante: msg.state.audio.altoFalante };
        setState(msg.state);
      } else if (msg.type === 'toast') {
        setToast((t) => ({ texto: msg.texto, vez: (t?.vez ?? 0) + 1 }));
        setToasts((t) => ({ n: t.n + 1, texto: msg.texto }));
      } else if (msg.type === 'ring') {
        // (iPhone) Quem toca é a tela de chamada do iPhone, e o bipe do fim é do hospedeiro.
        if (!noIphone.current) ringer.play(msg.tipo, saidas.current);
      } else if (msg.type === 'update') {
        // (iPhone) A atualização é a da App Store.
        if (!noIphone.current) setAtualizacao((a) => ({ versao: msg.versao, notas: msg.notas, vez: (a?.vez ?? 0) + 1 }));
      } else if (msg.type === 'contatosEmpresa') {
        setDaEmpresa((atual) =>
          msg.vez > atual.vez ? { vez: msg.vez, contatos: mesmaLista(atual.contatos, msg.contatos) ? atual.contatos : msg.contatos } : atual,
        );
      } else if (msg.type === 'agenda') {
        // (iPhone) Uma lista mais velha que chega atrasada não vale.
        setDaAgenda((atual) =>
          msg.vez > atual.vez ? { vez: msg.vez, contatos: mesmaAgenda(atual.contatos, msg.contatos) ? atual.contatos : msg.contatos } : atual,
        );
      } else if (msg.type === 'abrir') {
        // (iPhone) O toque no aviso da perdida.
        if (noIphone.current && msg.tela === 'recentes') setView({ kind: 'tab', tab: 'recentes' });
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

  // Ctrl+1 a 4 trocam a aba; Ctrl + P abre a área do administrador. (iPhone) Nenhum dos dois.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (noIphone.current || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
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

  // A barra de título do Windows (com as zonas de redimensionar); no iPhone, nenhuma (a de cima é a do próprio iPhone).
  // Antes do primeiro estado a plataforma não se sabe: a janela é a do Windows.
  const plataforma = ios ? 'ios' : undefined;
  const barra = (props: Omit<Parameters<typeof TitleBar>[0], 'send'> = {}) => (ios ? null : <TitleBar send={send} {...props} />);

  if (!bridge.available) {
    return (
      <div class="win" data-layout={layout} data-plataforma={plataforma}>
        {barra()}
        <p class="fatal" role="alert">
          Não foi possível iniciar a interface. Reinstale o Starsonic Phone.
        </p>
      </div>
    );
  }
  if (reinstalar) {
    return (
      <div class="win" data-layout={layout} data-plataforma={plataforma}>
        {barra()}
        <p class="fatal" role="alert">
          Reinstale o Starsonic Phone.
        </p>
      </div>
    );
  }
  if (!state) {
    return (
      <div class="win" data-layout={layout} data-plataforma={plataforma}>
        {barra()}
      </div>
    );
  }

  // As sugestões do número (o Teclado, o Transferir e a Nova ligação): no iPhone, as da agenda, no lugar dos `contatos`.
  const sugestoes = ios ? sugestoesDaAgenda : state.contatos;
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
      <div class="win call" data-layout={layout} data-plataforma={plataforma}>
        {/* No Compacto e no Mínimo, sem o "Starsonic Phone · ", para a conta caber ao lado do estado (no Mínimo, só o
            ramal). */}
        {barra({
          title: !state.conta
            ? undefined
            : layout === 'normal'
              ? `Starsonic Phone · ${accountTitle(state.conta)}`
              : layout === 'compacto'
                ? accountTitle(state.conta)
                : state.conta.ramal,
          status: state.conta ? accountDot(state.conta, true, state.naoPerturbe) : undefined,
        })}
        <Ligacao state={state} ligacao={state.ligacao} contatos={sugestoes} send={send} />
        {toastEl}
      </div>
    );
  }

  // A área do administrador (aberta no C++), também por cima da tela Entrar (os servidores antes da primeira conta).
  if (view.kind === 'admin' && state.admin.aberto) {
    return (
      <div class="win" data-layout={layout} data-plataforma={plataforma}>
        {barra({ title: 'Starsonic Phone · Administrador' })}
        <Admin admin={state.admin} send={send} onBack={() => setView(view.back)} onLeave={() => setView({ kind: 'tab', tab: 'teclado' })} />
        {avisos}
      </div>
    );
  }

  if (state.tela === 'entrar') {
    return (
      <div class="win" data-layout={layout} data-plataforma={plataforma}>
        {barra({ closeLabel: 'Fechar' })}
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
      <div class="win" data-layout={layout} data-plataforma={plataforma}>
        {barra()}
        {conteudo}
        {avisos}
      </div>
    );
  }

  // (iPhone) Sem a aba Atalhos: uma tela de antes que fosse ela (o cenário da ponte falsa) é o Teclado.
  const abas = ios ? IPHONE_TABS : ABAS_DO_WINDOWS;
  const tab = view.kind === 'tab' && abas.includes(view.tab) ? view.tab : 'teclado';
  const conta = state.conta;
  return (
    <div class="win" data-layout={layout} data-plataforma={plataforma}>
      {barra()}
      {conta && <Header state={state} conta={conta} send={send} navigate={setView} current={view} layout={layout} />}
      <main class="main" aria-label={TABS.find((t) => t.tab === tab)!.label}>
        {tab === 'teclado' && <Teclado numero={numero} setNumero={mudarNumero} contatos={sugestoes} recentes={state.recentes} send={send} />}
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
        {/* (iPhone) Tocar numa linha liga de volta (spec 4.1), e sem o "Salvar contato": os contatos são os da agenda. */}
        {tab === 'recentes' && (
          <Recentes
            recentes={state.recentes}
            perdidas={state.perdidas}
            send={send}
            ligarAoTocar={ios}
            onSaveContact={ios ? undefined : (n, nome) => setView({ kind: 'contato', numero: n, nome, back: view })}
          />
        )}
        {/* (iPhone) A agenda do iPhone, só para ver e ligar. */}
        {tab === 'contatos' &&
          (ios ? (
            <Agenda agenda={state.agenda ?? SEM_AGENDA} contatos={daAgenda.contatos} send={send} />
          ) : (
            <Contatos
              contatos={state.contatos}
              daEmpresa={daEmpresa.contatos}
              comPlanilha={state.empresa.link !== ''}
              send={send}
              onNew={() => setView({ kind: 'contato', back: view })}
              onEdit={(contato) => setView({ kind: 'contato', contato, back: view })}
            />
          ))}
      </main>
      <Nav tabs={abas} tab={tab} onSelect={(t) => setView({ kind: 'tab', tab: t })} keyShortcuts={!ios} />
      {avisos}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
