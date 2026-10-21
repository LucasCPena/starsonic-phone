// A ponte com o C++ (docs/ponte-windows.md): manda os comandos e recebe state/toast/ring.
// No WebView2 é o window.chrome.webview. Sem ele, só com `?fake=<cenario>` (um navegador comum, os testes) a ponte
// falsa faz o papel do C++. Sem o webview e sem um cenário válido, a ponte fica indisponível: a interface mostra o
// erro e não manda nada (nunca finge um app conectado com dados de exemplo).
import { createFakeWebview } from './fake';
import type { FakeView } from './fake-scenarios';
import { PROTOCOL_VERSION, type Command, type IncomingMessage } from './state';

/** O pedaço do window.chrome.webview que a interface usa. */
export interface WebviewLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebviewLike };
  }
}

export type MessageListener = (message: IncomingMessage) => void;

export interface Bridge {
  send(command: Command): void;
  /** Recebe as mensagens; devolve a função que para de receber. */
  subscribe(listener: MessageListener): () => void;
  /** false: sem o window.chrome.webview e sem `?fake=<cenario>` válido (a interface mostra o erro). */
  readonly available: boolean;
  /** A tela em que a interface abre (só a ponte falsa escolhe uma). */
  readonly initialView: FakeView | undefined;
  /** A mensagem veio de outra versão do formato. */
  readonly onVersionMismatch: (listener: () => void) => void;
}

function isMessage(data: unknown): data is IncomingMessage {
  return typeof data === 'object' && data !== null && 'type' in data && 'v' in data;
}

export function createBridge(): Bridge {
  let webview = window.chrome?.webview;
  let initialView: FakeView | undefined;
  if (!webview) {
    const cenario = new URLSearchParams(location.search).get('fake');
    const fake = cenario ? createFakeWebview(cenario) : null;
    if (!fake) return unavailableBridge();
    webview = fake.webview;
    initialView = fake.view;
  }
  const target = webview;
  const mismatchListeners: Array<() => void> = [];

  return {
    available: true,
    initialView,
    send(command) {
      target.postMessage({ v: PROTOCOL_VERSION, ...command });
    },
    subscribe(listener) {
      const handler = (event: { data: unknown }) => {
        let data = event.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            return;
          }
        }
        if (!isMessage(data)) return;
        // Outra versão do formato: a mensagem é ignorada e a interface pede a reinstalação.
        if (data.v !== PROTOCOL_VERSION) {
          for (const l of mismatchListeners) l();
          return;
        }
        listener(data);
      };
      target.addEventListener('message', handler);
      return () => target.removeEventListener('message', handler);
    },
    onVersionMismatch(listener) {
      mismatchListeners.push(listener);
    },
  };
}

/** A ponte sem o C++: não manda nem recebe nada. */
function unavailableBridge(): Bridge {
  return {
    available: false,
    initialView: undefined,
    send() {},
    subscribe: () => () => {},
    onVersionMismatch() {},
  };
}
