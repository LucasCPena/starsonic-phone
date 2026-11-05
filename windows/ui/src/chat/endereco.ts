// O endereço do servidor do chat, num lugar só (docs/chat-protocolo.md: a API em /api/v1 e o WebSocket em
// wss://<o mesmo endereço>/api/v1/eventos). O executável tem o dele, o kChatOrigin do windows/app/src/ChatFiles.h.

export const ENDERECO_DO_CHAT = 'https://chat.starcloud-starsonic.com.br:8443';

/**
 * O endereço que a interface usa. O gancho de teste, o `chat=<endereço>` da URL, só vale com a ponte falsa (o
 * `?fake=<cenário>`, sem o window.chrome.webview): no app de verdade, é sempre o ENDERECO_DO_CHAT.
 */
export function enderecoDoChat(): string {
  if (window.chrome?.webview) return ENDERECO_DO_CHAT;
  const parametros = new URLSearchParams(location.search);
  const teste = parametros.get('chat');
  return parametros.get('fake') && teste ? teste : ENDERECO_DO_CHAT;
}
