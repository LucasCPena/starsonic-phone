// Os membros do grupo (o quadro Membros), abertos pelo cabeçalho da conversa: o nome do grupo em cima do título e a seta
// de volta para a conversa. Para quem cuida, "Você cuida deste grupo: …"; o cartão "N pessoas", com cada membro (as
// iniciais, o nome, o meu com " (você)", e "Ramal N · criou o grupo", "Ramal N · cuida do grupo" ou "Ramal N") e, para
// quem cuida, o Tirar ao lado de cada outro membro; o "Pôr pessoas no grupo" (quem cuida) e o "Sair do grupo" (todos).
// - O Tirar e o Sair perguntam antes (o Confirm). Enquanto uma ação vai, os botões delas ficam desligados: nenhum aceita
//   um clique que não faria nada. Fechada a pergunta e acabada a ação, o foco volta ao botão que a abriu (e, se a linha
//   dele saiu, ao título do cartão).
// - A lista se lê de novo quando o grupo muda na lista (o evento conversa com as pessoas ou o cuida mudados: quem passa
//   a cuidar vê o Tirar e o Pôr pessoas sem fechar a tela, R27), depois do Tirar e num 403 (R31). O grupo que sai da
//   lista (o sair, o conversaSaiu) leva a tela para a lista (main.tsx, R26).
// Os nomes vão sempre como texto.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../../components/BackBar';
import { Confirm } from '../../components/Confirm';
import { IconPlus, IconSemRede } from '../../icons';
import type { ChatCliente, VistaChat } from '../cliente';
import { Avatar } from '../componentes/Avatar';
import { Faixa } from '../componentes/Faixa';
import {
  deixaDeVer,
  linhaDoMembro,
  MEMBROS_DO_GRUPO,
  nomeDaPessoa,
  nomeDoMembro,
  nPessoas,
  PARA_VOLTAR,
  POR_PESSOAS_NO_GRUPO,
  SAIR_DO_GRUPO,
  SAIR_DO_GRUPO_PERGUNTA,
  SEM_CONEXAO_TENTANDO,
  TIRAR,
  tirarDoGrupo,
  tirarDoGrupoPergunta,
  VOCE_CUIDA_DESTE_GRUPO,
  VOLTAR_PARA_A_CONVERSA,
} from '../textos';
import type { Conversa, Pessoa } from '../tipos';
import { useAcao, useLeitura } from '../usarChat';

const ID_DO_TITULO = 'membros-titulo';

interface Props {
  vista: VistaChat;
  /** O grupo, da lista (o nome, as pessoas e o cuida dele). */
  conversa: Extract<Conversa, { tipo: 'grupo' }>;
  cliente: ChatCliente;
  /** O toast da falha de um pedido (R31). */
  avisar(texto: string): void;
  onVoltar(): void;
  onPorPessoas(): void;
}

export function Membros({ vista, conversa, cliente, avisar, onVoltar, onPorPessoas }: Props) {
  const id = conversa.id;
  const lidos = useLeitura(vista, () => cliente.membros(id), [cliente, id, conversa.pessoas, conversa.cuida], avisar);
  const { emCurso, fazer } = useAcao(avisar);
  const membros = lidos.dados;
  const euId = vista.eu?.id ?? 0;
  const cuido = membros?.some((m) => m.cuida && m.pessoa.id === euId) === true;
  const [pergunta, setPergunta] = useState<{ tirar: Pessoa } | 'sair' | null>(null);
  /** O botão que abriu a pergunta: o foco volta a ele quando ela fecha. */
  const abriu = useRef<HTMLElement | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  /** Um Tirar deu certo: a linha dele (e o botão com o foco) sai na próxima lista. */
  const tirou = useRef(false);

  const perguntar = (q: { tirar: Pessoa } | 'sair', botao: HTMLElement) => {
    abriu.current = botao;
    setPergunta(q);
  };
  // O botão desligado durante a ação não fica com o foco: ele volta quando ela acaba, se ainda não foi para outro lugar.
  useEffect(() => {
    const botao = abriu.current;
    if (pergunta !== null || emCurso || !botao) return;
    abriu.current = null;
    if (botao.isConnected && document.activeElement === document.body) botao.focus();
  }, [pergunta, emCurso]);
  // O Tirar que tinha o foco saiu com a linha dele: o foco vai ao título do cartão ("2 pessoas").
  useEffect(() => {
    if (!tirou.current) return;
    tirou.current = false;
    if (document.activeElement === document.body) titulo.current?.focus();
  }, [membros]);

  const tirar = (p: Pessoa) => {
    setPergunta(null);
    fazer(
      () => cliente.tirar(id, p.id),
      () => {
        tirou.current = true;
        lidos.reler();
      },
      lidos.reler,
    );
  };
  const sair = () => {
    setPergunta(null);
    // Saiu: o grupo sai da lista, e a tela volta para ela (R26).
    fazer(() => cliente.sair(id), () => undefined, lidos.reler);
  };

  return (
    <>
      <BackBar title={MEMBROS_DO_GRUPO} eyebrow={conversa.nome} voltar={VOLTAR_PARA_A_CONVERSA} onBack={onVoltar} focarTitulo />
      {!vista.conectado && <Faixa icone={<IconSemRede size="sm" />}>{SEM_CONEXAO_TENTANDO}</Faixa>}
      <div class="chat-fundo">
        <div class="body scroll membros">
          {cuido && <p class="membros-texto">{VOCE_CUIDA_DESTE_GRUPO}</p>}
          {membros && (
            <div class="membros-cartao">
              <h2 ref={titulo} id={ID_DO_TITULO} class="chat-subtitulo" tabIndex={-1}>
                {nPessoas(membros.length)}
              </h2>
              {/* A lista rola pelo teclado também (o tabIndex): para quem não cuida, ela não tem nenhum botão. */}
              <ul class="chat-pessoas membros-lista" aria-labelledby={ID_DO_TITULO} tabIndex={0}>
                {membros.map((m) => (
                  <li key={m.pessoa.id} class="chat-pessoa">
                    <Avatar pessoa={m.pessoa} />
                    <span class="chat-pessoa-textos">
                      <span class="chat-pessoa-nome">{nomeDoMembro(m.pessoa, euId)}</span>
                      <span class="chat-pessoa-sub">{linhaDoMembro(m)}</span>
                    </span>
                    {cuido && m.pessoa.id !== euId && (
                      <button
                        type="button"
                        class="membros-tirar"
                        aria-label={tirarDoGrupo(nomeDaPessoa(m.pessoa))}
                        disabled={emCurso}
                        onClick={(e) => perguntar({ tirar: m.pessoa }, e.currentTarget)}
                      >
                        {TIRAR}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cuido && (
            <button type="button" class="membros-por" onClick={onPorPessoas}>
              <IconPlus size="sm" />
              {POR_PESSOAS_NO_GRUPO}
            </button>
          )}
          <div class="membros-espaco" />
          <button type="button" class="btn btn-outline membros-sair" disabled={emCurso} onClick={(e) => perguntar('sair', e.currentTarget)}>
            {SAIR_DO_GRUPO}
          </button>
        </div>
      </div>
      {pergunta === 'sair' && (
        <Confirm title={SAIR_DO_GRUPO_PERGUNTA} message={PARA_VOLTAR} confirmLabel={SAIR_DO_GRUPO} onCancel={() => setPergunta(null)} onConfirm={sair} />
      )}
      {pergunta !== null && pergunta !== 'sair' && (
        <Confirm
          title={tirarDoGrupoPergunta(nomeDaPessoa(pergunta.tirar))}
          message={deixaDeVer(nomeDaPessoa(pergunta.tirar))}
          confirmLabel={TIRAR}
          onCancel={() => setPergunta(null)}
          onConfirm={() => tirar(pergunta.tirar)}
        />
      )}
    </>
  );
}
