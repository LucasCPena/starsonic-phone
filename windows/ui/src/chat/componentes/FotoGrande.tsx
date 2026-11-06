// A foto grande (Task 7): um <dialog> modal por cima da conversa, com a foto inteira, o nome dela, o "Baixar" (o
// chatDownload) e o "Fechar", que o Esc também faz (o Esc não volta para a lista: o main.tsx não sai com um diálogo
// aberto). A foto vem do baixarArquivo num blob: do tipo dela (o servidor manda todo arquivo como
// application/octet-stream); ao fechar, o blob: sai, e a foto que chega depois de fechar nem vira um. Sem a foto, fica
// o ícone: com "Arquivo expirado" no 410, e com o toast da falha sem rede, num 5xx ou num 429 (R31).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconImagem } from '../../icons';
import { ErroChat } from '../api';
import { semDirecao } from '../formato';
import { ARQUIVO_EXPIRADO, BAIXAR, baixarAFoto, FECHAR } from '../textos';
import type { Arquivo } from '../tipos';
import { textoDaFalha } from '../usarChat';

const ID_DO_NOME = 'foto-grande-nome';

interface Props {
  arquivo: Arquivo;
  /** Os bytes da foto (o baixarArquivo da pessoa da vez). */
  carregar(): Promise<Blob>;
  avisar(texto: string): void;
  onBaixar(): void;
  onFechar(): void;
}

export function FotoGrande({ arquivo, carregar, avisar, onBaixar, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [expirada, setExpirada] = useState(false);
  const nome = semDirecao(arquivo.nome);

  // Modal: o foco fica nele, e o Esc é o cancel, que fecha como o Fechar. Ao fechar, o foco volta para quem o abriu (o
  // balão da foto); antes, o diálogo fecha: com ele aberto, o resto da página é inerte e não recebe o foco.
  useLayoutEffect(() => {
    const dialogo = ref.current!;
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialogo.open) dialogo.showModal();
    const cancelar = (e: Event) => {
      e.preventDefault();
      onFechar();
    };
    dialogo.addEventListener('cancel', cancelar);
    return () => {
      dialogo.removeEventListener('cancel', cancelar);
      if (dialogo.open) dialogo.close();
      if (antes?.isConnected) antes.focus();
    };
  }, []);

  useLayoutEffect(() => {
    let aberta = true;
    let criada: string | null = null;
    carregar().then(
      (dados) => {
        if (!aberta) return;
        criada = URL.createObjectURL(dados.slice(0, dados.size, arquivo.tipo));
        setUrl(criada);
      },
      (e) => {
        if (!aberta) return;
        if (e instanceof ErroChat && e.status === 410) setExpirada(true);
        const texto = textoDaFalha(e);
        if (texto) avisar(texto);
      },
    );
    return () => {
      aberta = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [arquivo.id]);

  return (
    <dialog ref={ref} class="dialog foto-grande" aria-labelledby={ID_DO_NOME}>
      <div class="foto-grande-imagem">
        {url ? (
          <img src={url} alt={nome} />
        ) : (
          <span class="foto-grande-espera">
            <IconImagem size="lg" />
            {expirada && <span>{ARQUIVO_EXPIRADO}</span>}
          </span>
        )}
      </div>
      <h2 id={ID_DO_NOME} class="foto-grande-nome">
        {nome}
      </h2>
      <div class="dialog-actions">
        <button type="button" class="btn btn-outline mini" autofocus onClick={onFechar}>
          {FECHAR}
        </button>
        <button type="button" class="btn btn-blue mini" aria-label={baixarAFoto(nome)} onClick={onBaixar}>
          {BAIXAR}
        </button>
      </div>
    </dialog>
  );
}
