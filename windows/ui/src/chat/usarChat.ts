// A vista do chat para as telas: a de agora, e de novo a cada mudança do cliente. A assinatura é um efeito de layout:
// ela já vale quando o main.tsx passa um estado novo ao cliente (o outro efeito de layout), e a vista que muda com ele
// entra no mesmo desenho, antes de a tela ser pintada (a troca de conta nunca mostra a lista da pessoa de antes).
import { useLayoutEffect, useState } from 'preact/hooks';
import type { ChatCliente, VistaChat } from './cliente';

export function useVistaChat(c: ChatCliente): VistaChat {
  const [vista, setVista] = useState(() => c.vista());
  useLayoutEffect(() => {
    const parar = c.assinar(() => setVista(c.vista()));
    // O que mudou entre o primeiro desenho e a assinatura.
    setVista(c.vista());
    return parar;
  }, [c]);
  return vista;
}
