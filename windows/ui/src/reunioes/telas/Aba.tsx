// A aba Reuniões (os quadros Main e PrimeiraVez): o título "Reuniões", "As que você marcou" e as reuniões da pessoa, na
// ordem do servidor: o assunto (ou "Reunião sem assunto"), o dia e a hora e, com alguém nela, o "Acontecendo". Sem
// nenhuma, a primeira vez; sem conexão, a frase da falta de conexão no lugar da lista. Os assuntos vão sempre como
// texto. O "Nova reunião" abre o formulário. Cada linha tem o "Copiar link" (que diz "Link copiado" por 2 s, e o
// `status` que o leitor de tela lê) e o botão do menu: até quando o link vale e o "Cancelar a reunião", que pergunta
// antes (Cancelar.tsx). No tamanho Mínimo, a linha só tem o botão do menu, e o "Copiar link" é o primeiro item dele. A
// hora de agora é lida a cada desenho, e a aba é desenhada de novo a cada leitura da lista. No alto da lista fica o
// campo do link de uma reunião (de qualquer pessoa): com um texto, o "Abrir no navegador" (o Enter é o botão); o que
// o `codigoDoTexto` não aceita diz "Este não é um link de reunião do Starsonic." sem pedido nenhum; os erros ficam
// num `alert` embaixo do campo, e o da outra empresa traz o "Abrir no navegador" sem o passe. Deu certo: o campo
// esvazia. O "Abrir no navegador" do menu da linha manda o erro dele ao aviso curto do app.
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Menu } from '../../components/Menu';
import {
  IconAbrirNoNavegador,
  IconCancelarReuniao,
  IconCheck,
  IconCopiar,
  IconLink,
  IconPlus,
  IconReticencias,
  IconReunioes,
  IconSemRede,
} from '../../icons';
import { useLayout } from '../../layout';
import type { ResultadoDoNavegador, VistaReunioes } from '../cliente';
import { acontecendo, codigoDoTexto, descricaoDaLinha, quando, valeAteTexto } from '../formato';
import {
  ABRIR_NO_NAVEGADOR,
  AS_QUE_VOCE_MARCOU,
  CAMPO_DO_LINK,
  CANCELAR_A_REUNIAO,
  COPIAR_LINK,
  ENTRAR_COM_O_LINK,
  LINK_COPIADO,
  maisOpcoesDe,
  NAO_E_LINK_DE_REUNIAO,
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
  /** O endereço do chat: o link inteiro de uma reunião começa com ele. */
  base: string;
  /** O "Abrir no navegador" do menu da linha: o erro dele sai no aviso curto do app. */
  onAbrirDaLinha(codigo: string): void;
  /** O "Abrir no navegador" do campo do link: devolve o que aconteceu, e o campo diz o erro. */
  onAbrirDoCampo(codigo: string): Promise<ResultadoDoNavegador>;
  /** O "Abrir no navegador" da reunião de outra empresa: sem o passe. */
  onAbrirComoConvidado(codigo: string): void;
}

interface LinhaProps extends Pick<Props, 'onCopiar' | 'onCancelar' | 'onAbrirDaLinha'> {
  reuniao: Reuniao;
  agora: number;
  copiado: boolean;
  /** No tamanho Mínimo, a linha só tem o botão do menu, e o "Copiar link" é o primeiro item dele. */
  minimo: boolean;
}

function Linha({ reuniao, agora, copiado, minimo, onCopiar, onCancelar, onAbrirDaLinha }: LinhaProps) {
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
                <button
                  type="button"
                  role="menuitem"
                  class="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onAbrirDaLinha(reuniao.codigo);
                    mais.current?.focus();
                  }}
                >
                  <IconAbrirNoNavegador size="sm" />
                  {ABRIR_NO_NAVEGADOR}
                </button>
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

interface CampoProps extends Pick<Props, 'base' | 'onAbrirDoCampo' | 'onAbrirComoConvidado'> {}

/** O campo do link de uma reunião, no alto da lista. */
function CampoDoLink({ base, onAbrirDoCampo, onAbrirComoConvidado }: CampoProps) {
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** O código da reunião de outra empresa: o botão do erro a abre como convidado. */
  const [convidado, setConvidado] = useState<string | null>(null);
  const viva = useRef(true);
  useLayoutEffect(
    () => () => {
      viva.current = false;
    },
    [],
  );

  const digitou = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    setTexto(e.currentTarget.value);
    setErro(null);
    setConvidado(null);
  };
  const abrir = async () => {
    if (ocupado) return;
    const codigo = codigoDoTexto(texto, base);
    if (codigo === null) {
      if (texto.trim() !== '') setErro(NAO_E_LINK_DE_REUNIAO);
      return;
    }
    setErro(null);
    setConvidado(null);
    setOcupado(true);
    const r = await onAbrirDoCampo(codigo);
    if (!viva.current) return;
    setOcupado(false);
    if (r.ok) {
      setTexto('');
    } else {
      setErro(r.erro);
      setConvidado(r.outraEmpresa ? codigo : null);
    }
  };
  const comoConvidado = () => {
    if (convidado === null) return;
    onAbrirComoConvidado(convidado);
    setTexto('');
    setErro(null);
    setConvidado(null);
  };

  return (
    <form
      class="reun-link"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void abrir();
      }}
    >
      <div class="reun-link-linha">
        <label class="reun-link-campo">
          <IconLink size="sm" />
          <input
            type="text"
            class="reun-link-input"
            aria-label={ENTRAR_COM_O_LINK}
            placeholder={CAMPO_DO_LINK}
            autocomplete="off"
            spellcheck={false}
            value={texto}
            onInput={digitou}
          />
        </label>
        {texto.trim() !== '' && convidado === null && (
          <button type="submit" class="btn btn-cyan reun-link-abrir" disabled={ocupado}>
            {ABRIR_NO_NAVEGADOR}
          </button>
        )}
      </div>
      {erro !== null && (
        <p class="reun-link-erro" role="alert">
          {erro}
        </p>
      )}
      {convidado !== null && (
        <button type="button" class="btn btn-cyan reun-link-abrir" onClick={comoConvidado}>
          {ABRIR_NO_NAVEGADOR}
        </button>
      )}
    </form>
  );
}

export function Aba({
  vista,
  onNova,
  onCopiar,
  onCancelar,
  base,
  onAbrirDaLinha,
  onAbrirDoCampo,
  onAbrirComoConvidado,
}: Props) {
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
      {conectado && (
        <CampoDoLink base={base} onAbrirDoCampo={onAbrirDoCampo} onAbrirComoConvidado={onAbrirComoConvidado} />
      )}
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
                onAbrirDaLinha={onAbrirDaLinha}
              />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
