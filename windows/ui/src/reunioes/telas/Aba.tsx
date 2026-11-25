// A aba Reuniões (os quadros Main e PrimeiraVez): o título "Reuniões", "As que você marcou" e as reuniões da pessoa, na
// ordem do servidor: o assunto (ou "Reunião sem assunto"), o dia e a hora e, com alguém nela, o "Acontecendo". Sem
// nenhuma, a primeira vez; sem conexão, a frase da falta de conexão no lugar da lista. Os assuntos vão sempre como
// texto. O "Nova reunião" abre o formulário; a linha da reunião que acabou de ter o link copiado diz "Link copiado" (um
// `status`, por 2 s). A hora de agora é lida a cada desenho, e a aba é desenhada de novo a cada leitura da lista.
import { IconCheck, IconPlus, IconReunioes, IconSemRede } from '../../icons';
import type { VistaReunioes } from '../cliente';
import { acontecendo, descricaoDaLinha, quando } from '../formato';
import {
  AS_QUE_VOCE_MARCOU,
  LINK_COPIADO,
  NENHUMA_REUNIAO,
  NOVA_REUNIAO,
  PRIMEIRA_VEZ_ANTES,
  PRIMEIRA_VEZ_DEPOIS,
  REUNIOES,
  SEM_ASSUNTO,
  SEM_CONEXAO_COM_O_CHAT,
} from '../textos';
import type { Reuniao } from '../tipos';

interface Props {
  vista: VistaReunioes;
  /** O botão "Nova reunião". */
  onNova(): void;
}

function Linha({ reuniao, agora, copiado }: { reuniao: Reuniao; agora: number; copiado: boolean }) {
  const aoVivo = acontecendo(reuniao);
  return (
    <li>
      <article
        class={aoVivo ? 'reun-linha reun-linha-ao-vivo' : 'reun-linha'}
        aria-label={descricaoDaLinha(reuniao, agora)}
      >
        <h2 class="reun-assunto">{reuniao.assunto || SEM_ASSUNTO}</h2>
        <div class="reun-meta">
          {reuniao.inicio !== null && <span class="reun-quando">{quando(reuniao.inicio, agora)}</span>}
          {aoVivo && (
            <span class="reun-acontecendo">
              <span class="reun-ponto" aria-hidden="true" />
              {aoVivo}
            </span>
          )}
          {copiado && (
            <span class="reun-copiado" role="status">
              <IconCheck size="sm" />
              {LINK_COPIADO}
            </span>
          )}
        </div>
      </article>
    </li>
  );
}

export function Aba({ vista, onNova }: Props) {
  const { lista, conectado, copiado } = vista;
  const agora = Date.now();
  return (
    <div class="body scroll chat reun">
      <div class="reun-cabeca">
        <div class="reun-topo">
          <h1 class="chat-titulo">{REUNIOES}</h1>
          <span class="reun-sub">{AS_QUE_VOCE_MARCOU}</span>
        </div>
        <button type="button" class="btn btn-cyan reun-nova" onClick={onNova}>
          <IconPlus size="sm" />
          {NOVA_REUNIAO}
        </button>
      </div>
      {!conectado ? (
        <div class="chat-vazio">
          <span class="chat-vazio-tile" aria-hidden="true">
            <IconSemRede />
          </span>
          <p class="chat-vazio-texto" role="status">
            {SEM_CONEXAO_COM_O_CHAT}
          </p>
        </div>
      ) : lista !== null && lista.length === 0 ? (
        <div class="chat-vazio">
          <span class="chat-vazio-tile" aria-hidden="true">
            <IconReunioes />
          </span>
          <h2 class="chat-vazio-titulo">{NENHUMA_REUNIAO}</h2>
          <p class="chat-vazio-texto reun-vazio-texto">
            {PRIMEIRA_VEZ_ANTES}
            <strong>{NOVA_REUNIAO}</strong>
            {PRIMEIRA_VEZ_DEPOIS}
          </p>
        </div>
      ) : (
        lista !== null && (
          <ul class="reun-lista">
            {lista.map((r) => (
              <Linha key={r.codigo} reuniao={r} agora={agora} copiado={copiado === r.codigo} />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
