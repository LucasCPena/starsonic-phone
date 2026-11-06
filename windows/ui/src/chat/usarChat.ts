// A vista do chat para as telas: a de agora, e de novo a cada mudança do cliente. A assinatura é um efeito de layout:
// ela já vale quando o main.tsx passa um estado novo ao cliente (o outro efeito de layout), e a vista que muda com ele
// entra no mesmo desenho, antes de a tela ser pintada (a troca de conta nunca mostra a lista da pessoa de antes).
// (Task 5) As leituras e as ações das telas da nova conversa, do novo grupo e dos membros, e o texto da falha de um
// pedido delas.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ErroChat } from './api';
import type { ChatCliente, VistaChat } from './cliente';
import { muitasTentativas, SEM_CONEXAO_TENTE } from './textos';

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

/**
 * (Task 5) O toast de um pedido de uma tela que não deu certo (R31): sem rede (ou sem resposta em 20 s) ou com um 5xx,
 * "Sem conexão com o chat. Tente de novo."; com um 429, "Muitas tentativas. Tente de novo daqui a …". Os outros não têm
 * toast: o 401 é o `fora`, o 404 de um grupo relê a lista, e o resto cada tela trata (null).
 */
export function textoDaFalha(e: unknown): string | null {
  if (!(e instanceof ErroChat)) return null;
  if (e.status === 0 || e.status >= 500) return SEM_CONEXAO_TENTE;
  if (e.status === 429) return muitasTentativas(e.esperarSegundos ?? 60);
  return null;
}

/**
 * (Task 5) Uma leitura de uma tela (os colegas, os membros), com a pessoa dentro e o chat conectado: quando a tela abre, a
 * cada mudança da `chave`, a cada `reler` e a cada volta da conexão (a faixa que sai). A resposta de uma leitura que já
 * não é a de agora (ou da tela fechada) não vale. A que não vem mostra o toast da falha, e a tela fica com o que tinha.
 * `dados` é null até a primeira resposta.
 */
export function useLeitura<T>(
  vista: VistaChat,
  ler: () => Promise<T>,
  chave: readonly unknown[],
  avisar: (texto: string) => void,
): { dados: T | null; reler(): void } {
  const [dados, setDados] = useState<T | null>(null);
  const [vez, setVez] = useState(0);
  const pode = vista.situacao === 'pronto' && vista.conectado;
  useEffect(() => {
    if (!pode) return;
    let vale = true;
    ler().then(
      (r) => {
        if (vale) setDados(r);
      },
      (e) => {
        const texto = vale ? textoDaFalha(e) : null;
        if (texto) avisar(texto);
      },
    );
    return () => {
      vale = false;
    };
  }, [pode, vez, ...chave]);
  const reler = useCallback(() => setVez((v) => v + 1), []);
  return { dados, reler };
}

/**
 * (Task 5) As ações de uma tela (criar, pôr, tirar, sair), uma de cada vez (`emCurso` desliga o botão dela). O resultado
 * só vale com a tela aberta: o `deu` (abrir a conversa, voltar, ler de novo) e, numa falha sem rede, com um 5xx ou com
 * um 429, o toast (R31); nos outros erros da API, o `falhou` da tela. A tela fica como está.
 */
export function useAcao(avisar: (texto: string) => void): {
  emCurso: boolean;
  fazer<T>(pedir: () => Promise<T>, deu: (r: T) => void, falhou?: (e: ErroChat) => void): void;
} {
  const [emCurso, setEmCurso] = useState(false);
  const ocupada = useRef(false);
  /** A tela ainda está na janela. */
  const montada = useRef(true);
  useEffect(
    () => () => {
      montada.current = false;
    },
    [],
  );
  const fazer = useCallback(
    <T>(pedir: () => Promise<T>, deu: (r: T) => void, falhou?: (e: ErroChat) => void) => {
      if (ocupada.current) return;
      ocupada.current = true;
      setEmCurso(true);
      const acabou = () => {
        ocupada.current = false;
        if (montada.current) setEmCurso(false);
      };
      pedir().then(
        (r) => {
          acabou();
          if (montada.current) deu(r);
        },
        (e) => {
          acabou();
          if (!montada.current) return;
          const texto = textoDaFalha(e);
          if (texto) avisar(texto);
          else if (e instanceof ErroChat) falhou?.(e);
        },
      );
    },
    [avisar],
  );
  return { emCurso, fazer };
}
