// A ponte com o C++ (docs/ponte-windows.md): manda os comandos e recebe state/toast/ring.
// No WebView2 é o window.chrome.webview. Sem ele, só com `?fake=<cenario>` (um navegador comum, os testes) a ponte
// falsa faz o papel do C++. Sem o webview e sem um cenário válido, a ponte fica indisponível: a interface mostra o
// erro e não manda nada (nunca finge um app conectado com dados de exemplo).
// (0.3.0) As memórias do vídeo (docs/ponte-windows.md, "A memória do vídeo") chegam pelo evento `sharedbufferreceived`.
// Só passa uma memória que confere: o `additionalData` (o objeto, ou o texto JSON dele) de uma vista conhecida com o
// tamanho combinado, e a memória com pelo menos esse tamanho. As outras são soltas na hora (o `releaseBuffer`).
import { createFakeWebview } from './fake';
import type { FakeView } from './fake-scenarios';
import { PROTOCOL_VERSION, type Command, type IncomingMessage, type VistaDeVideoNome } from './state';
import { TAMANHO_DA_MEMORIA } from './video/memoria';

/** (0.3.0) O evento de uma memória dividida do WebView2 (o `sharedbufferreceived`). */
export interface SharedBufferEventLike {
  additionalData: unknown;
  getBuffer(): ArrayBuffer;
}

/** O pedaço do window.chrome.webview que a interface usa. */
export interface WebviewLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'sharedbufferreceived', listener: (event: SharedBufferEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'sharedbufferreceived', listener: (event: SharedBufferEventLike) => void): void;
  /** (0.3.0) Solta a memória dividida na hora, sem esperar o coletor de lixo. */
  releaseBuffer?(buffer: ArrayBuffer): void;
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
  /** (0.3.0) Recebe as memórias do vídeo que conferem; devolve a função que para de receber. */
  subscribeBuffers(listener: (vista: VistaDeVideoNome, buffer: ArrayBuffer) => void): () => void;
  /** (0.3.0) Solta uma memória do vídeo (a velha de uma vista que ganhou uma nova). */
  releaseBuffer(buffer: ArrayBuffer): void;
}

function isMessage(data: unknown): data is IncomingMessage {
  return typeof data === 'object' && data !== null && 'type' in data && 'v' in data;
}

const VISTAS: readonly VistaDeVideoNome[] = ['remoto', 'local', 'porteiro'];

/** (0.3.0) A vista de uma memória que confere (`{v: 1, type: 'videoBuffer', vista, bytes: 6220864}`), ou `null`. */
function vistaDaMemoria(additionalData: unknown, buffer: ArrayBuffer): VistaDeVideoNome | null {
  let dados = additionalData;
  if (typeof dados === 'string') {
    try {
      dados = JSON.parse(dados);
    } catch {
      return null;
    }
  }
  if (typeof dados !== 'object' || dados === null) return null;
  const { v, type, vista, bytes } = dados as Record<string, unknown>;
  const conhecida = VISTAS.find((nome) => nome === vista);
  if (v !== PROTOCOL_VERSION || type !== 'videoBuffer' || !conhecida || bytes !== TAMANHO_DA_MEMORIA) return null;
  return buffer.byteLength >= TAMANHO_DA_MEMORIA ? conhecida : null;
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
    subscribeBuffers(listener) {
      const handler = (event: SharedBufferEventLike) => {
        const buffer = event.getBuffer();
        const vista = vistaDaMemoria(event.additionalData, buffer);
        if (vista) listener(vista, buffer);
        else target.releaseBuffer?.(buffer);
      };
      target.addEventListener('sharedbufferreceived', handler);
      return () => target.removeEventListener('sharedbufferreceived', handler);
    },
    releaseBuffer(buffer) {
      target.releaseBuffer?.(buffer);
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
    subscribeBuffers: () => () => {},
    releaseBuffer() {},
  };
}
