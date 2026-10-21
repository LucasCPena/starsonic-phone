// A ponte falsa: um "C++ de mentira" para abrir a interface num navegador comum e nos testes (Playwright).
// Responde ao `ready` com o estado do cenário (tests/fake-scenarios.ts) e imita as respostas mais simples do
// DesktopApp. Guarda cada comando em window.__comandos; window.__fake.push(msg) manda uma mensagem à interface.
// As regras de verdade (validações, ligações) são do C++: aqui só o bastante para as telas reagirem.
import { createScenario, type FakeView } from '../tests/fake-scenarios';
import type { WebviewLike } from './bridge';
import type { AppState, Contact, IncomingMessage } from './state';

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

export function createFakeWebview(name: string): { webview: WebviewLike; view: FakeView | undefined } {
  const scenario = createScenario(name) ?? createScenario('principal')!;
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

  const handle = (command: Record<string, unknown>) => {
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
            entrar: { servidor: '', protocolo: 'udp', ramal: '', nome: '', erro: '', ocupado: false, pedeSenha: false, contaId: '' },
            contas: [...outras, salva],
            conta: { id, nome, ramal, servidor, protocolo, status: 'conectado', texto: `Conectado · ${servidor}` },
          });
        }, 400);
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
