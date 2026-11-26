// A aba Reuniões (os quadros Main e PrimeiraVez): o título "Reuniões", "As que você marcou" e as reuniões da pessoa, na
// ordem do servidor: o assunto (ou "Reunião sem assunto"), o dia e a hora e, com alguém nela, o "Acontecendo". Sem
// nenhuma, a primeira vez; sem conexão, a frase da falta de conexão no lugar da lista. Os assuntos vão sempre como
// texto. O "Nova reunião" abre o formulário. Cada linha tem o "Copiar link" (que diz "Link copiado" por 2 s, e o
// `status` que o leitor de tela lê) e o botão do menu: até quando o link vale e o "Cancelar a reunião", que pergunta
// antes (Cancelar.tsx). No tamanho Mínimo, a linha só tem o botão do menu, e o "Copiar link" é o primeiro item dele. A
// hora de agora é lida a cada desenho, e a aba é desenhada de novo a cada leitura da lista.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Menu } from '../../components/Menu';
import {
  IconCancelarReuniao,
  IconCheck,
  IconCopiar,
  IconPlus,
  IconReticencias,
  IconReunioes,
  IconSemRede,
} from '../../icons';
import { useLayout } from '../../layout';
import type { VistaReunioes } from '../cliente';
import { acontecendo, descricaoDaLinha, quando, valeAteTexto } from '../formato';
import {
  AS_QUE_VOCE_MARCOU,
  CANCELAR_A_REUNIAO,
  COPIAR_LINK,
  LINK_COPIADO,
  maisOpcoesDe,
  NENHUMA_REUNIAO,
  NOVA_REUNIAO,
  opcoesDe,
  PRIMEIRA_VEZ_ANTES,
  PRIMEIRA_VEZ_DEPOIS,
  REUNIOES,
  SEM_ASSUNTO,
  SEM_CONEXAO_COM_O_CHAT,
} from '../textos';
import type { Reuniao } from '../tipos';
import { Cancelar } from './Cancelar';

interface Props {
  vista: VistaReunioes;
  /** O botão "Nova reunião". */
  onNova(): void;
  /** O "Copiar link" da linha (e o do menu, no tamanho Mínimo). */
  onCopiar(reuniao: Reuniao): void;
  /** O "Cancelar a reunião" do diálogo: resolve quando ela saiu da lista; rejeita com a falha. */
  onCancelar(codigo: string): Promise<void>;
}

interface LinhaProps extends Pick<Props, 'onCopiar' | 'onCancelar'> {
  reuniao: Reuniao;
  agora: number;
  copiado: boolean;
  /** No tamanho Mínimo, a linha só tem o botão do menu, e o "Copiar link" é o primeiro item dele. */
  minimo: boolean;
}

function Linha({ reuniao, agora, copiado, minimo, onCopiar, onCancelar }: LinhaProps) {
  const aoVivo = acontecendo(reuniao);
  const assunto = reuniao.assunto || SEM_ASSUNTO;
  const mais = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [falhou, setFalhou] = useState(false);
  // A linha saiu da tela (a lista foi relida sem ela): a resposta do cancelar não muda mais nada.
  const viva = useRef(true);
  useLayoutEffect(
    () => () => {
      viva.current = false;
    },
    [],
  );

  const copiar = () => onCopiar(reuniao);
  const abrirCancelar = () => {
    setMenu(false);
    setFalhou(false);
    setCancelando(true);
  };
  const voltar = () => {
    setCancelando(false);
    mais.current?.focus();
  };
  const cancelar = async () => {
    setOcupado(true);
    setFalhou(false);
    try {
      await onCancelar(reuniao.codigo);
    } catch {
      if (viva.current) {
        setOcupado(false);
        setFalhou(true);
      }
      return;
    }
    // Deu certo: a lista relida já não tem a linha. Se ela continua (a releitura falhou), a pergunta fecha.
    if (viva.current) {
      setOcupado(false);
      setCancelando(false);
    }
  };

  return (
    <li>
      <article
        class={aoVivo ? 'reun-linha reun-linha-ao-vivo' : 'reun-linha'}
        aria-label={descricaoDaLinha(reuniao, agora)}
      >
        <h2 class="reun-assunto">{assunto}</h2>
        <div class="reun-meta">
          {reuniao.inicio !== null && <span class="reun-quando">{quando(reuniao.inicio, agora)}</span>}
          {aoVivo && (
            <span class="reun-acontecendo">
              <span class="reun-ponto" aria-hidden="true" />
              {aoVivo}
            </span>
          )}
          {copiado && (
            <span class="sr-only" role="status">
              {LINK_COPIADO}
            </span>
          )}
        </div>
        <div class="reun-acoes">
          {!minimo && (
            <button type="button" class="reun-copiar" onClick={copiar}>
              {copiado ? <IconCheck size="sm" /> : <IconCopiar size="sm" />}
              {copiado ? LINK_COPIADO : COPIAR_LINK}
            </button>
          )}
          <span class="reun-folga" />
          <div class="reun-mais-caixa">
            <button
              ref={mais}
              type="button"
              class="reun-mais"
              aria-label={maisOpcoesDe(reuniao.assunto)}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              <IconReticencias />
            </button>
            {menu && (
              <Menu label={opcoesDe(reuniao.assunto)} anchor={mais} onClose={() => setMenu(false)} class="reun-menu">
                {reuniao.valeAte !== null && (
                  <span class="reun-menu-vale">{valeAteTexto(reuniao.valeAte, agora)}</span>
                )}
                {minimo && (
                  <button
                    type="button"
                    role="menuitem"
                    class="menuitem"
                    onClick={() => {
                      setMenu(false);
                      copiar();
                      mais.current?.focus();
                    }}
                  >
                    <IconCopiar size="sm" />
                    {COPIAR_LINK}
                  </button>
                )}
                <button type="button" role="menuitem" class="menuitem reun-menu-cancelar" onClick={abrirCancelar}>
                  <IconCancelarReuniao size="sm" />
                  {CANCELAR_A_REUNIAO}
                </button>
              </Menu>
            )}
          </div>
        </div>
        {cancelando && (
          <Cancelar
            reuniao={reuniao}
            agora={agora}
            ocupado={ocupado}
            falhou={falhou}
            onVoltar={voltar}
            onCancelar={() => void cancelar()}
          />
        )}
      </article>
    </li>
  );
}

export function Aba({ vista, onNova, onCopiar, onCancelar }: Props) {
  const { lista, conectado, copiado } = vista;
  const agora = Date.now();
  const minimo = useLayout() === 'minimo';
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
              <Linha
                key={r.codigo}
                reuniao={r}
                agora={agora}
                copiado={copiado === r.codigo}
                minimo={minimo}
                onCopiar={onCopiar}
                onCancelar={onCancelar}
              />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
