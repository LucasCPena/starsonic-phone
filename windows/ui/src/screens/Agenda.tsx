// A aba Contatos do iPhone (spec do iPhone, 4.1; docs/ponte-windows.md, "O modo iPhone"): a agenda do iPhone (a mensagem
// `agenda`), só para ver e ligar, como no Android 0.2.0-rc.3 (contacts/ContactsScreen.kt), com o desenho da aba Contatos
// do Windows. A busca ("Buscar contato") e a lista em ordem alfabética do português, nos grupos pela letra, com as
// iniciais, o nome (sem nome, o primeiro número) e os números; a linha e o botão redondo ligam. Um contato de um número
// liga direto (o `dial` com a regra dos contatos); com mais de um, a escolha do número. Sem o "+" e sem o "⋯": a agenda
// muda só no iPhone. Sem a permissão (pendente ou negada), só o aviso e o Permitir (`allowContacts`); a permissão dada
// depois (nos Ajustes do iPhone) mostra a lista na aba aberta. A cada vez que a aba abre, o `contactsOpened`: o
// hospedeiro lê a agenda de novo e, na primeira vez, pede a permissão.
// A agenda pode ter milhares de contatos: a ordem e a busca são as do format.ts (a ordem, uma vez por lista), e a linha
// de cada contato é montada uma vez e reaproveitada (o Preact pula o mesmo vnode), como na aba Contatos do Windows: a
// busca e um estado novo não redesenham a lista inteira. As linhas fora da tela ficam sem o estilo e o layout (o
// content-visibility do .agenda, no app.css): a aba abre e a busca volta a todos sem montar o layout de milhares delas.
import type { JSX, VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { agendaName, contactNumberLine, groupLetter, initials, searchAgenda } from '../format';
import { IconPhone, IconSearch } from '../icons';
import type { AgendaContact, AgendaSummary } from '../state';
import type { Send } from '../types';

interface Props {
  /** A permissão e a contagem da última lista (o `agenda` do estado). */
  agenda: AgendaSummary;
  /** A última lista (a mensagem `agenda` de `vez` mais alta), na ordem da agenda. */
  contatos: AgendaContact[];
  send: Send;
}

/** O aviso sem a permissão, no meio da aba: o texto e o Permitir (o botão azul, como no Android). */
const ESTILO_DO_AVISO: JSX.CSSProperties = { justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '24px 28px', gap: '16px' };
const ESTILO_DO_TEXTO: JSX.CSSProperties = { margin: 0, maxWidth: '300px', fontSize: '14px', lineHeight: 1.55, textWrap: 'balance' };
/** A escolha do número: os números e o Cancelar, um embaixo do outro. */
const ESTILO_DAS_ESCOLHAS: JSX.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' };
/** O número inteiro no botão, também um comprido (em duas linhas, nunca cortado). */
const ESTILO_DO_NUMERO: JSX.CSSProperties = { height: 'auto', minHeight: '46px', padding: '10px 22px', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.3 };
const TITULO_DA_ESCOLHA = 'escolha-numero-titulo';

// O ícone de ligar é o mesmo em todas as linhas: um vnode só (sem um componente por linha, numa lista de milhares).
const ICONE_LIGAR = IconPhone({ size: 'sm' });

/** A linha de um contato: a linha toda e o botão redondo fazem o mesmo (`tocar`). Sem estado: um vnode, não um componente. */
function linhaDaAgenda(chave: string, c: AgendaContact, tocar: (c: AgendaContact, botao: HTMLElement) => void): VNode {
  const nome = agendaName(c);
  const aoTocar = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => tocar(c, e.currentTarget);
  return (
    <li key={chave} class="row">
      <button type="button" class="row-hit" onClick={aoTocar}>
        <span class="avatar" aria-hidden="true">
          {initials(c.nome)}
        </span>
        <span class="row-main">
          <span class="row-title">{nome}</span>
          <span class="row-sub">{c.numeros.map((n) => contactNumberLine(n)).join(' · ')}</span>
        </span>
      </button>
      <button type="button" class="row-call" aria-label={`Ligar para ${nome}`} title={`Ligar para ${nome}`} onClick={aoTocar}>
        {ICONE_LIGAR}
      </button>
    </li>
  );
}

/**
 * A escolha do número de um contato com mais de um: um <dialog> modal, como o Confirm (o foco fica nele e o Esc cancela),
 * com o nome no título, um botão por número (ligar) e o Cancelar. `onEscolha` recebe o número, ou null no Cancelar.
 */
function EscolhaDoNumero({ contato, onEscolha }: { contato: AgendaContact; onEscolha(numero: string | null): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialogo = ref.current!;
    if (!dialogo.open) dialogo.showModal();
    const cancelar = (e: Event) => {
      e.preventDefault();
      onEscolha(null);
    };
    dialogo.addEventListener('cancel', cancelar);
    return () => dialogo.removeEventListener('cancel', cancelar);
  }, []);
  return (
    <dialog ref={ref} class="dialog" aria-labelledby={TITULO_DA_ESCOLHA}>
      <h2 id={TITULO_DA_ESCOLHA}>{agendaName(contato)}</h2>
      <div style={ESTILO_DAS_ESCOLHAS}>
        {contato.numeros.map((numero) => (
          <button type="button" key={numero} class="btn btn-cyan btn-block" style={ESTILO_DO_NUMERO} onClick={() => onEscolha(numero)}>
            <IconPhone size="sm" />
            {contactNumberLine(numero)}
          </button>
        ))}
        <button type="button" class="btn btn-outline btn-block" onClick={() => onEscolha(null)}>
          Cancelar
        </button>
      </div>
    </dialog>
  );
}

/** A busca e a lista, com a permissão dada. `quantos`: a contagem da última lista, do estado. */
function Lista({ quantos, contatos, send }: { quantos: number; contatos: AgendaContact[]; send: Send }) {
  const [busca, setBusca] = useState('');
  // O contato (com mais de um número) da escolha aberta, e quem a abriu: o foco volta a ele quando ela fecha.
  const [escolha, setEscolha] = useState<AgendaContact | null>(null);
  const voltarFoco = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const botao = voltarFoco.current;
    if (escolha !== null || !botao) return;
    voltarFoco.current = null;
    if (botao.isConnected) botao.focus();
  }, [escolha]);

  // A chave de cada linha: o contato (o nome, os números e quantas vezes ele já apareceu antes, numa agenda com
  // repetidos), não a posição; numa lista nova, a linha (e o foco nela) continua no mesmo contato.
  const chaves = useMemo(() => {
    const vezes = new Map<string, number>();
    const chave = new Map<AgendaContact, string>();
    for (const c of searchAgenda(contatos, '')) {
      const contato = JSON.stringify([c.nome, c.numeros]);
      const n = vezes.get(contato) ?? 0;
      vezes.set(contato, n + 1);
      chave.set(c, `${contato}#${n}`);
    }
    return chave;
  }, [contatos]);

  const grupos = useMemo(() => {
    const lista: Array<{ letra: string; itens: AgendaContact[] }> = [];
    for (const c of searchAgenda(contatos, busca)) {
      const letra = groupLetter(agendaName(c));
      const ultimo = lista[lista.length - 1];
      if (ultimo && ultimo.letra === letra) ultimo.itens.push(c);
      else lista.push({ letra, itens: [c] });
    }
    return lista;
  }, [contatos, busca]);

  // A linha de cada contato, montada uma vez por lista.
  const linhaDe = useMemo(() => {
    const prontas = new WeakMap<AgendaContact, VNode>();
    const tocar = (c: AgendaContact, botao: HTMLElement) => {
      if (c.numeros.length === 1) {
        send({ cmd: 'dial', numero: c.numeros[0], contato: true });
        return;
      }
      voltarFoco.current = botao;
      setEscolha(c);
    };
    return (c: AgendaContact): VNode => {
      let pronta = prontas.get(c);
      if (!pronta) {
        pronta = linhaDaAgenda(chaves.get(c)!, c, tocar);
        prontas.set(c, pronta);
      }
      return pronta;
    };
  }, [chaves, send]);

  const escolher = (numero: string | null) => {
    setEscolha(null);
    if (numero) send({ cmd: 'dial', numero, contato: true });
  };

  // A agenda vazia só quando o estado também diz que ela não tem contatos com número: com o `quantos` maior que zero e
  // nenhum contato aqui, a lista está a caminho (o estado chegou antes dela), e a aba não diz que a agenda está vazia.
  const aCaminho = chaves.size === 0 && quantos > 0;
  return (
    <div class="body scroll agenda" style={{ gap: '10px' }}>
      <div style={{ display: 'flex', flex: 'none' }}>
        <label class="search">
          <IconSearch size="sm" />
          <input
            type="search"
            aria-label="Buscar contato"
            placeholder="Buscar contato"
            autocomplete="off"
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
      </div>
      {grupos.length === 0 && !aCaminho && <p class="empty">{busca.trim() ? 'Nenhum contato encontrado.' : 'Nenhum contato com número no iPhone.'}</p>}
      {grupos.map((g) => (
        <section key={g.letra} aria-label={g.letra}>
          <h2 class="group">{g.letra}</h2>
          <ul class="list">{g.itens.map(linhaDe)}</ul>
        </section>
      ))}
      {escolha && <EscolhaDoNumero contato={escolha} onEscolha={escolher} />}
    </div>
  );
}

export function Agenda({ agenda, contatos, send }: Props): VNode {
  // A cada vez que a aba abre, também sem a permissão (com a pendente, o hospedeiro pergunta na janela do iPhone).
  useEffect(() => {
    send({ cmd: 'contactsOpened' });
  }, []);
  if (agenda.permissao !== 'concedida') {
    return (
      <div class="body" style={ESTILO_DO_AVISO}>
        <p class="muted" style={ESTILO_DO_TEXTO}>
          Permita o acesso aos contatos para ligar pelo nome.
        </p>
        <button type="button" class="btn btn-blue" onClick={() => send({ cmd: 'allowContacts' })}>
          Permitir
        </button>
      </div>
    );
  }
  return <Lista quantos={agenda.quantos} contatos={contatos} send={send} />;
}
