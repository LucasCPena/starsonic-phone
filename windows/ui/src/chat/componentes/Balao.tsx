// Um balão da conversa (os quadros Conversa, Grupo, SemConexao e ConversaEscura): o texto, sempre como texto e com as
// quebras de linha; as minhas à direita (em blue no claro e em cyan no escuro, com o texto on-cyan) e as dos outros à
// esquerda, num grupo com o nome de quem mandou em cima. Embaixo, a hora; numa minha que ainda não chegou ao servidor,
// "Enviando…", ou "Não enviada · Tentar de novo". O `data-chave` é o que a tela usa para manter o lugar da leitura.
// (Task 7) O arquivo e a foto: até lá, o nome do arquivo ("Foto" numa foto) no lugar do texto.
import { clockTime } from '../../format';
import { IconAlert } from '../../icons';
import type { Pendente } from '../cliente';
import { ENVIANDO, FOTO, NAO_ENVIADA, nomeDaPessoa, TENTAR_DE_NOVO } from '../textos';
import type { Mensagem } from '../tipos';

type Props =
  | { chave: string; mensagem: Mensagem; minha: boolean; comAutor: boolean }
  | { chave: string; pendente: Pendente; onTentarDeNovo(idLocal: string): void };

function conteudo(m: Mensagem): string {
  if (m.tipo === 'arquivo') return m.arquivo?.foto ? FOTO : (m.arquivo?.nome ?? '');
  return m.texto ?? '';
}

export function Balao(props: Props) {
  if ('pendente' in props) {
    const { pendente: p, onTentarDeNovo } = props;
    const naoEnviada = p.estado === 'naoEnviada';
    return (
      <div class="balao balao-meu" data-chave={props.chave}>
        <p class={naoEnviada ? 'balao-texto balao-nao-enviada' : 'balao-texto'}>{p.texto}</p>
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
  return (
    <div class={minha ? 'balao balao-meu' : 'balao balao-outro'} data-chave={props.chave}>
      {comAutor && m.autor && <span class="balao-autor">{nomeDaPessoa(m.autor)}</span>}
      <p class="balao-texto">{conteudo(m)}</p>
      <span class="balao-hora">{clockTime(m.criadaEm)}</span>
    </div>
  );
}
