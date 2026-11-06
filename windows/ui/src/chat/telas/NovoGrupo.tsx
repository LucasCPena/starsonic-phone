// O novo grupo (o quadro NovoGrupo), no lugar das abas: "Chat" em cima do título e o Voltar; o "Nome do grupo" (até 60
// caracteres, contados como o servidor conta), a escolha das pessoas (o Escolher) e o "Criar grupo com N pessoas"
// (contando quem cria), desligado sem um nome ou sem uma pessoa ("Criar grupo" sem ninguém). O grupo tem até 200
// pessoas: a escolha para em 199. Criado, a conversa dele abre (ela já está na lista). Sem conexão, a faixa.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../../components/BackBar';
import { limitCharacters } from '../../format';
import { IconSemRede } from '../../icons';
import type { ChatCliente, VistaChat } from '../cliente';
import { Faixa } from '../componentes/Faixa';
import {
  CHAT,
  CRIAR_GRUPO,
  criarGrupoCom,
  NENHUM_COLEGA_NO_CHAT,
  NOME_DO_GRUPO,
  NOVO_GRUPO,
  O_GRUPO_JA_TEM_200,
  SEM_CONEXAO_TENTANDO,
} from '../textos';
import { useAcao, useLeitura } from '../usarChat';
import { Escolher, MAX_DO_GRUPO, useEscolha } from './Escolher';

/** O nome de um grupo tem até 60 caracteres (docs/chat-protocolo.md, seção 3). */
const MAX_NOME = 60;
/** Os caracteres de controle (um tab colado) não valem no nome: o servidor recusaria o grupo. */
const CONTROLE = /\p{Cc}/gu;

interface Props {
  vista: VistaChat;
  cliente: ChatCliente;
  /** O toast da falha de um pedido (R31). */
  avisar(texto: string): void;
  onVoltar(): void;
  /** Abre a conversa do grupo criado (ela já está na lista). */
  onAbrir(conversa: number): void;
}

export function NovoGrupo({ vista, cliente, avisar, onVoltar, onAbrir }: Props) {
  const colegas = useLeitura(vista, () => cliente.colegas(), [cliente], avisar);
  // Quem cria entra no grupo: as escolhidas vão até 199.
  const { escolhidas, marcar, naOrdem } = useEscolha(colegas.dados, MAX_DO_GRUPO - 1);
  const { emCurso, fazer } = useAcao(avisar);
  const [nome, setNome] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    campo.current?.focus();
  }, []);
  const pronto = nome.trim() !== '' && naOrdem.length > 0;
  const criar = () =>
    fazer(
      () => cliente.criarGrupo(nome.trim(), naOrdem),
      onAbrir,
      (e) => {
        if (e.erro === 'grupoCheio') avisar(O_GRUPO_JA_TEM_200);
        // Uma pessoa escolhida saiu do chat nesse meio (o 404, ou o 400 das pessoas): os colegas de novo, sem ela.
        else if (e.status === 400 || e.status === 404) colegas.reler();
      },
    );

  return (
    <>
      <BackBar title={NOVO_GRUPO} eyebrow={CHAT} onBack={onVoltar} />
      {!vista.conectado && <Faixa icone={<IconSemRede size="sm" />}>{SEM_CONEXAO_TENTANDO}</Faixa>}
      <div class="chat-fundo">
        <div class="body chat-escolha">
          <div class="field">
            <label class="label" for="novo-grupo-nome">
              {NOME_DO_GRUPO}
            </label>
            <input
              ref={campo}
              id="novo-grupo-nome"
              class="input chat-nome-do-grupo"
              autocomplete="off"
              spellcheck={false}
              value={nome}
              onInput={(e) => {
                const el = e.currentTarget;
                const cabe = limitCharacters(el.value.replace(CONTROLE, ''), MAX_NOME);
                // No limite, o que passa sai também do campo (o estado igual não desenharia de novo).
                if (cabe !== el.value) el.value = cabe;
                setNome(cabe);
              }}
            />
          </div>
          <Escolher pessoas={colegas.dados} escolhidas={escolhidas} max={MAX_DO_GRUPO - 1} vazia={NENHUM_COLEGA_NO_CHAT} onMarcar={marcar} />
          <button type="button" class="btn btn-cyan chat-confirmar" disabled={!pronto || emCurso} onClick={criar}>
            {naOrdem.length > 0 ? criarGrupoCom(naOrdem.length + 1) : CRIAR_GRUPO}
          </button>
        </div>
      </div>
    </>
  );
}
