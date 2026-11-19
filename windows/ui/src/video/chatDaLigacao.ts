// (vídeo, etapa 2) O colega da ligação no chat (spec do vídeo, 4.4): o Chat da tela da ligação e do grande aparece com o
// computador no chat e a pessoa da conta dentro dele (a situação `pronto`), no Windows, numa ligação de cima (já com o id
// dela) cujo número, comparado só pelos dígitos, é o ramal de um colega que não saiu do chat. A procura começa pelas
// conversas a dois da lista; sem uma com ele, os colegas vêm do servidor (o colegas()), uma vez por ligação (o id da de
// cima: o motor nunca repete um). Uma falha só deixa o Chat de fora, sem aviso nenhum (Review Focus 5).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChatCliente, VistaChat } from '../chat/cliente';
import type { Pessoa } from '../chat/tipos';
import { digitsOnly } from '../format';
import { isIos } from '../plataforma';
import type { AppState } from '../state';

/** A pessoa com o ramal desses dígitos que não saiu do chat; null sem nenhuma. */
function doRamal(pessoas: Pessoa[], digitos: string): Pessoa | null {
  return pessoas.find((p) => !p.saiu && digitsOnly(p.ramal) === digitos) ?? null;
}

/**
 * O colega do chat na ligação de cima, ou null: fora da situação `pronto`, no iPhone, sem ligação (ou sem o estado) e
 * com a feita que ainda não tem id (o 0).
 */
export function useColegaDaLigacao(cliente: ChatCliente, vista: VistaChat, state: AppState | null): Pessoa | null {
  const top = state?.ligacao?.top;
  const id = top && top.id > 0 && vista.situacao === 'pronto' && !isIos(state) ? top.id : 0;
  const digitos = id > 0 && top ? digitsOnly(top.number) : '';
  const daLista = digitos ? doRamal(vista.conversas.flatMap((c) => (c.tipo === 'dupla' ? [c.com] : [])), digitos) : null;
  const buscar = digitos !== '' && daLista === null;
  // Os colegas do servidor e a ligação que os pediu; `pediu`, a última ligação que pediu (cada uma pede uma vez só).
  const [doServidor, setDoServidor] = useState<{ ligacao: number; pessoas: Pessoa[] } | null>(null);
  const pediu = useRef(0);
  useEffect(() => {
    if (!buscar || pediu.current === id) return;
    pediu.current = id;
    cliente.colegas().then(
      (pessoas) => {
        // A resposta de uma ligação de antes (outra já pediu depois dela) não vale.
        if (pediu.current === id) setDoServidor({ ligacao: id, pessoas });
      },
      () => {
        // Sem os colegas, sem o Chat: nenhum aviso.
      },
    );
  }, [buscar, id, cliente]);
  if (!digitos) return null;
  return daLista ?? (doServidor?.ligacao === id ? doRamal(doServidor.pessoas, digitos) : null);
}
