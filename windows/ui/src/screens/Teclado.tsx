// O Teclado: o número grande, Apagar, até três sugestões de contatos (no iPhone, da agenda: um contato sem nome mostra o
// número), o teclado 3×4, o Rediscar e Ligar.
// Teclado físico: números, * e # digitam; Backspace apaga; Esc limpa; Enter liga.
// (rc.6) No Windows, o campo acha o contato também pelo nome: ele aceita letras do teclado do computador (uma letra com o
// foco fora dele vai para ele, e o foco também), e as sugestões são as dos meus contatos e dos da lista da empresa, pela
// busca da aba Contatos (lista-de-contatos.ts), com "Empresa · <número>" nos da empresa. Com letras no campo, o Enter e o
// Ligar ligam para a primeira sugestão, com a regra dos contatos; sem nenhuma, o Ligar fica desligado e aparece "Nenhum
// contato com esse nome". Só com números, como antes. As teclas da tela continuam só números.
// (iPhone) Com o Bipe ao digitar (`bipe`), cada tecla, a da tela e a do teclado físico, manda o `keyTone` com ela (o
// hospedeiro toca o bipe de telefone dela), e o "+" vai como a tecla 0, a dele; o Apagar, as sugestões, o Rediscar e o
// Ligar ficam quietos, como no Android 0.2.0-rc.3. O campo do número, com o teclado do próprio iPhone, também.
import { useEffect, useRef } from 'preact/hooks';
import { digitsOnly, initials } from '../format';
import { IconArrowRight, IconBackspace, IconPhone } from '../icons';
import { Rediscar } from '../components/Rediscar';
import { buscaPor, buscar, listaDeContatos, nomeOuNumero, temLetras } from '../lista-de-contatos';
import type { CompanyContact, Contact, RecentCall } from '../state';
import type { Send } from '../types';

interface Props {
  numero: string;
  setNumero(update: (atual: string) => string): void;
  /** As sugestões: os `contatos` do estado; no iPhone, os da agenda (um por número). */
  contatos: Contact[];
  /**
   * (rc.6) A lista da empresa (a última contatosEmpresa): o campo acha o contato também pelo nome, nos meus e nos dela.
   * null no iPhone (o campo só de número, com as sugestões da agenda pelos dígitos).
   */
  daEmpresa: CompanyContact[] | null;
  /** Para o Rediscar (a feita mais nova). */
  recentes: RecentCall[];
  send: Send;
  /** (iPhone) O Bipe ao digitar: cada tecla manda o `keyTone`. */
  bipe?: boolean;
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
const NENHUM_CONTATO = 'Nenhum contato com esse nome';

/** Uma sugestão: o nome (ou o número, num contato sem nome), o número e se ela é da lista da empresa. */
interface Sugestao {
  key: string;
  nome: string;
  numero: string;
  daEmpresa: boolean;
}

/**
 * As até 3 sugestões do número. (rc.6) No Windows (com a `daEmpresa`), os meus e os da empresa, na ordem e pela busca da
 * aba Contatos: com letras, sempre; só com números, a partir de 2 dígitos, como antes. (iPhone) As da agenda, pelos
 * dígitos, a partir de 2.
 */
function sugestoesDe(numero: string, contatos: Contact[], daEmpresa: CompanyContact[] | null): Sugestao[] {
  const digitos = digitsOnly(numero);
  if (daEmpresa === null) {
    if (digitos.length < 2) return [];
    return contatos
      .filter((c) => digitsOnly(c.numero).includes(digitos))
      .slice(0, 3)
      .map((c) => ({ key: c.id, nome: c.nome, numero: c.numero, daEmpresa: false }));
  }
  if (!temLetras(numero) && digitos.length < 2) return [];
  return buscar(listaDeContatos(contatos, daEmpresa).todas, buscaPor(numero), 3).map((l) => ({
    key: l.key,
    nome: l.nome,
    numero: l.numero,
    daEmpresa: l.meu === null,
  }));
}

export function Teclado({ numero, setNumero, contatos, daEmpresa, recentes, send, bipe }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const atual = useRef(numero);
  atual.current = numero;
  // O de agora também para o teclado físico (o ouvinte é registrado uma vez).
  const bipar = useRef(false);
  bipar.current = bipe === true;
  const porNome = daEmpresa !== null;
  const sugestoes = sugestoesDe(numero, contatos, daEmpresa);
  // (rc.6) Com letras no campo (um nome), o Enter e o Ligar ligam para a primeira sugestão; sem nenhuma, nada.
  const comLetras = porNome && temLetras(numero);
  const nenhum = comLetras && sugestoes.length === 0;
  const doNome = useRef<{ porNome: boolean; primeira: Sugestao | null }>({ porNome, primeira: null });
  doNome.current = { porNome, primeira: comLetras ? (sugestoes[0] ?? null) : null };
  // (rc.6) Um texto novo mostra as sugestões do começo: a primeira, a do Enter com letras, fica à vista (a lista rola
  // sozinha numa janela baixa, e podia estar rolada até a última).
  const caixaDasSugestoes = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (porNome && caixaDasSugestoes.current) caixaDasSugestoes.current.scrollTop = 0;
  }, [numero]);

  const ligar = () => {
    const n = atual.current;
    if (!n) return;
    if (doNome.current.porNome && temLetras(n)) {
      const primeira = doNome.current.primeira;
      if (primeira) send({ cmd: 'dial', numero: primeira.numero, contato: true });
      return;
    }
    send({ cmd: 'dial', numero: n });
  };
  const apagar = () => setNumero((n) => n.slice(0, -1));
  // Uma tecla digitada: o número ganha o caractere e, com o Bipe ao digitar, sai o bipe dela (o "+" é o da tecla 0).
  const digitar = (tecla: string) => {
    setNumero((n) => n + tecla);
    if (bipar.current) send({ cmd: 'keyTone', tecla: tecla === '+' ? '0' : tecla });
  };

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
        digitar(e.key);
      } else if (doNome.current.porNome && /^\p{L}$/u.test(e.key)) {
        // (rc.6) Uma letra (um nome): ela vai para o campo, e o foco também; o resto do nome, com os espaços, é digitado
        // nele. As teclas da tela continuam só números.
        e.preventDefault();
        setNumero((n) => n + e.key);
        campo.current?.focus();
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

  return (
    <div class="body teclado">
      <div class="number">
        <input
          ref={campo}
          class="number-text"
          type={porNome ? 'text' : 'tel'}
          aria-label="Número"
          placeholder={porNome ? 'Digite o nome ou o número' : 'Digite o número'}
          autocomplete="off"
          spellcheck={false}
          value={numero}
          onInput={(e) => {
            // (rc.6) No Windows, com letras o texto fica como veio (um nome); sem elas, só o que é de número, como no iPhone.
            const valor = porNome ? nomeOuNumero(e.currentTarget.value) : e.currentTarget.value.replace(PERMITIDOS, '');
            if (valor !== e.currentTarget.value) e.currentTarget.value = valor;
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
          <div ref={caixaDasSugestoes} class={sugestoes.length > 1 ? 'suggestions suggestions-compact' : 'suggestions'}>
            {sugestoes.map((c) => (
              <button type="button" key={c.key} class="suggest" onClick={() => send({ cmd: 'dial', numero: c.numero, contato: true })}>
                <span class="avatar" aria-hidden="true">
                  {initials(c.nome)}
                </span>
                <span class="row-main">
                  <span class="row-title">{c.nome || c.numero}</span>
                  <span class="row-sub">
                    {c.daEmpresa ? 'Empresa' : 'Contato'} · {c.numero}
                  </span>
                </span>
                <IconArrowRight size="sm" class="muted" />
              </button>
            ))}
          </div>
        )}
        {/* (rc.6) Um nome sem nenhum contato: o texto no lugar das sugestões; sem ele, só a região que o leitor de tela
            anuncia. */}
        {porNome && (
          <p class={nenhum ? 'teclado-vazio' : 'sr-only'} role="status">
            {nenhum ? NENHUM_CONTATO : ''}
          </p>
        )}
        <div class="keys">
          {KEYS.map(([tecla, letras]) => (
            <button type="button" key={tecla} class="key" aria-label={tecla} onClick={() => digitar(tecla)}>
              <b>{tecla}</b>
              <small aria-hidden="true">{letras}</small>
            </button>
          ))}
        </div>
      </div>
      <div class="call-row">
        {/* O Rediscar liga como o botão de ligar de uma linha dos Recentes (o número, sem a regra dos contatos). */}
        <Rediscar recentes={recentes} id="rediscar-teclado" onDial={(n) => send({ cmd: 'dial', numero: n })} />
        <button type="button" class="btn btn-cyan btn-call btn-block" disabled={nenhum} onClick={ligar}>
          <IconPhone />
          Ligar
        </button>
      </div>
    </div>
  );
}
