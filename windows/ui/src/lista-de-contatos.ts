// (rc.6) Os contatos do Windows numa lista só, a mesma nos três lugares que a usam: a aba Contatos (Contatos.tsx), os
// painéis de número da ligação (o Transferir, o Consultar e a Nova ligação, em Ligacao.tsx) e as sugestões do Teclado
// (Teclado.tsx). A junção dos meus (os `contatos` do estado) com os da lista da empresa (a última contatosEmpresa), a
// ordem e a busca são as da aba Contatos desde a rc.4 e ficam escritas só aqui: um da empresa com o mesmo nome (sem
// acento e sem caixa) e os mesmos dígitos de um meu fica de fora (vale o meu); a ordem é a do grupo (o "#" primeiro,
// depois as letras) e, no grupo, a do nome sem acento e sem caixa; a busca olha o nome e a observação sem acento e sem
// caixa e os dígitos do número.
// A lista da empresa pode ter 10.000 contatos: cada linha leva a busca e a ordem já calculadas, e a lista pronta fica
// guardada para os mesmos contatos (os meus iguais e a mesma lista da empresa, que o main.tsx mantém quando uma leitura
// traz a mesma planilha). Abrir de novo a aba, o painel ou o Teclado, digitar ou um estado novo com os mesmos contatos
// não dobram os nomes nem ordenam a lista outra vez.
// O campo de nome ou número do Teclado e dos painéis (o `nomeOuNumero`) também fica aqui. (iPhone) Nada daqui: lá, a
// lista e as sugestões são as da agenda (format.ts).
import { digitsOnly, fold, groupLetter } from './format';
import type { CompanyContact, Contact } from './state';

/** Uma linha da lista: um contato meu (`meu`) ou um da lista da empresa, com a busca e a ordem já calculadas. */
export interface Linha {
  /**
   * O meu: o id dele. O da empresa: o contato (os dígitos, o nome e a observação, e quantas vezes ele já apareceu antes
   * na planilha), não a posição: numa planilha nova, a linha (e o foco ou a marca nela) continua no mesmo contato.
   */
  key: string;
  nome: string;
  numero: string;
  observacao: string;
  /** O meu contato (Editar e Remover); null num da empresa. */
  meu: Contact | null;
  /** O nome e a observação sem acento e sem caixa, e os dígitos do número. */
  nomeBusca: string;
  obsBusca: string;
  digitos: string;
  /** A letra do grupo ("#" para número ou símbolo). */
  letra: string;
}

function linha(key: string, c: CompanyContact, meu: Contact | null): Linha {
  return {
    key,
    nome: c.nome,
    numero: c.numero,
    observacao: c.observacao,
    meu,
    nomeBusca: fold(c.nome),
    obsBusca: fold(c.observacao),
    digitos: digitsOnly(c.numero),
    letra: groupLetter(c.nome),
  };
}

/** A ordem da lista: o grupo "#" primeiro e as letras depois; no grupo, o nome sem acento e sem caixa. */
function ordem(a: Linha, b: Linha): number {
  if (a.letra !== b.letra) return a.letra === '#' ? -1 : b.letra === '#' ? 1 : a.letra < b.letra ? -1 : 1;
  return a.nomeBusca < b.nomeBusca ? -1 : a.nomeBusca > b.nomeBusca ? 1 : 0;
}

/** As linhas da planilha da empresa, em ordem (no empate, a da planilha). */
function linhasDaPlanilha(daEmpresa: CompanyContact[]): Linha[] {
  const vezes = new Map<string, number>();
  return daEmpresa
    .map((c) => {
      const l = linha('', c, null);
      const contato = JSON.stringify([l.digitos, l.nomeBusca, l.obsBusca]);
      const n = vezes.get(contato) ?? 0;
      vezes.set(contato, n + 1);
      l.key = `empresa:${contato}#${n}`;
      return l;
    })
    .sort(ordem);
}

/**
 * Os meus e os da empresa numa lista só, em ordem; some o da empresa com o mesmo nome e os mesmos dígitos de um meu. No
 * empate da ordem, os meus vêm antes (a ordenação é estável).
 */
function juntar(meus: Linha[], daEmpresa: Linha[]): Linha[] {
  const chave = (l: Linha) => `${l.digitos} ${l.nomeBusca}`;
  const minhas = new Set(meus.map(chave));
  return [...meus, ...daEmpresa.filter((l) => !minhas.has(chave(l)))].sort(ordem);
}

/** A lista pronta. */
export interface ListaDeContatos {
  /** Os meus, na ordem do estado (a alfabética do C++). */
  meus: Linha[];
  /** A planilha da empresa inteira, em ordem: também o que é igual a um meu (o filtro Empresa da aba). */
  daPlanilha: Linha[];
  /** Os meus e os da empresa juntos, em ordem, sem o da empresa que também é meu (o Todos da aba, o painel e o Teclado). */
  todas: Linha[];
}

/** As linhas de cada lista da empresa (uma lista que chega na contatosEmpresa não muda depois; a próxima vem em outra). */
const PLANILHAS = new WeakMap<CompanyContact[], Linha[]>();
/** As linhas dos meus de agora: cada estado novo traz outra cópia deles, e só um contato mudado de verdade as refaz. */
let meusDeAgora: { contatos: Contact[]; json: string; linhas: Linha[] } | null = null;
let prontaAgora: ListaDeContatos | null = null;

function linhasDosMeus(contatos: Contact[]): Linha[] {
  if (meusDeAgora?.contatos === contatos) return meusDeAgora.linhas;
  const json = JSON.stringify(contatos);
  meusDeAgora = meusDeAgora?.json === json ? { ...meusDeAgora, contatos } : { contatos, json, linhas: contatos.map((c) => linha(c.id, c, c)) };
  return meusDeAgora.linhas;
}

/**
 * A lista dos meus contatos e dos da lista da empresa, pronta: a mesma (os mesmos objetos) enquanto os meus não mudarem e
 * a lista da empresa for a mesma, para quem a pedir.
 */
export function listaDeContatos(contatos: Contact[], daEmpresa: CompanyContact[]): ListaDeContatos {
  const meus = linhasDosMeus(contatos);
  let daPlanilha = PLANILHAS.get(daEmpresa);
  if (!daPlanilha) {
    daPlanilha = linhasDaPlanilha(daEmpresa);
    PLANILHAS.set(daEmpresa, daPlanilha);
  }
  if (prontaAgora === null || prontaAgora.meus !== meus || prontaAgora.daPlanilha !== daPlanilha) {
    prontaAgora = { meus, daPlanilha, todas: juntar(meus, daPlanilha) };
  }
  return prontaAgora;
}

/** O texto de uma busca: sem os espaços das pontas, sem acento e sem caixa (`termo`), e os dígitos dele. */
export interface Busca {
  termo: string;
  digitos: string;
}

export function buscaPor(texto: string): Busca {
  return { termo: fold(texto.trim()), digitos: digitsOnly(texto) };
}

/** A linha bate com a busca: o nome ou a observação têm o termo, ou o número tem os dígitos. A busca vazia, todas. */
export function bate(l: Linha, busca: Busca): boolean {
  if (!busca.termo) return true;
  if (l.nomeBusca.includes(busca.termo) || l.obsBusca.includes(busca.termo)) return true;
  return busca.digitos.length > 0 && l.digitos.includes(busca.digitos);
}

/** As linhas da lista que batem com a busca, na ordem dela, até `max`. A busca vazia devolve a própria lista. */
export function buscar(lista: Linha[], busca: Busca, max = Infinity): Linha[] {
  if (!busca.termo) return lista.length <= max ? lista : lista.slice(0, max);
  const achadas: Linha[] = [];
  for (const l of lista) {
    if (!bate(l, busca)) continue;
    achadas.push(l);
    if (achadas.length >= max) break;
  }
  return achadas;
}

/** O texto tem alguma letra: é um nome. Sem nenhuma, é um número. */
export function temLetras(texto: string): boolean {
  return /\p{L}/u.test(texto);
}

/**
 * O que o campo de nome ou número (o do Teclado e o dos painéis da ligação, no Windows) guarda do que foi digitado ou
 * colado: com alguma letra, o texto como veio (um nome, com os espaços e a pontuação dele); sem nenhuma, só o que é de um
 * número (os dígitos, *, # e +), como o campo só de número de antes.
 */
export function nomeOuNumero(valor: string): string {
  return temLetras(valor) ? valor : valor.replace(/[^0-9*#+]/g, '');
}
