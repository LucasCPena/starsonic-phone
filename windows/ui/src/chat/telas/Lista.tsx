// A aba Chat (os quadros Main e Vazio): o título, o "+" (Nova conversa e Novo grupo), "Procurar conversa" (pelo nome,
// sem acento e sem caixa) e as conversas, a mais nova primeiro: o avatar, o nome, a hora, a prévia da última mensagem e
// as não lidas. Sem nenhuma conversa, a primeira vez ("Nenhuma conversa ainda" e "Começar uma conversa"). Sem conexão,
// a faixa "Sem conexão com o chat. Tentando de novo…" (um `status`); o computador novo da mesma pessoa, a faixa com o
// "×". A conta que nunca se conectou aqui e o computador que saiu do chat mostram o texto deles no lugar da lista. Os
// nomes e as mensagens vão sempre como texto.
import { useRef, useState } from 'preact/hooks';
import { Menu } from '../../components/Menu';
import { fold } from '../../format';
import { IconMessage, IconNovoGrupo, IconPlus, IconSearch, IconSemRede } from '../../icons';
import type { VistaChat } from '../cliente';
import { Avatar } from '../componentes/Avatar';
import { Faixa } from '../componentes/Faixa';
import { horaDaLista, nomeDaConversa, nomeParaBusca, previa } from '../formato';
import {
  CHAT,
  COMECAR_UMA_CONVERSA,
  COMPUTADOR_SAIU,
  CONECTE_A_SUA_CONTA,
  CONVERSE_COM_OS_COLEGAS,
  mensagensNaoLidas,
  NENHUMA_CONVERSA_AINDA,
  NENHUMA_CONVERSA_ENCONTRADA,
  NOVA_CONVERSA,
  NOVA_CONVERSA_OU_NOVO_GRUPO,
  NOVO_GRUPO,
  PROCURAR_CONVERSA,
  SEM_CONEXAO_TENTANDO,
  SEU_CHAT_ENTROU_EM,
} from '../textos';
import type { Conversa } from '../tipos';

interface Props {
  vista: VistaChat;
  onNovaConversa(): void;
  onNovoGrupo(): void;
  onAbrir(conversa: number): void;
  /** O "×" da faixa do computador novo. */
  onFecharAviso(): void;
}

function Linha({ conversa, euId, agora, onAbrir }: { conversa: Conversa; euId: number; agora: number; onAbrir(conversa: number): void }) {
  const naoLidas = conversa.naoLidas;
  return (
    <li>
      <button type="button" class={naoLidas > 0 ? 'chat-linha chat-linha-nova' : 'chat-linha'} onClick={() => onAbrir(conversa.id)}>
        <Avatar conversa={conversa} />
        <span class="chat-textos">
          <span class="chat-linha-cima">
            <span class="chat-nome">{nomeDaConversa(conversa)}</span>
            <span class="chat-hora">{horaDaLista(conversa.atualizadaEm, agora)}</span>
          </span>
          <span class="chat-linha-baixo">
            <span class="chat-previa">{previa(conversa, euId)}</span>
            {naoLidas > 0 && (
              <>
                <span class="chat-numero" aria-hidden="true">
                  {naoLidas}
                </span>
                <span class="sr-only">{mensagensNaoLidas(naoLidas)}</span>
              </>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export function Lista({ vista, onNovaConversa, onNovoGrupo, onAbrir, onFecharAviso }: Props) {
  const [busca, setBusca] = useState('');
  const [menu, setMenu] = useState(false);
  const mais = useRef<HTMLButtonElement>(null);
  const { situacao, conversas } = vista;
  // A pessoa entrando ou já dentro: a faixa, o "+" e a lista.
  const ativa = situacao === 'entrando' || situacao === 'pronto';
  const termo = fold(busca.trim());
  const achadas = termo ? conversas.filter((c) => nomeParaBusca(c).includes(termo)) : conversas;
  const agora = Date.now();
  const euId = vista.eu?.id ?? 0;
  const escolher = (acao: () => void) => {
    setMenu(false);
    acao();
  };

  return (
    <>
      {ativa && !vista.conectado && <Faixa icone={<IconSemRede size="sm" />}>{SEM_CONEXAO_TENTANDO}</Faixa>}
      {ativa && vista.computadorNovo !== null && (
        <Faixa onFechar={onFecharAviso}>
          {SEU_CHAT_ENTROU_EM}
          {/* O nome numa caixa só: a linha quebra antes dele, e não no meio (um nome comprido quebra dentro dela). */}
          <span class="faixa-nome">{vista.computadorNovo}</span>
        </Faixa>
      )}
      <div class="body scroll chat">
        <div class="chat-topo">
          <h1 class="chat-titulo">{CHAT}</h1>
          {ativa && (
            <div class="menu-wrap">
              <button
                ref={mais}
                type="button"
                class="chat-mais"
                aria-label={NOVA_CONVERSA_OU_NOVO_GRUPO}
                title={NOVA_CONVERSA_OU_NOVO_GRUPO}
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <IconPlus />
              </button>
              {menu && (
                <Menu label={NOVA_CONVERSA_OU_NOVO_GRUPO} anchor={mais} onClose={() => setMenu(false)} class="popover-menu chat-menu">
                  <button type="button" role="menuitem" class="menuitem" onClick={() => escolher(onNovaConversa)}>
                    <IconMessage size="sm" />
                    {NOVA_CONVERSA}
                  </button>
                  <button type="button" role="menuitem" class="menuitem" onClick={() => escolher(onNovoGrupo)}>
                    <IconNovoGrupo size="sm" />
                    {NOVO_GRUPO}
                  </button>
                </Menu>
              )}
            </div>
          )}
        </div>
        {(situacao === 'precisaConta' || situacao === 'fora') && (
          <div class="chat-vazio">
            <span class="chat-vazio-tile" aria-hidden="true">
              <IconMessage />
            </span>
            <p class="chat-vazio-texto">{situacao === 'fora' ? COMPUTADOR_SAIU : CONECTE_A_SUA_CONTA}</p>
          </div>
        )}
        {situacao === 'pronto' && conversas.length === 0 && (
          <div class="chat-vazio">
            <span class="chat-vazio-tile" aria-hidden="true">
              <IconMessage />
            </span>
            <h2 class="chat-vazio-titulo">{NENHUMA_CONVERSA_AINDA}</h2>
            <p class="chat-vazio-texto">{CONVERSE_COM_OS_COLEGAS}</p>
            <button type="button" class="btn btn-cyan chat-comecar" onClick={onNovaConversa}>
              {COMECAR_UMA_CONVERSA}
            </button>
          </div>
        )}
        {situacao === 'pronto' && conversas.length > 0 && (
          <>
            <label class="chat-busca">
              <IconSearch size="sm" />
              <input
                type="search"
                aria-label={PROCURAR_CONVERSA}
                placeholder={PROCURAR_CONVERSA}
                autocomplete="off"
                spellcheck={false}
                value={busca}
                onInput={(e) => setBusca(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && busca) {
                    e.stopPropagation();
                    setBusca('');
                  }
                }}
              />
            </label>
            {achadas.length === 0 ? (
              <p class="empty">{NENHUMA_CONVERSA_ENCONTRADA}</p>
            ) : (
              <ul class="chat-lista">
                {achadas.map((c) => (
                  <Linha key={c.id} conversa={c} euId={euId} agora={agora} onAbrir={onAbrir} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}
