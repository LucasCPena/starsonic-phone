// A ponte falsa: um "C++ de mentira" para abrir a interface num navegador comum e nos testes (Playwright).
// Responde ao `ready` com o estado do cenário (src/fake-scenarios.ts) e imita as respostas mais simples do
// DesktopApp. Guarda cada comando em window.__comandos; window.__fake.push(msg) manda uma mensagem à interface.
// As regras de verdade (validações, ligações) são do C++: aqui só o bastante para as telas reagirem.
import { createScenario, type FakeView } from './fake-scenarios';
import type { WebviewLike } from './bridge';
import type { AppState, CallCard, CallState, Contact, IncomingMessage, RingKind } from './state';

type Listener = (event: { data: unknown }) => void;

export interface FakeHooks {
  push(message: unknown): void;
  state(): AppState;
}

declare global {
  interface Window {
    __comandos?: Array<Record<string, unknown>>;
    __fake?: FakeHooks;
  }
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function sortContacts(list: Contact[]): Contact[] {
  return [...list].sort((a, b) => fold(a.nome).localeCompare(fold(b.nome)));
}

/** `null` para um cenário que não existe (a interface mostra o erro, não um cenário qualquer). */
export function createFakeWebview(name: string): { webview: WebviewLike; view: FakeView | undefined } | null {
  const scenario = createScenario(name);
  if (!scenario) return null;
  let state: AppState = structuredClone(scenario.state);
  const listeners = new Set<Listener>();
  const sent: Array<Record<string, unknown>> = [];
  window.__comandos = sent;

  const deliver = (message: unknown) => {
    // Assíncrono, como o PostWebMessageAsJson.
    setTimeout(() => {
      for (const l of [...listeners]) l({ data: structuredClone(message) });
    }, 0);
  };
  const publish = () => deliver({ v: 1, type: 'state', state } satisfies IncomingMessage);
  const change = (next: Partial<AppState>) => {
    state = { ...state, ...next };
    publish();
  };

  window.__fake = {
    push(message) {
      if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'state') {
        state = structuredClone((message as { state: AppState }).state);
      }
      deliver(message);
    },
    state: () => structuredClone(state),
  };

  const ring = (tipo: RingKind) => deliver({ v: 1, type: 'ring', tipo } satisfies IncomingMessage);
  const setCall = (ligacao: CallState | null) => change({ ligacao });
  let proximoId = 40;
  /** A segunda ligação feita (Nova ligação ou Consultar): a de agora vai para a espera e a nova chama. */
  const ligarDeNovo = (l: CallState, numero: string, consulta: boolean) => {
    const contato = state.contatos.find((c) => c.numero === numero);
    const nova: CallCard = { id: ++proximoId, number: numero, name: contato?.nome ?? '', incoming: false, phase: 'dialing', activeSinceMs: 0, held: false };
    setCall({ ...l, top: nova, second: { ...l.top, held: true }, secondKind: 'held', consulting: consulta, colleagueActive: consulta });
    // O outro lado atende logo depois.
    setTimeout(() => {
      const agora = state.ligacao;
      if (agora?.top.id === nova.id && agora.top.phase === 'dialing') {
        setCall({ ...agora, top: { ...agora.top, phase: 'active', activeSinceMs: Date.now() } });
      }
    }, 1500);
  };
  /** As ligações do C++ de mentira: só o bastante para a tela da ligação seguir os botões. */
  const handleCall = (command: Record<string, unknown>): boolean => {
    const l = state.ligacao;
    switch (command.cmd) {
      case 'answer':
        if (l?.top.phase === 'ringing') {
          setCall({ ...l, top: { ...l.top, phase: 'active', activeSinceMs: Date.now() } });
          ring('parar');
        } else if (l?.second && l.secondKind === 'ringing') {
          setCall({ ...l, top: { ...l.second, phase: 'active', activeSinceMs: Date.now() }, second: { ...l.top, held: true }, secondKind: 'held' });
          ring('parar');
        }
        return true;
      case 'reject':
        if (l?.top.phase === 'ringing') {
          setCall(null);
          ring('parar');
        } else if (l?.second && l.secondKind === 'ringing') {
          setCall({ ...l, second: null, secondKind: 'none' });
          ring('parar');
        }
        return true;
      case 'hangup': {
        if (!l) return true;
        const id = typeof command.id === 'number' ? command.id : l.top.id;
        const semConsulta = { consulting: false, colleagueActive: false };
        if (l.conference) setCall(null);
        else if (l.top.id === id && l.second && l.secondKind === 'held') {
          // A em espera volta sozinha.
          setCall({ ...l, ...semConsulta, top: { ...l.second, held: false }, second: null, secondKind: 'none' });
        } else if (l.top.id === id) setCall(null);
        else if (l.second?.id === id) setCall({ ...l, ...semConsulta, second: null, secondKind: 'none' });
        return true;
      }
      case 'hold':
        if (l && !l.conference) setCall({ ...l, top: { ...l.top, held: typeof command.on === 'boolean' ? command.on : !l.top.held } });
        return true;
      case 'mute':
        if (l) setCall({ ...l, muted: typeof command.on === 'boolean' ? command.on : !l.muted });
        return true;
      case 'swap':
        if (l?.second && l.secondKind === 'held') {
          setCall({
            ...l,
            top: { ...l.second, held: false },
            second: { ...l.top, held: true },
            colleagueActive: l.consulting ? !l.colleagueActive : false,
          });
        }
        return true;
      case 'join':
        if (l?.second && l.secondKind === 'held' && !l.consulting) {
          setCall({ ...l, top: { ...l.top, held: false }, second: { ...l.second, held: false }, secondKind: 'active', conference: true, conferenceSinceMs: Date.now() });
        }
        return true;
      case 'split':
        if (l?.conference && l.second) {
          setCall({ ...l, second: { ...l.second, held: true }, secondKind: 'held', conference: false, conferenceSinceMs: 0 });
        }
        return true;
      case 'consult':
        if (l && !l.second) ligarDeNovo(l, String(command.numero ?? ''), true);
        return true;
      case 'cancelConsult':
        if (l?.consulting && l.second) {
          const cliente = l.colleagueActive ? l.second : l.top;
          setCall({ ...l, top: { ...cliente, held: false }, second: null, secondKind: 'none', consulting: false, colleagueActive: false });
        }
        return true;
      case 'completeTransfer':
      case 'transfer':
        if (l) setCall(null);
        return true;
      case 'dial':
        // Com uma ligação, a Nova ligação; sem nenhuma, nada muda (as specs do Teclado só olham o comando).
        if (l && !l.second) ligarDeNovo(l, String(command.numero ?? ''), false);
        return true;
      case 'dtmf':
        return true;
      default:
        return false;
    }
  };

  const handle = (command: Record<string, unknown>) => {
    if (handleCall(command)) return;
    switch (command.cmd) {
      case 'ready':
        publish();
        if (scenario.ring) deliver({ v: 1, type: 'ring', tipo: scenario.ring });
        break;
      case 'setDnd':
        change({ naoPerturbe: command.on === true });
        break;
      case 'setAutoAnswer':
        change({
          atenderAutomatico: {
            on: command.on === true,
            segundos: typeof command.segundos === 'number' ? Math.min(30, command.segundos) : state.atenderAutomatico.segundos,
          },
        });
        break;
      case 'setSetting':
        if (command.chave === 'iniciarComWindows') change({ iniciarComWindows: command.valor === true });
        break;
      case 'setAudio': {
        const audio = { ...state.audio };
        if (typeof command.microfone === 'string') audio.microfone = command.microfone;
        if (typeof command.altoFalante === 'string') audio.altoFalante = command.altoFalante;
        if (typeof command.toque === 'string') audio.toque = command.toque;
        const nomes = new Set([...audio.microfones, ...audio.altoFalantes].map((d) => d.nome));
        audio.desconectados = [audio.microfone, audio.altoFalante].filter((n) => n !== '' && !nomes.has(n));
        change({ audio });
        break;
      }
      case 'viewRecents':
        change({ perdidas: 0 });
        break;
      case 'selectAccount': {
        const conta = state.contas.find((c) => c.id === command.contaId);
        if (!conta) break;
        change({
          contas: state.contas.map((c) => ({ ...c, emUso: c.id === conta.id })),
          conta: { ...conta, status: 'conectado', texto: `Conectado · ${conta.servidor}` },
        });
        break;
      }
      case 'saveContact': {
        const contato: Contact = {
          id: typeof command.id === 'string' ? command.id : Math.random().toString(16).slice(2, 18),
          nome: String(command.nome ?? ''),
          numero: String(command.numero ?? ''),
          observacao: String(command.observacao ?? ''),
        };
        change({ contatos: sortContacts([...state.contatos.filter((c) => c.id !== contato.id), contato]) });
        break;
      }
      case 'removeContact':
        change({ contatos: state.contatos.filter((c) => c.id !== command.id) });
        break;
      case 'removeAccount':
        change({ contas: state.contas.filter((c) => c.id !== command.contaId) });
        break;
      case 'cancelLogin':
        // A troca para a conta sem senha sai: a conta em uso continua.
        if (state.entrar.podeCancelar) {
          change({
            tela: 'principal',
            entrar: { servidor: '', protocolo: 'udp', ramal: '', nome: '', erro: '', ocupado: false, pedeSenha: false, podeCancelar: false, contaId: '' },
          });
        }
        break;
      case 'login': {
        const servidor = String(command.servidor ?? '');
        const ramal = String(command.ramal ?? '');
        const nome = String(command.nome ?? '');
        const protocolo = command.protocolo === 'tcp' ? 'tcp' : 'udp';
        const contaId = typeof command.contaId === 'string' ? command.contaId : '';
        change({ entrar: { ...state.entrar, servidor, ramal, nome, protocolo, contaId, erro: '', ocupado: true } });
        // O registro demora um pouco; a senha "errada" imita o 401.
        setTimeout(() => {
          if (command.senha === 'errada') {
            change({ entrar: { ...state.entrar, ocupado: false, erro: 'Ramal ou senha incorretos.' } });
            return;
          }
          const id = contaId || Math.random().toString(16).slice(2, 18);
          const salva = { id, nome, ramal, servidor, protocolo, emUso: true } as const;
          const outras = state.contas.filter((c) => c.id !== id).map((c) => ({ ...c, emUso: false }));
          change({
            tela: 'principal',
            entrar: { servidor: '', protocolo: 'udp', ramal: '', nome: '', erro: '', ocupado: false, pedeSenha: false, podeCancelar: false, contaId: '' },
            contas: [...outras, salva],
            conta: { id, nome, ramal, servidor, protocolo, status: 'conectado', texto: `Conectado · ${servidor}` },
          });
        }, 1500);
        break;
      }
      default:
        break;
    }
  };

  const webview: WebviewLike = {
    postMessage(message) {
      const command = structuredClone(message) as Record<string, unknown>;
      sent.push(command);
      handle(command);
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
  return { webview, view: scenario.view };
}
