// Adicionar e Editar atalho (rc.3, spec 3.3): o nome (até 24 caracteres, contados como a loja do C++: um emoji conta
// um), o número (dígitos, *, # e +, até 32), o que o atalho faz (as quatro ações em cartões de rádio) e a chave "Mostrar
// se o ramal está livre" (o BLF do atalho). Num atalho novo, a chave segue o número enquanto a pessoa não mexe nela:
// ligada quando ele parece um ramal (só dígitos, de 2 a 6) e o administrador ligou o BLF. Sem o BLF do administrador,
// ela fica desativada (com o valor gravado), com a ajuda "O administrador não ligou o BLF".
// O nome em branco e o número vazio param aqui, com o texto da loja embaixo do campo. O resto o C++ confere de novo (a
// loja): a edição fica aberta até os atalhos do estado mudarem (gravou); recusado, o motivo vem num toast, nada muda e
// a edição fica com o que foi digitado. Esperando a resposta, o Salvar fica travado (um Enter duplo grava um só).
import { useEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';
import { limitCharacters, looksLikeExtension, trimAscii } from '../format';
import { IconAlert } from '../icons';
import type { Shortcut, ShortcutAction } from '../state';
import type { Send } from '../types';
import { MAX_ATALHOS, RemoverAtalho } from './Atalhos';

interface Props {
  /** Sem atalho: um novo. */
  atalho?: Shortcut;
  /** O "<n> de 8" do alto. */
  posicao: number;
  /** Os atalhos do estado (gravou quando eles mudam). */
  atalhos: Shortcut[];
  /** Quantos toasts chegaram (um a mais com a edição esperando: o C++ recusou). */
  toasts: number;
  /** O BLF nos atalhos do administrador (`admin.blf`). */
  blfDoAdmin: boolean;
  send: Send;
  onClose(): void;
}

const ACOES: Array<{ acao: ShortcutAction; titulo: string; ajuda: string }> = [
  { acao: 'ligar', titulo: 'Ligar', ajuda: 'Liga para o número.' },
  { acao: 'transferir', titulo: 'Transferir', ajuda: 'Durante a ligação, passa direto para o número.' },
  { acao: 'consulta', titulo: 'Transferir com consulta', ajuda: 'Fala antes com o número e depois passa a ligação.' },
  { acao: 'teclas', titulo: 'Enviar teclas', ajuda: 'Durante a ligação, digita o número (ex.: *88).' },
];

const MAX_NOME = 24;
const MAX_NUMERO = 32;
const FORA_DO_NUMERO = /[^0-9*#+]/g;
// Os textos da loja do C++ (os mesmos dos toasts dela).
const SEM_NOME = 'Digite o nome do atalho.';
const SEM_NUMERO = 'Digite o número do atalho.';

/** O que a loja grava de cada atalho (sem o `estado`: o BLF muda sozinho e não é a resposta do Salvar). */
function gravados(atalhos: Shortcut[]): string {
  return JSON.stringify(atalhos.map((a) => [a.id, a.nome, a.numero, a.acao, a.blf]));
}

export function AtalhoForm({ atalho, posicao, atalhos, toasts, blfDoAdmin, send, onClose }: Props) {
  const [nome, setNome] = useState(atalho?.nome ?? '');
  const [numero, setNumero] = useState(atalho?.numero ?? '');
  const [acao, setAcao] = useState<ShortcutAction>(atalho?.acao ?? 'ligar');
  // A chave escolhida pela pessoa (ou a gravada, na edição); null: ela segue o número.
  const [blfEscolhido, setBlfEscolhido] = useState<boolean | null>(atalho ? atalho.blf : null);
  const [remover, setRemover] = useState(false);
  const [erros, setErros] = useState<{ nome: string; numero: string }>({ nome: '', numero: '' });
  const [esperando, setEsperando] = useState(false);
  const campoNome = useRef<HTMLInputElement>(null);
  const campoNumero = useRef<HTMLInputElement>(null);
  const blf = blfEscolhido ?? (blfDoAdmin && looksLikeExtension(numero));

  // A resposta do C++: os atalhos gravados mudaram depois do Salvar (gravou: fecha) ou chegou um toast (recusou: o
  // Salvar volta a valer, com o que foi digitado).
  const agora = gravados(atalhos);
  const enviadoDe = useRef<string | null>(null);
  const aguardando = useRef(false);
  useEffect(() => {
    if (enviadoDe.current === null || enviadoDe.current === agora) return;
    enviadoDe.current = null;
    onClose();
  }, [agora]);
  const toastsVistos = useRef(toasts);
  useEffect(() => {
    if (toasts === toastsVistos.current) return;
    toastsVistos.current = toasts;
    if (!aguardando.current) return;
    aguardando.current = false;
    setEsperando(false);
  }, [toasts]);

  const salvar = (e: Event) => {
    e.preventDefault();
    if (aguardando.current) return;
    const faltaNome = nome.trim() === '';
    const faltaNumero = numero === '';
    if (faltaNome || faltaNumero) {
      setErros({ nome: faltaNome ? SEM_NOME : '', numero: faltaNumero ? SEM_NUMERO : '' });
      (faltaNome ? campoNome : campoNumero).current?.focus();
      return;
    }
    // Nada mudou: só fecha. Compara como a loja grava (o trimAscii); de outro jeito, um Salvar sem mudança esperaria
    // para sempre um estado que não muda.
    if (atalho && trimAscii(nome) === atalho.nome && numero === atalho.numero && acao === atalho.acao && blf === atalho.blf) {
      onClose();
      return;
    }
    enviadoDe.current = agora;
    aguardando.current = true;
    setEsperando(true);
    send({ cmd: 'saveShortcut', ...(atalho ? { id: atalho.id } : {}), nome, numero, acao, blf });
  };

  return (
    <>
      <BackBar title={atalho ? 'Editar atalho' : 'Adicionar atalho'} extra={`${posicao} de ${MAX_ATALHOS}`} onBack={onClose} />
      <form class="body form scroll atalho-form" onSubmit={salvar} noValidate>
        <div class="field">
          <label class="label" for="atalho-nome">
            Nome
          </label>
          <input
            ref={campoNome}
            id="atalho-nome"
            class="input"
            aria-required="true"
            autocomplete="off"
            value={nome}
            autofocus={!atalho}
            aria-invalid={erros.nome ? 'true' : undefined}
            aria-describedby={erros.nome ? 'atalho-nome-erro' : undefined}
            onInput={(e) => {
              const valor = limitCharacters(e.currentTarget.value, MAX_NOME);
              if (valor !== e.currentTarget.value) e.currentTarget.value = valor;
              setNome(valor);
              if (erros.nome) setErros({ ...erros, nome: '' });
            }}
          />
          {erros.nome && (
            <p class="field-error" id="atalho-nome-erro" role="alert">
              <IconAlert size="sm" />
              <span>{erros.nome}</span>
            </p>
          )}
        </div>
        <div class="field">
          <label class="label" for="atalho-numero">
            Número
          </label>
          <input
            ref={campoNumero}
            id="atalho-numero"
            class="input"
            type="tel"
            aria-required="true"
            autocomplete="off"
            spellcheck={false}
            value={numero}
            aria-invalid={erros.numero ? 'true' : undefined}
            aria-describedby={erros.numero ? 'atalho-numero-erro' : undefined}
            onInput={(e) => {
              const valor = e.currentTarget.value.replace(FORA_DO_NUMERO, '').slice(0, MAX_NUMERO);
              e.currentTarget.value = valor;
              setNumero(valor);
              if (erros.numero) setErros({ ...erros, numero: '' });
            }}
          />
          {erros.numero && (
            <p class="field-error" id="atalho-numero-erro" role="alert">
              <IconAlert size="sm" />
              <span>{erros.numero}</span>
            </p>
          )}
        </div>
        <fieldset class="field acoes">
          <legend class="label acoes-titulo">O que o atalho faz</legend>
          {ACOES.map(({ acao: valor, titulo, ajuda }) => (
            <label class="acao" key={valor}>
              <input
                type="radio"
                name="atalho-acao"
                value={valor}
                checked={acao === valor}
                aria-labelledby={`acao-${valor}`}
                aria-describedby={`acao-${valor}-ajuda`}
                onChange={() => setAcao(valor)}
              />
              <span class="acao-textos">
                <span class="acao-titulo" id={`acao-${valor}`}>
                  {titulo}
                </span>
                <span class="acao-ajuda" id={`acao-${valor}-ajuda`}>
                  {ajuda}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div class={blfDoAdmin ? 'blf-opcao' : 'blf-opcao blf-opcao-off'}>
          <span class="blf-dot" aria-hidden="true" />
          <span class="row-main">
            <span class="row-title set-title wrap" id="atalho-blf">
              Mostrar se o ramal está livre
            </span>
            <span class="row-sub wrap" id="atalho-blf-ajuda">
              {blfDoAdmin ? 'Livre, ocupado ou tocando (BLF).' : 'O administrador não ligou o BLF'}
            </span>
          </span>
          <button
            type="button"
            class="switch"
            role="switch"
            aria-checked={blf}
            aria-labelledby="atalho-blf"
            aria-describedby="atalho-blf-ajuda"
            disabled={!blfDoAdmin}
            onClick={() => setBlfEscolhido(!blf)}
          />
        </div>
        <div class="form-actions form-actions-linha">
          {atalho && (
            <button type="button" class="btn btn-outline" onClick={() => setRemover(true)}>
              Remover
            </button>
          )}
          <button type="submit" class="btn btn-cyan btn-block" disabled={esperando}>
            Salvar atalho
          </button>
        </div>
      </form>
      {remover && atalho && (
        <RemoverAtalho
          atalho={atalho}
          onCancel={() => setRemover(false)}
          onConfirm={() => {
            send({ cmd: 'removeShortcut', id: atalho.id });
            setRemover(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
