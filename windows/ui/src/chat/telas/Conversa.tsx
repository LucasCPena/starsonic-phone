// A conversa (os quadros Conversa, Grupo, SemConexao e ConversaEscura), no lugar das abas de baixo. No alto, a seta para
// a lista e, na conversa a dois, o avatar, o nome, "Ramal N" e o Ligar (que liga para o ramal como o Ligar de um
// contato); no grupo, o ícone, o nome e "N pessoas · ver os membros", que leva aos Membros. Sem conexão, a faixa. No
// meio, o `log` das mensagens: o separador do dia (o dayGroup), os balões com a hora (o clockTime) e os avisos de grupo
// no meio. Embaixo, o Escrever, ou "<Nome> saiu do chat." na conversa a dois com quem saiu (e sem o Ligar).
// - A tela abre a conversa no cliente ao montar e fecha ao sair: o que chega de outra abertura nunca pinta aqui.
// - A rolagem: a conversa abre embaixo; uma mensagem nova só puxa a tela quando ela está a até 80 px do fim (a minha,
//   sempre); as anteriores chegam quando o alto da lista aparece (o IntersectionObserver), e a primeira mensagem que
//   estava carregada fica no mesmo lugar da tela.
// - O leitor de tela: o log fica `aria-busy` por 1 s desde a renderização que põe uma página (para não ler a página
//   inteira), e cada balão diz quem mandou.
// Os nomes e as mensagens vão sempre como texto.
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { dayGroup } from '../../format';
import { IconBack, IconPhone, IconSemRede } from '../../icons';
import type { Send } from '../../types';
import type { ChatCliente, ConversaAberta, VistaChat } from '../cliente';
import { Avatar } from '../componentes/Avatar';
import { Balao } from '../componentes/Balao';
import { Escrever } from '../componentes/Escrever';
import { Faixa } from '../componentes/Faixa';
import type { Pendente } from '../envios';
import { nomeDaConversa } from '../formato';
import {
  ESCREVA_PARA_O_GRUPO,
  ESCREVA_UMA_MENSAGEM,
  ligarPara,
  mensagemPara,
  mensagemParaOGrupo,
  mensagensCom,
  mensagensDoGrupo,
  pessoasVerOsMembros,
  ramalN,
  saiuDoChat,
  SEM_CONEXAO_TENTANDO,
  textoDoAvisoDeGrupo,
  verOsMembrosDoGrupo,
  VOLTAR_PARA_AS_CONVERSAS,
} from '../textos';
import type { Conversa as ConversaDaLista, Mensagem } from '../tipos';

/** Uma mensagem nova só puxa a tela quando ela está a até 80 px do fim. */
const PERTO_DO_FIM_PX = 80;

interface Props {
  vista: VistaChat;
  /** A conversa, da lista: o nome e o ramal, ou o nome e as pessoas do grupo. */
  conversa: ConversaDaLista;
  cliente: ChatCliente;
  send: Send;
  onVoltar(): void;
  onMembros(): void;
}

type Item =
  | { tipo: 'dia'; chave: string; texto: string }
  | { tipo: 'aviso'; chave: string; texto: string }
  | { tipo: 'mensagem'; chave: string; mensagem: Mensagem; minha: boolean }
  | { tipo: 'pendente'; chave: string; pendente: Pendente };

/**
 * O que a lista mostra, na ordem: o separador antes da primeira de cada dia (o texto dele só é feito uma vez por dia);
 * os Pendentes no fim, como de hoje.
 */
function itensDa(aberta: ConversaAberta, euId: number, agora: number): Item[] {
  const itens: Item[] = [];
  let dia = Number.NaN;
  const separar = (ms: number, chave: string) => {
    const inicio = new Date(ms).setHours(0, 0, 0, 0);
    if (inicio === dia) return;
    dia = inicio;
    itens.push({ tipo: 'dia', chave, texto: dayGroup(ms, agora) });
  };
  for (const m of aberta.mensagens) {
    separar(m.criadaEm, `d${m.id}`);
    if (m.tipo === 'aviso') itens.push({ tipo: 'aviso', chave: `m${m.id}`, texto: m.aviso ? textoDoAvisoDeGrupo(m.aviso, euId) : '' });
    else itens.push({ tipo: 'mensagem', chave: `m${m.id}`, mensagem: m, minha: m.autor?.id === euId });
  }
  if (aberta.pendentes.length > 0) separar(agora, 'dp');
  for (const p of aberta.pendentes) itens.push({ tipo: 'pendente', chave: `p${p.idLocal}`, pendente: p });
  return itens;
}

export function Conversa({ vista, conversa, cliente, send, onVoltar, onMembros }: Props) {
  const id = conversa.id;
  useLayoutEffect(() => {
    void cliente.abrir(id);
    return () => cliente.fechar();
  }, [cliente, id]);
  const aberta = vista.aberta?.id === id ? vista.aberta : null;
  const euId = vista.eu?.id ?? 0;
  const nome = nomeDaConversa(conversa);
  const itens = useMemo(() => (aberta ? itensDa(aberta, euId, Date.now()) : []), [aberta?.mensagens, aberta?.pendentes, euId]);

  const log = useRef<HTMLDivElement>(null);
  const alto = useRef<HTMLDivElement>(null);
  /** A altura do conteúdo no último desenho: com o scrollTop de agora, diz se a tela estava perto do fim. */
  const altura = useRef(0);
  /** A primeira mensagem carregada e onde ela estava: as anteriores entram em cima dela, e ela fica no lugar. */
  const ancora = useRef<{ chave: string; topo: number } | null>(null);
  /** O próximo desenho vai até o fim: a conversa que abre, e a minha mensagem. */
  const irAoFim = useRef(true);

  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const perto = irAoFim.current || altura.current - el.scrollTop - el.clientHeight <= PERTO_DO_FIM_PX;
    const a = ancora.current;
    const no = a && el.querySelector<HTMLElement>(`[data-chave="${a.chave}"]`);
    if (a && no && no.offsetTop !== a.topo) el.scrollTop += no.offsetTop - a.topo;
    if (perto) el.scrollTop = el.scrollHeight;
    const primeira = el.querySelector<HTMLElement>('[data-chave^="m"]');
    ancora.current = primeira ? { chave: primeira.dataset.chave!, topo: primeira.offsetTop } : null;
    altura.current = el.scrollHeight;
    if (itens.length > 0) irAoFim.current = false;
  }, [itens]);

  // O log que muda de tamanho (o campo que cresce, a faixa, a janela) e estava no fim continua no fim.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    let visivel = el.clientHeight;
    const observador = new ResizeObserver(() => {
      if (el.scrollHeight - el.scrollTop - visivel <= PERTO_DO_FIM_PX) el.scrollTop = el.scrollHeight;
      visivel = el.clientHeight;
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  // As anteriores quando o alto aparece: o observador nasce de novo a cada mudança (e na volta da conexão), e a primeira
  // resposta dele diz se o alto ainda está à vista.
  const temMaisAntigas = aberta?.temMaisAntigas === true;
  useLayoutEffect(() => {
    const el = log.current;
    const sentinela = alto.current;
    if (!el || !sentinela || !temMaisAntigas) return;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) void cliente.anteriores();
      },
      { root: el },
    );
    observador.observe(sentinela);
    return () => observador.disconnect();
  }, [cliente, temMaisAntigas, itens, vista.conectado]);

  const enviar = (texto: string) => {
    irAoFim.current = true;
    cliente.enviarTexto(texto);
  };
  const tentarDeNovo = (idLocal: string) => cliente.tentarDeNovo(idLocal);

  const grupo = conversa.tipo === 'grupo';
  const saiu = conversa.tipo === 'dupla' && conversa.com.saiu;
  return (
    <div class="conversa">
      <div class="conversa-topo">
        <button type="button" class="icon-btn" aria-label={VOLTAR_PARA_AS_CONVERSAS} title={VOLTAR_PARA_AS_CONVERSAS} onClick={onVoltar}>
          <IconBack />
        </button>
        {conversa.tipo === 'grupo' ? (
          <>
            <h1 class="sr-only">{conversa.nome}</h1>
            <button
              type="button"
              class="conversa-grupo"
              aria-label={verOsMembrosDoGrupo(conversa.nome)}
              title={verOsMembrosDoGrupo(conversa.nome)}
              onClick={onMembros}
            >
              <Avatar conversa={conversa} />
              <span class="conversa-titulos">
                <span class="conversa-nome">{conversa.nome}</span>
                <span class="conversa-sub">{pessoasVerOsMembros(conversa.pessoas)}</span>
              </span>
            </button>
          </>
        ) : (
          <>
            <Avatar conversa={conversa} />
            <div class="conversa-titulos">
              <h1 class="conversa-nome">{nome}</h1>
              <span class="conversa-sub">{ramalN(conversa.com.ramal)}</span>
            </div>
            {!saiu && (
              <button
                type="button"
                class="conversa-ligar"
                aria-label={ligarPara(conversa.com.nome, conversa.com.ramal)}
                title={ligarPara(conversa.com.nome, conversa.com.ramal)}
                onClick={() => send({ cmd: 'dial', numero: conversa.com.ramal, contato: true })}
              >
                <IconPhone size="sm" />
              </button>
            )}
          </>
        )}
      </div>
      {!vista.conectado && <Faixa icone={<IconSemRede size="sm" />}>{SEM_CONEXAO_TENTANDO}</Faixa>}
      {/* O log rola pelo teclado também (o tabIndex): a lista pode não ter nenhum botão. */}
      <div
        ref={log}
        class="conversa-log"
        role="log"
        tabIndex={0}
        aria-label={grupo ? mensagensDoGrupo(nome) : mensagensCom(nome)}
        aria-busy={aberta?.ocupada ? 'true' : 'false'}
      >
        <div ref={alto} class="conversa-alto" aria-hidden="true" />
        {itens.map((item) => {
          switch (item.tipo) {
            case 'dia':
              return (
                <p key={item.chave} class="conversa-dia">
                  {item.texto}
                </p>
              );
            case 'aviso':
              return (
                <p key={item.chave} class="conversa-aviso" data-chave={item.chave}>
                  {item.texto}
                </p>
              );
            case 'mensagem':
              return <Balao key={item.chave} chave={item.chave} mensagem={item.mensagem} minha={item.minha} comAutor={grupo && !item.minha} />;
            case 'pendente':
              return <Balao key={item.chave} chave={item.chave} pendente={item.pendente} onTentarDeNovo={tentarDeNovo} />;
          }
        })}
      </div>
      {saiu ? (
        <p class="conversa-saiu">{saiuDoChat(conversa.com.nome)}</p>
      ) : (
        <Escrever
          rotulo={grupo ? mensagemParaOGrupo(nome) : mensagemPara(nome)}
          placeholder={grupo ? ESCREVA_PARA_O_GRUPO : ESCREVA_UMA_MENSAGEM}
          onEnviar={enviar}
        />
      )}
    </div>
  );
}
