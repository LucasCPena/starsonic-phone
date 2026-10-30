// O modo iPhone (spec do iPhone, seção 8; docs/ponte-windows.md, "O modo iPhone"): a mesma interface no WKWebView do
// app do iPhone. Quem liga o modo é o estado (`plataforma: "ios"`); sem ele, a interface é a do Windows de sempre. No
// modo iPhone saem a barra de título (e as zonas de redimensionar), os atalhos de teclado, a aba Atalhos, a pergunta da
// atualização, a área do administrador e o toque; a tela respeita a área segura (o app.css, debaixo do
// data-plataforma="ios" do .win).
import type { AppState } from './state';
import type { Tab } from './types';

export function isIos(state: Pick<AppState, 'plataforma'> | null): boolean {
  return state?.plataforma === 'ios';
}

/** As abas do iPhone: sem os Atalhos (fora da 1.0). */
export const IPHONE_TABS: Tab[] = ['teclado', 'recentes', 'contatos'];

/**
 * O viewport do iPhone: a página vai até as bordas da tela (a área segura fica com o app.css, pelo
 * env(safe-area-inset-*)) e sem o zoom (nem o do campo com o foco).
 */
export const IPHONE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1';

export function applyIphoneViewport(): void {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', IPHONE_VIEWPORT);
}
