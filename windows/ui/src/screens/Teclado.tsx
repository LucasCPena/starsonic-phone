// O Teclado: o número grande, Apagar, até três sugestões de contatos (no iPhone, da agenda: um contato sem nome mostra o
// número), o teclado 3×4, o Rediscar e Ligar.
// Teclado físico: números, * e # digitam; Backspace apaga; Esc limpa; Enter liga.
import { useEffect, useRef } from 'preact/hooks';
import { digitsOnly, initials } from '../format';
import { IconArrowRight, IconBackspace, IconPhone } from '../icons';
import { Rediscar } from '../components/Rediscar';
import type { Contact, RecentCall } from '../state';
import type { Send } from '../types';

interface Props {
  numero: string;
  setNumero(update: (atual: string) => string): void;
  /** As sugestões: os `contatos` do estado; no iPhone, os da agenda (um por número). */
  contatos: Contact[];
  /** Para o Rediscar (a feita mais nova). */
  recentes: RecentCall[];
  send: Send;
}

const KEYS: Array<[string, string]> = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];

const PERMITIDOS = /[^0-9*#+]/g;

export function Teclado({ numero, setNumero, contatos, recentes, send }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const atual = useRef(numero);
  atual.current = numero;

  const ligar = () => {
    if (atual.current) send({ cmd: 'dial', numero: atual.current });
  };
  const apagar = () => setNumero((n) => n.slice(0, -1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      const alvo = e.target as HTMLElement;
      if (alvo === campo.current) {
        // O próprio campo digita; aqui só Enter e Esc.
        if (e.key === 'Enter') {
          e.preventDefault();
          ligar();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setNumero(() => '');
        }
        return;
      }
      // Outro campo, um menu ou um diálogo aberto: a tecla é deles.
      if (alvo.closest('input, textarea, select, [contenteditable="true"], [role="menu"], dialog')) return;
      if (/^[0-9*#+]$/.test(e.key)) {
        e.preventDefault();
        setNumero((n) => n + e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        apagar();
      } else if (e.key === 'Escape') {
        setNumero(() => '');
      } else if (e.key === 'Enter') {
        // Enter liga com o foco na página ou numa tecla; num outro botão, o Enter é dele.
        if (alvo === document.body || alvo.classList.contains('key')) {
          e.preventDefault();
          ligar();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const digitos = digitsOnly(numero);
  const sugestoes =
    digitos.length >= 2 ? contatos.filter((c) => digitsOnly(c.numero).includes(digitos)).slice(0, 3) : [];

  return (
    <div class="body teclado">
      <div class="number">
        <input
          ref={campo}
          class="number-text"
          type="tel"
          aria-label="Número"
          placeholder="Digite o número"
          autocomplete="off"
          spellcheck={false}
          value={numero}
          onInput={(e) => {
            const valor = e.currentTarget.value.replace(PERMITIDOS, '');
            e.currentTarget.value = valor;
            setNumero(() => valor);
          }}
        />
        <button type="button" class="ghost apagar" aria-label="Apagar" title="Apagar" onClick={apagar}>
          <IconBackspace size="lg" />
        </button>
      </div>
      {/* As sugestões e as teclas: numa janela baixa, só esta parte rola (o número e o Ligar ficam à vista). */}
      <div class="teclado-meio">
        {sugestoes.length > 0 && (
          <div class={sugestoes.length > 1 ? 'suggestions suggestions-compact' : 'suggestions'}>
            {sugestoes.map((c) => (
              <button type="button" key={c.id} class="suggest" onClick={() => send({ cmd: 'dial', numero: c.numero, contato: true })}>
                <span class="avatar" aria-hidden="true">
                  {initials(c.nome)}
                </span>
                <span class="row-main">
                  <span class="row-title">{c.nome || c.numero}</span>
                  <span class="row-sub">Contato · {c.numero}</span>
                </span>
                <IconArrowRight size="sm" class="muted" />
              </button>
            ))}
          </div>
        )}
        <div class="keys">
          {KEYS.map(([tecla, letras]) => (
            <button type="button" key={tecla} class="key" aria-label={tecla} onClick={() => setNumero((n) => n + tecla)}>
              <b>{tecla}</b>
              <small aria-hidden="true">{letras}</small>
            </button>
          ))}
        </div>
      </div>
      <div class="call-row">
        {/* O Rediscar liga como o botão de ligar de uma linha dos Recentes (o número, sem a regra dos contatos). */}
        <Rediscar recentes={recentes} id="rediscar-teclado" onDial={(n) => send({ cmd: 'dial', numero: n })} />
        <button type="button" class="btn btn-cyan btn-call btn-block" onClick={ligar}>
          <IconPhone />
          Ligar
        </button>
      </div>
    </div>
  );
}
