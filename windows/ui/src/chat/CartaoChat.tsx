// O cartão Chat da área do administrador (o quadro AdmChat), antes dos botões da tela principal. Fora do chat: o texto,
// o "Código da empresa" e o "Ligar ao chat", desligado enquanto espera a resposta do servidor, com o erro embaixo do
// campo. Ligado: "Ligado ao chat da <empresa>. A aba Chat já aparece no app." e o "Desligar do chat". Na situação `fora`
// (o servidor não aceita mais a chave), o campo do código de novo, junto com o "Desligar do chat".
import { useRef, useState } from 'preact/hooks';
import { IconAlert, IconCheck } from '../icons';
import type { ChatSummary } from '../state';
import { ErroChat } from './api';
import type { ChatCliente } from './cliente';
import {
  A_ABA_CHAT_JA_APARECE,
  CHAT,
  CODIGO_DA_EMPRESA,
  CODIGO_NAO_ENCONTRADO,
  DESLIGAR_DO_CHAT,
  LIGA_ESTE_COMPUTADOR,
  LIGADO_AO_CHAT_DA,
  LIGAR_AO_CHAT,
  muitasTentativas,
  SEM_CONEXAO_TENTE,
} from './textos';
import { useVistaChat } from './usarChat';

interface Props {
  resumo: ChatSummary;
  cliente: ChatCliente;
}

/** O erro do Ligar ao chat; `doCodigo`: o código não existe (o campo fica inválido). */
function erroDoLigar(e: unknown): { texto: string; doCodigo: boolean } {
  if (e instanceof ErroChat && e.status === 404 && e.erro === 'codigo') return { texto: CODIGO_NAO_ENCONTRADO, doCodigo: true };
  if (e instanceof ErroChat && e.status === 429) return { texto: muitasTentativas(e.esperarSegundos ?? 60), doCodigo: false };
  return { texto: SEM_CONEXAO_TENTE, doCodigo: false };
}

export function CartaoChat({ resumo, cliente }: Props) {
  const { situacao } = useVistaChat(cliente);
  const [codigo, setCodigo] = useState('');
  const [esperando, setEsperando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; doCodigo: boolean } | null>(null);
  const [desligando, setDesligando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  // O pedido em curso, também para um segundo Enter antes de o botão ser desenhado desligado: um código, um computador.
  const emCurso = useRef(false);
  const fora = situacao === 'fora';

  const ligar = async (e: Event) => {
    e.preventDefault();
    if (emCurso.current || !codigo.trim()) return;
    emCurso.current = true;
    setEsperando(true);
    setErro(null);
    try {
      await cliente.ligarComputador(codigo);
      setCodigo('');
    } catch (falha) {
      setErro(erroDoLigar(falha));
      // O botão desligado perdeu o foco: ele volta ao campo, para corrigir o código (e não se a pessoa o levou a outro lugar).
      if (!document.activeElement || document.activeElement === document.body) campo.current?.focus();
    } finally {
      emCurso.current = false;
      setEsperando(false);
    }
  };

  const desligar = async () => {
    setDesligando(true);
    try {
      await cliente.desligarComputador();
    } finally {
      setDesligando(false);
    }
  };

  return (
    <>
      <h2 class="eyebrow">{CHAT}</h2>
      <div class="card adm-chat">
        {(!resumo.ligado || fora) && (
          <form class="adm-chat-form" onSubmit={ligar}>
            <p class="adm-chat-texto">{LIGA_ESTE_COMPUTADOR}</p>
            <div class="field">
              <label class="label" for="adm-chat-codigo">
                {CODIGO_DA_EMPRESA}
              </label>
              <input
                ref={campo}
                id="adm-chat-codigo"
                class="input adm-chat-codigo"
                autocomplete="off"
                spellcheck={false}
                autocapitalize="characters"
                value={codigo}
                aria-invalid={erro?.doCodigo ? 'true' : undefined}
                aria-describedby={erro ? 'adm-chat-erro' : undefined}
                onInput={(e) => {
                  setCodigo(e.currentTarget.value);
                  setErro(null);
                }}
              />
              {erro && (
                <p class="field-error" id="adm-chat-erro" role="alert">
                  <IconAlert size="sm" />
                  <span>{erro.texto}</span>
                </p>
              )}
            </div>
            <button type="submit" class="btn btn-cyan mini adm-chat-botao" disabled={esperando || !codigo.trim()}>
              {LIGAR_AO_CHAT}
            </button>
          </form>
        )}
        {resumo.ligado && !fora && (
          <p class="adm-chat-ligado" role="status">
            <IconCheck size="sm" />
            <span>
              {LIGADO_AO_CHAT_DA}
              <strong>{resumo.empresa}</strong>
              {A_ABA_CHAT_JA_APARECE}
            </span>
          </p>
        )}
        {resumo.ligado && (
          <button type="button" class="btn btn-outline mini adm-chat-botao" disabled={desligando} onClick={desligar}>
            {DESLIGAR_DO_CHAT}
          </button>
        )}
      </div>
    </>
  );
}
