// Um balão da conversa (os quadros Conversa, Grupo, SemConexao e ConversaEscura): o texto, sempre como texto e com as
// quebras de linha; as minhas à direita (em blue no claro e em cyan no escuro, com o texto on-cyan) e as dos outros à
// esquerda, num grupo com o nome de quem mandou em cima. Embaixo, a hora; numa minha que ainda não chegou ao servidor,
// "Enviando…", ou "Não enviada · Tentar de novo". O `data-chave` é o que a tela usa para manter o lugar da leitura.
// Para o leitor de tela, antes do texto, quem mandou ("Você" na minha; na conversa a dois, o nome do outro), escondido
// na tela; no grupo, o nome dos outros já está à vista.
// (Task 7) O arquivo: o ícone, o nome, "<tamanho> · <tipo>" e a seta de baixar; um clique pede ao núcleo o download.
// A foto: a miniatura (o blob: da conversa aberta, já com a medida dela) ou, sem ela, o quadro com o ícone e o nome; um
// clique abre a foto grande. Um arquivo expirado mostra "Arquivo expirado" e não faz nada no clique. Um Pendente de
// arquivo mostra o progresso do upload. Todo nome de arquivo vai sem as marcas de direção (semDirecao). (vídeo, etapa
// 2, Ruling 14) A foto e o arquivo ignoram o segundo clique de um clique duplo (o semSegundoClique; o chat só existe no
// Windows): a conversa que o Chat da ligação abre embaixo do ponteiro não abre uma foto nem baixa um arquivo com ele.
import { clockTime } from '../../format';
import { IconAlert, IconArquivo, IconBaixar, IconImagem } from '../../icons';
import { semSegundoClique } from '../../plataforma';
import type { Miniatura } from '../aberta';
import type { Pendente } from '../envios';
import { semDirecao, tamanhoDoArquivo, tipoDoArquivo } from '../formato';
import { abrirAFoto, abrirOArquivo, ARQUIVO_EXPIRADO, ENVIANDO, NAO_ENVIADA, nomeDaPessoa, TENTAR_DE_NOVO, VOCE } from '../textos';
import type { Arquivo, Mensagem } from '../tipos';

type Props =
  | {
      chave: string;
      mensagem: Mensagem;
      minha: boolean;
      comAutor: boolean;
      /** (Task 7) A miniatura da foto, quando ela já chegou. */
      miniatura?: Miniatura;
      onAbrirFoto(arquivo: Arquivo): void;
      onBaixar(arquivo: Arquivo): void;
    }
  | { chave: string; pendente: Pendente; onTentarDeNovo(idLocal: string): void };

export function Balao(props: Props) {
  if ('pendente' in props) {
    const { pendente: p, onTentarDeNovo } = props;
    const naoEnviada = p.estado === 'naoEnviada';
    return (
      <div class="balao balao-meu" data-chave={props.chave}>
        <span class="sr-only">{VOCE}</span>
        {p.tipo === 'arquivo' && p.arquivo ? (
          <ArquivoQueVai arquivo={p.arquivo} progresso={naoEnviada ? null : (p.progresso ?? 0)} />
        ) : (
          <p class={naoEnviada ? 'balao-texto balao-nao-enviada' : 'balao-texto'}>{p.texto}</p>
        )}
        {naoEnviada ? (
          <span class="balao-falha">
            <IconAlert size="sm" />
            <span>{NAO_ENVIADA}</span>
            {' · '}
            <button type="button" class="balao-tentar" onClick={() => onTentarDeNovo(p.idLocal)}>
              {TENTAR_DE_NOVO}
            </button>
          </span>
        ) : (
          <span class="balao-hora">{ENVIANDO}</span>
        )}
      </div>
    );
  }
  const { mensagem: m, minha, comAutor } = props;
  const quem = minha ? VOCE : !comAutor && m.autor ? nomeDaPessoa(m.autor) : null;
  const a = m.tipo === 'arquivo' ? m.arquivo : undefined;
  return (
    <div class={minha ? 'balao balao-meu' : 'balao balao-outro'} data-chave={props.chave}>
      {comAutor && m.autor && <span class="balao-autor">{nomeDaPessoa(m.autor)}</span>}
      {quem !== null && <span class="sr-only">{quem}</span>}
      {a ? (
        a.foto ? (
          <FotoDoBalao arquivo={a} miniatura={props.miniatura} onAbrir={props.onAbrirFoto} />
        ) : (
          <ArquivoDoBalao arquivo={a} onBaixar={props.onBaixar} />
        )
      ) : (
        <p class="balao-texto">{m.texto ?? ''}</p>
      )}
      <span class="balao-hora">{clockTime(m.criadaEm)}</span>
    </div>
  );
}

/** O desenho do arquivo: o ícone, o nome e a linha de baixo; com o `baixar`, a seta. */
function DesenhoDoArquivo({ nome, linha, baixar }: { nome: string; linha: string; baixar: boolean }) {
  return (
    <>
      <span class="balao-arquivo-icone">
        <IconArquivo />
      </span>
      <span class="balao-arquivo-textos">
        <span class="balao-arquivo-nome">{nome}</span>
        <span class="balao-arquivo-meta">{linha}</span>
      </span>
      {baixar && <IconBaixar />}
    </>
  );
}

/** O quadro da foto sem a miniatura: o ícone e o nome (e, numa foto expirada, "Arquivo expirado"). */
function QuadroDaFoto({ nome, linha }: { nome: string; linha?: string }) {
  return (
    <span class="balao-foto-quadro">
      <IconImagem />
      <span class="balao-foto-nome">{nome}</span>
      {linha && <span class="balao-foto-linha">{linha}</span>}
    </span>
  );
}

function ArquivoDoBalao({ arquivo: a, onBaixar }: { arquivo: Arquivo; onBaixar(a: Arquivo): void }) {
  const nome = semDirecao(a.nome);
  if (a.expirado) {
    return (
      <div class="balao-arquivo balao-expirado">
        <DesenhoDoArquivo nome={nome} linha={ARQUIVO_EXPIRADO} baixar={false} />
      </div>
    );
  }
  const tamanho = tamanhoDoArquivo(a.tamanho);
  const rotulo = abrirOArquivo(nome, tamanho);
  return (
    <button type="button" class="balao-arquivo" aria-label={rotulo} title={rotulo} onClick={semSegundoClique(true, () => onBaixar(a))}>
      <DesenhoDoArquivo nome={nome} linha={`${tamanho} · ${tipoDoArquivo(a)}`} baixar />
    </button>
  );
}

function FotoDoBalao({ arquivo: a, miniatura, onAbrir }: { arquivo: Arquivo; miniatura?: Miniatura; onAbrir(a: Arquivo): void }) {
  const nome = semDirecao(a.nome);
  if (a.expirado) {
    return (
      <div class="balao-foto balao-expirado">
        <QuadroDaFoto nome={nome} linha={ARQUIVO_EXPIRADO} />
      </div>
    );
  }
  const rotulo = abrirAFoto(nome);
  // Com a largura e a altura, a miniatura já ocupa o lugar dela antes de a imagem abrir: o balão cresce de uma vez só.
  return (
    <button type="button" class="balao-foto" aria-label={rotulo} title={rotulo} onClick={semSegundoClique(true, () => onAbrir(a))}>
      {miniatura ? <img src={miniatura.url} width={miniatura.largura} height={miniatura.altura} alt="" /> : <QuadroDaFoto nome={nome} />}
    </button>
  );
}

/** O arquivo de um Pendente: como ele vai aparecer (a foto no quadro), com o progresso do upload enquanto vai. */
function ArquivoQueVai({ arquivo, progresso }: { arquivo: NonNullable<Pendente['arquivo']>; progresso: number | null }) {
  const nome = semDirecao(arquivo.nome);
  const barra = progresso !== null && <Progresso nome={nome} fracao={progresso} />;
  if (arquivo.foto) {
    return (
      <div class="balao-foto">
        <QuadroDaFoto nome={nome} />
        {barra}
      </div>
    );
  }
  return (
    <div class="balao-arquivo">
      <DesenhoDoArquivo nome={nome} linha={`${tamanhoDoArquivo(arquivo.tamanho)} · ${tipoDoArquivo(arquivo)}`} baixar={false} />
      {barra}
    </div>
  );
}

/** O progresso do upload, de 0 a 100, com o nome do arquivo para o leitor de tela. */
function Progresso({ nome, fracao }: { nome: string; fracao: number }) {
  const valor = Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  return (
    <span class="balao-progresso" role="progressbar" aria-label={nome} aria-valuemin={0} aria-valuemax={100} aria-valuenow={valor}>
      <span class="balao-progresso-feito" style={{ width: `${valor}%` }} />
    </span>
  );
}
