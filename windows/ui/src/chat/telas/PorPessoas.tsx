// O pôr pessoas no grupo (o quadro NovoGrupo, sem o nome), aberto pelos membros: o nome do grupo em cima do título e o
// Voltar; a escolha (o Escolher) entre os colegas que não estão no grupo e o "Pôr N pessoas no grupo", desligado, com
// "Pôr pessoas no grupo", sem ninguém escolhido. O grupo tem até 200 pessoas: a escolha para em 200 menos as que ele
// tem (R25). Posto, volta para os membros, que leem a lista de novo. Sem conexão, a faixa.
import { useMemo } from 'preact/hooks';
import { BackBar } from '../../components/BackBar';
import { IconSemRede } from '../../icons';
import type { ChatCliente, VistaChat } from '../cliente';
import { Faixa } from '../componentes/Faixa';
import { NINGUEM_ENCONTRADO, O_GRUPO_JA_TEM_200, POR_PESSOAS_NO_GRUPO, porNoGrupo, SEM_CONEXAO_TENTANDO } from '../textos';
import type { Conversa } from '../tipos';
import { useAcao, useLeitura } from '../usarChat';
import { Escolher, MAX_DO_GRUPO, useEscolha } from './Escolher';

interface Props {
  vista: VistaChat;
  /** O grupo, da lista (o nome e as pessoas dele). */
  conversa: Extract<Conversa, { tipo: 'grupo' }>;
  cliente: ChatCliente;
  /** O toast da falha de um pedido (R31). */
  avisar(texto: string): void;
  /** De volta aos membros. */
  onVoltar(): void;
}

export function PorPessoas({ vista, conversa, cliente, avisar, onVoltar }: Props) {
  const id = conversa.id;
  const colegas = useLeitura(vista, () => cliente.colegas(), [cliente], avisar);
  // Os membros de novo quando o grupo muda (alguém que saiu volta a ser escolhível).
  const membros = useLeitura(vista, () => cliente.membros(id), [cliente, id, conversa.pessoas], avisar);
  const fora = useMemo(() => {
    const dentro = membros.dados && new Set(membros.dados.map((m) => m.pessoa.id));
    return colegas.dados && dentro ? colegas.dados.filter((p) => !dentro.has(p.id)) : null;
  }, [colegas.dados, membros.dados]);
  const max = Math.max(0, MAX_DO_GRUPO - conversa.pessoas);
  const { escolhidas, marcar, naOrdem } = useEscolha(fora, max);
  const { emCurso, fazer } = useAcao(avisar);
  const por = () =>
    fazer(
      () => cliente.por(id, naOrdem),
      onVoltar,
      (e) => {
        if (e.erro === 'grupoCheio') avisar(O_GRUPO_JA_TEM_200);
        // Não cuida mais (R31): os membros, que leem a lista de novo, sem o Pôr pessoas.
        else if (e.status === 403) onVoltar();
        // Uma pessoa escolhida saiu do chat nesse meio: os colegas e os membros de novo, sem ela. (Um grupo que não é
        // mais da pessoa sai da lista, e a tela volta para ela: R26.)
        else if (e.status === 400 || e.status === 404) {
          colegas.reler();
          membros.reler();
        }
      },
    );

  return (
    <>
      <BackBar title={POR_PESSOAS_NO_GRUPO} eyebrow={conversa.nome} onBack={onVoltar} />
      {!vista.conectado && <Faixa icone={<IconSemRede size="sm" />}>{SEM_CONEXAO_TENTANDO}</Faixa>}
      <div class="chat-fundo">
        <div class="body chat-escolha">
          <Escolher pessoas={fora} escolhidas={escolhidas} max={max} vazia={NINGUEM_ENCONTRADO} onMarcar={marcar} focarBusca />
          <button type="button" class="btn btn-cyan chat-confirmar" disabled={naOrdem.length === 0 || emCurso} onClick={por}>
            {naOrdem.length > 0 ? porNoGrupo(naOrdem.length) : POR_PESSOAS_NO_GRUPO}
          </button>
        </div>
      </div>
    </>
  );
}
