// (0.4.0) O painel de adicionar (o quadro Adicionar): o painel pelo nome ou pelo número do Transferir (o PainelPorNome),
// com o título e o nome do campo "Adicionar à sala", a ajuda e um botão só, o Adicionar (desligado sem número). O contato
// escolhido vai para o campo, com o "Para:", e vai com o `contato` enquanto o campo não muda (a regra do Transferir); o
// Enter adiciona como o Adicionar. No Windows, o Adicionar e o Cancelar ignoram o segundo clique de um clique duplo (o
// NoWindows de quem mostra o painel).
import type { VNode } from 'preact';
import { useContext } from 'preact/hooks';
import type { Linha } from '../lista-de-contatos';
import { semSegundoClique } from '../plataforma';
import { NoWindows } from '../screens/controlesDaLigacao';
import { PainelPorNome } from '../screens/PainelPorNome';
import { ADICIONAR, ADICIONAR_A_SALA, AJUDA_DE_ADICIONAR } from './textos';

interface Props {
  /** Os meus contatos e os da lista da empresa (a `todas` do listaDeContatos). */
  lista: Linha[];
  /** Adiciona o número; `doContato`: é o de um contato escolhido, sem mudança depois (vai com o `contato`). */
  onAdicionar(numero: string, doContato: boolean): void;
  onCancel(): void;
}

export function PainelDeAdicionar({ lista, onAdicionar, onCancel }: Props): VNode {
  const noWindows = useContext(NoWindows);
  return (
    <PainelPorNome
      titulo={ADICIONAR_A_SALA}
      rotulo={ADICIONAR_A_SALA}
      lista={lista}
      onCancel={onCancel}
      onContact={null}
      onEnter={onAdicionar}
      ajuda={AJUDA_DE_ADICIONAR}
      actions={(numero, doContato) => (
        <button type="button" class="btn btn-cyan" disabled={!numero} onClick={semSegundoClique(noWindows, () => onAdicionar(numero, doContato))}>
          {ADICIONAR}
        </button>
      )}
    />
  );
}
