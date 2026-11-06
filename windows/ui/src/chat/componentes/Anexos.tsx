// Os arquivos que vão no próximo Enviar (Task 7), em cima do campo de escrever: cada um com o ícone (a foto ou o
// arquivo), o nome (sem as marcas de direção, com as reticências), o tamanho e o "×" ("Tirar <nome>"). Assim, um print
// colado por engano sai antes de ir. O useAnexos guarda a lista da conversa: até 10 de uma vez (o toast "Mande até 10
// arquivos de uma vez.") e cada um com até 25 MB (o maior fica de fora, com o toast "Este arquivo passa de 25 MB.").
import { useRef, useState } from 'preact/hooks';
import { IconArquivo, IconClose, IconImagem } from '../../icons';
import { ehFoto, semDirecao, tamanhoDoArquivo } from '../formato';
import { MANDE_ATE_10, PASSA_DE_25_MB, tirarOAnexo } from '../textos';

/** Um Enviar leva até 10 arquivos, cada um com até 26.214.400 bytes (docs/chat-protocolo.md, seção 8). */
const MAX_ANEXOS = 10;
const MAX_BYTES_DO_ARQUIVO = 26_214_400;

export interface Anexo {
  /** Um número da tela, único entre os anexos: a chave da lista. */
  chave: number;
  arquivo: File;
}

/**
 * Os anexos da conversa, até o Enviar. O `anexar` (o clipe, o arrastar, o colar) põe os que cabem, com o toast do que
 * ficou de fora; o `levar` (o Enviar) devolve os arquivos, na ordem, e tira todos de cima do campo. A lista de agora
 * fica numa ref: dois drops seguidos, antes de o Preact desenhar, somam certo.
 */
export function useAnexos(avisar: (texto: string) => void) {
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const agora = useRef<Anexo[]>([]);
  const proximo = useRef(0);
  const mudar = (lista: Anexo[]) => {
    agora.current = lista;
    setAnexos(lista);
  };
  return {
    anexos,
    anexar(arquivos: File[]): void {
      if (arquivos.length === 0) return;
      const cabem = arquivos.filter((a) => a.size <= MAX_BYTES_DO_ARQUIVO);
      const antes = agora.current;
      const entram = cabem.slice(0, Math.max(0, MAX_ANEXOS - antes.length));
      if (entram.length < cabem.length) avisar(MANDE_ATE_10);
      else if (cabem.length < arquivos.length) avisar(PASSA_DE_25_MB);
      if (entram.length > 0) mudar([...antes, ...entram.map((arquivo) => ({ chave: proximo.current++, arquivo }))]);
    },
    tirar(chave: number): void {
      mudar(agora.current.filter((a) => a.chave !== chave));
    },
    levar(): File[] {
      const arquivos = agora.current.map((a) => a.arquivo);
      if (arquivos.length > 0) mudar([]);
      return arquivos;
    },
  };
}

interface Props {
  anexos: Anexo[];
  onTirar(chave: number): void;
}

export function Anexos({ anexos, onTirar }: Props) {
  return (
    <ul class="anexos">
      {anexos.map(({ chave, arquivo }) => {
        const nome = semDirecao(arquivo.name);
        return (
          <li key={chave} class="anexo">
            {ehFoto(arquivo.type) ? <IconImagem size="sm" /> : <IconArquivo size="sm" />}
            <span class="anexo-nome">{nome}</span>
            <span class="anexo-tamanho">{tamanhoDoArquivo(arquivo.size)}</span>
            <button type="button" class="anexo-tirar" aria-label={tirarOAnexo(nome)} title={tirarOAnexo(nome)} onClick={() => onTirar(chave)}>
              <IconClose size="sm" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
