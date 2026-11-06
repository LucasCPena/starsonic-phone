// A nova conversa (o quadro NovaConversa), no lugar das abas: "Chat" em cima do título e a seta de volta para a lista; a
// busca (o nome sem acento e sem caixa, ou o ramal), o "Novo grupo" e os colegas que já usam o chat, com as iniciais, o
// nome e o ramal; embaixo, "Aparecem só os colegas da sua empresa que já usam o chat.". Um colega abre a conversa a
// dois com ele (a que já existe, ou uma nova). Sem nenhum colega, "Nenhum colega no chat ainda."; a busca sem
// resultado, "Ninguém encontrado.". Sem conexão, a faixa. Os nomes vão sempre como texto.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../../components/BackBar';
import { IconNovoGrupo, IconSearch, IconSemRede } from '../../icons';
import type { ChatCliente, VistaChat } from '../cliente';
import { Avatar } from '../componentes/Avatar';
import { Faixa } from '../componentes/Faixa';
import { pessoasDaBusca } from '../formato';
import {
  APARECEM_SO_OS_COLEGAS,
  CHAT,
  COLEGAS_NO_CHAT,
  NENHUM_COLEGA_NO_CHAT,
  NINGUEM_ENCONTRADO,
  nomeDaPessoa,
  NOVA_CONVERSA,
  NOVO_GRUPO,
  PROCURAR_PELO_NOME_OU_PELO_RAMAL,
  PROCURAR_UM_COLEGA,
  ramalN,
  SEM_CONEXAO_TENTANDO,
  VOLTAR_PARA_AS_CONVERSAS,
} from '../textos';
import { useAcao, useLeitura } from '../usarChat';

const ID_DO_TITULO = 'colegas-titulo';

interface Props {
  vista: VistaChat;
  cliente: ChatCliente;
  /** O toast da falha de um pedido (R31). */
  avisar(texto: string): void;
  onVoltar(): void;
  onNovoGrupo(): void;
  /** Abre a conversa (ela já está na lista). */
  onAbrir(conversa: number): void;
}

export function NovaConversa({ vista, cliente, avisar, onVoltar, onNovoGrupo, onAbrir }: Props) {
  const colegas = useLeitura(vista, () => cliente.colegas(), [cliente], avisar);
  const { fazer } = useAcao(avisar);
  const [busca, setBusca] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    campo.current?.focus();
  }, []);
  const lista = colegas.dados;
  const achados = lista === null ? [] : pessoasDaBusca(lista, busca);
  const abrir = (com: number) =>
    fazer(
      () => cliente.criarDupla(com),
      onAbrir,
      (e) => {
        // O colega saiu do chat nesse meio (o 400 do `com`, ou o 404): os colegas de novo, sem ele.
        if (e.status === 400 || e.status === 404) colegas.reler();
      },
    );

  return (
    <>
      <BackBar title={NOVA_CONVERSA} eyebrow={CHAT} voltar={VOLTAR_PARA_AS_CONVERSAS} onBack={onVoltar} />
      {!vista.conectado && <Faixa icone={<IconSemRede size="sm" />}>{SEM_CONEXAO_TENTANDO}</Faixa>}
      <div class="body chat-nova">
        <label class="chat-busca">
          <IconSearch size="sm" />
          <input
            ref={campo}
            type="search"
            aria-label={PROCURAR_UM_COLEGA}
            placeholder={PROCURAR_PELO_NOME_OU_PELO_RAMAL}
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
        <button type="button" class="chat-novo-grupo" onClick={onNovoGrupo}>
          <span class="chat-novo-grupo-tile" aria-hidden="true">
            <IconNovoGrupo />
          </span>
          {NOVO_GRUPO}
        </button>
        <h2 id={ID_DO_TITULO} class="chat-subtitulo">
          {COLEGAS_NO_CHAT}
        </h2>
        <div class="chat-colegas scroll">
          {lista !== null &&
            (achados.length === 0 ? (
              <p class="empty">{lista.length === 0 ? NENHUM_COLEGA_NO_CHAT : NINGUEM_ENCONTRADO}</p>
            ) : (
              <ul class="chat-pessoas" aria-labelledby={ID_DO_TITULO}>
                {achados.map((p) => (
                  <li key={p.id}>
                    <button type="button" class="chat-pessoa" onClick={() => abrir(p.id)}>
                      <Avatar pessoa={p} />
                      <span class="chat-pessoa-textos">
                        <span class="chat-pessoa-nome">{nomeDaPessoa(p)}</span>
                        <span class="chat-pessoa-sub">{ramalN(p.ramal)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
        <p class="chat-nota">{APARECEM_SO_OS_COLEGAS}</p>
      </div>
    </>
  );
}
