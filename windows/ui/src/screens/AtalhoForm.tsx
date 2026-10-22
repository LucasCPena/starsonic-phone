// Adicionar e Editar atalho (rc.3, spec 3.3): o nome (até 24 caracteres, contados como a loja do C++: um emoji conta
// um), o número (dígitos, *, # e +, até 32), o que o atalho faz (as quatro ações em cartões de rádio) e a chave "Mostrar
// se o ramal está livre" (o BLF do atalho). Num atalho novo, a chave segue o número enquanto a pessoa não mexe nela:
// ligada quando ele parece um ramal (só dígitos, de 2 a 6) e o administrador ligou o BLF. Sem o BLF do administrador,
// ela fica desativada (com o valor gravado), com a ajuda "O administrador não ligou o BLF". O C++ confere tudo de novo
// (a loja) e recusa com um toast; o formulário fecha ao salvar, como o do contato.
import { useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';
import { limitCharacters, looksLikeExtension } from '../format';
import type { Shortcut, ShortcutAction } from '../state';
import type { Send } from '../types';
import { MAX_ATALHOS, RemoverAtalho } from './Atalhos';

interface Props {
  /** Sem atalho: um novo. */
  atalho?: Shortcut;
  /** O "<n> de 8" do alto. */
  posicao: number;
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

export function AtalhoForm({ atalho, posicao, blfDoAdmin, send, onClose }: Props) {
  const [nome, setNome] = useState(atalho?.nome ?? '');
  const [numero, setNumero] = useState(atalho?.numero ?? '');
  const [acao, setAcao] = useState<ShortcutAction>(atalho?.acao ?? 'ligar');
  // A chave escolhida pela pessoa (ou a gravada, na edição); null: ela segue o número.
  const [blfEscolhido, setBlfEscolhido] = useState<boolean | null>(atalho ? atalho.blf : null);
  const [remover, setRemover] = useState(false);
  const blf = blfEscolhido ?? (blfDoAdmin && looksLikeExtension(numero));

  const salvar = (e: Event) => {
    e.preventDefault();
    send({ cmd: 'saveShortcut', ...(atalho ? { id: atalho.id } : {}), nome, numero, acao, blf });
    onClose();
  };

  return (
    <>
      <BackBar title={atalho ? 'Editar atalho' : 'Adicionar atalho'} extra={`${posicao} de ${MAX_ATALHOS}`} onBack={onClose} />
      <form class="body form scroll atalho-form" onSubmit={salvar}>
        <div class="field">
          <label class="label" for="atalho-nome">
            Nome
          </label>
          <input
            id="atalho-nome"
            class="input"
            required
            autocomplete="off"
            value={nome}
            autofocus={!atalho}
            onInput={(e) => {
              const valor = limitCharacters(e.currentTarget.value, MAX_NOME);
              if (valor !== e.currentTarget.value) e.currentTarget.value = valor;
              setNome(valor);
            }}
          />
        </div>
        <div class="field">
          <label class="label" for="atalho-numero">
            Número
          </label>
          <input
            id="atalho-numero"
            class="input"
            type="tel"
            required
            autocomplete="off"
            spellcheck={false}
            value={numero}
            onInput={(e) => {
              const valor = e.currentTarget.value.replace(FORA_DO_NUMERO, '').slice(0, MAX_NUMERO);
              e.currentTarget.value = valor;
              setNumero(valor);
            }}
          />
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
          <button type="submit" class="btn btn-cyan btn-block">
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
