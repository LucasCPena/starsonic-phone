// A conversa com o app (a seção 7.5 da spec da etapa 2a): a interface do Starsonic Phone mostra a página num iframe, e
// as duas falam por postMessage, sempre com um objeto que leva o "starsonic": 1 e o tipo. A página só fala com a
// janela de cima, e só aceita o que vem dela, com uma origem do app: as do <meta name="starsonic-app"> que o servidor
// põe na página (as mesmas do frame-ancestors). Um tipo desconhecido fica de fora: o protocolo só cresce. Quem confere
// os campos de cada mensagem é o cérebro (o evento app). O passe, os nomes dos aparelhos e as origens não vão ao
// console.

// Os tipos que o app manda à página.
const DO_APP = new Set(['passe', 'aparelhos', 'pausar', 'retomar', 'bloqueio', 'sair']);

// Uma origem de verdade, como o navegador a escreve (https://app.starsonic.local): o modelo sem a troca, um caminho ou
// o "*" ficam de fora, e o postMessage nunca recebe uma origem que o faria lançar.
function ehOrigem(texto) {
  try {
    return new URL(texto).origin === texto;
  } catch {
    return false;
  }
}

/** As origens do app, do conteúdo do meta starsonic-app, separadas por espaços; [] sem ele. */
export function origensDoApp(documento) {
  const meta = documento?.querySelector?.('meta[name="starsonic-app"]');
  const conteudo = meta?.getAttribute('content') ?? '';
  return conteudo.split(/\s+/).filter((o) => o !== '' && ehOrigem(o));
}

/**
 * A conversa com o app, na janela da página: {dentro, mandar(tipo, campos)}. O dentro é a página dentro de outra
 * janela, com uma origem do app. As mensagens do app chegam ao aoEvento como o {tipo: 'app', m}. Fora do app, nada é
 * ouvido nem mandado.
 */
export function criarApp(aoEvento, { janela, origens }) {
  const cima = janela.parent;
  // As origens a que a página manda. O Chromium (e o WebView2 do app) diz a origem de cima no ancestorOrigins: a
  // mensagem vai só a ela, que tem de ser do app; a outra origem da lista daria um aviso no console, com as duas
  // origens. Sem ele (o Firefox), vai a cada origem da lista, e o navegador só entrega à que é a de verdade.
  const deCima = janela.location?.ancestorOrigins?.[0];
  const destinos = typeof deCima === 'string' ? origens.filter((o) => o === deCima) : [...origens];
  const dentro = cima !== janela && cima != null && destinos.length > 0;

  if (dentro) {
    janela.addEventListener('message', (ev) => {
      // Só a janela de cima, com uma origem do app: nem um iframe da própria página, nem outra janela.
      if (ev.source !== cima || !destinos.includes(ev.origin)) return;
      const m = ev.data;
      if (m === null || typeof m !== 'object' || Array.isArray(m)) return;
      if (m.starsonic !== 1 || !DO_APP.has(m.tipo)) return;
      aoEvento({ tipo: 'app', m });
    });
  }

  return {
    dentro,
    mandar(tipo, campos = {}) {
      if (!dentro) return;
      const m = { ...campos, starsonic: 1, tipo };
      for (const origem of destinos) cima.postMessage(m, origem);
    },
  };
}
