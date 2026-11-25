// A vista das reuniões para as telas: a de agora, e de novo a cada mudança do cliente (como o usarChat.ts).
import { useLayoutEffect, useState } from 'preact/hooks';
import type { ReunioesCliente, VistaReunioes } from './cliente';

export function useVistaReunioes(cliente: ReunioesCliente): VistaReunioes {
  const [vista, setVista] = useState(() => cliente.vista());
  useLayoutEffect(() => {
    const parar = cliente.assinar(() => setVista(cliente.vista()));
    // O que mudou entre o primeiro desenho e a assinatura.
    setVista(cliente.vista());
    return parar;
  }, [cliente]);
  return vista;
}
