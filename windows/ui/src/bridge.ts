// A ponte com o C++ (docs/ponte-windows.md): manda os comandos e recebe state/toast/ring.
// No WebView2 é o window.chrome.webview. Sem ele (um navegador comum, os testes), a ponte falsa do `?fake=<cenario>`
// faz o papel do C++; no app ela nunca entra, porque o WebView2 sempre tem o window.chrome.webview.
import { createFakeWebview } from './fake';
import type { FakeView } from '../tests/fake-scenarios';
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
    const fake = createFakeWebview(new URLSearchParams(location.search).get('fake') ?? 'principal');
    webview = fake.webview;
    initialView = fake.view;
  }
  const target = webview;
  const mismatchListeners: Array<() => void> = [];

  return {
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
