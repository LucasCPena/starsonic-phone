// A rede da página (docs/chat-protocolo.md, seção 10): o abrir, que dá a reunião e o bilhete, e o canal, o WebSocket
// da sala de espera. Transforma o que o navegador dá nos eventos do cérebro, sempre num tempo limitado: o abrir desiste
// em PRAZO_MS (o abrirFalhou com o status 0), e o canal que não abre nesse prazo fecha (o canalFechou). Depois do
// fecharCanal, nada mais daquele canal chega ao cérebro. Nada daqui vai ao console: o abrir traz o bilhete, e o canal
// leva o nome, as senhas e a chave de volta.

const PRAZO_MS = 10000;
// O código de um canal que caiu sem o fechamento do servidor (o do navegador, quando a conexão falha).
const SEM_FECHAMENTO = 1006;

/** A rede da reunião do código: abrir, abrirCanal, mandar e fecharCanal; os resultados vão para o aoEvento. */
export function criarRede(aoEvento, codigo) {
  let canal = null; // o WebSocket de agora: os eventos de outro ficam de fora
  let prazoDoCanal = 0;

  // O abrir leva a abertura, e a resposta a devolve: o cérebro deixa de fora a de um abrir que passou.
  async function abrir(abertura) {
    const desistir = new AbortController();
    const prazo = setTimeout(() => desistir.abort(), PRAZO_MS);
    let evento;
    try {
      const r = await fetch(`/api/v1/pagina/reunioes/${codigo}`, {
        method: 'POST',
        cache: 'no-store',
        signal: desistir.signal,
      });
      const corpo = await r.json().catch(() => null);
      if (r.ok && typeof corpo?.bilhete === 'string' && corpo.reuniao) {
        evento = { tipo: 'abriu', reuniao: corpo.reuniao, bilhete: corpo.bilhete, abertura };
      } else {
        // O 200 sem o que a página precisa conta como a rede que falhou.
        const status = r.ok ? 0 : r.status;
        evento = { tipo: 'abrirFalhou', status, esperarSegundos: corpo?.esperarSegundos, abertura };
      }
    } catch {
      evento = { tipo: 'abrirFalhou', status: 0, abertura }; // a rede, ou o prazo
    } finally {
      clearTimeout(prazo);
    }
    aoEvento(evento);
  }

  // Fecha o canal de agora sem avisar o cérebro: o que ainda vier dele fica de fora.
  function soltar() {
    const ws = canal;
    canal = null;
    clearTimeout(prazoDoCanal);
    if (ws) ws.close(1000);
  }

  function abrirCanal(bilhete) {
    soltar(); // um canal de cada vez
    const esquema = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(`${esquema}//${location.host}/api/v1/pagina/canal?bilhete=${encodeURIComponent(bilhete)}`);
    } catch {
      aoEvento({ tipo: 'canalFechou', codigo: SEM_FECHAMENTO });
      return;
    }
    canal = ws;
    prazoDoCanal = setTimeout(() => {
      if (canal !== ws) return;
      soltar();
      aoEvento({ tipo: 'canalFechou', codigo: SEM_FECHAMENTO });
    }, PRAZO_MS);
    ws.onopen = () => {
      if (canal !== ws) return;
      clearTimeout(prazoDoCanal);
      aoEvento({ tipo: 'canalAbriu' });
    };
    ws.onmessage = (e) => {
      if (canal !== ws) return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return; // o servidor só manda JSON; o resto fica de fora
      }
      aoEvento({ tipo: 'mensagem', m });
    };
    ws.onclose = (e) => {
      if (canal !== ws) return;
      canal = null;
      clearTimeout(prazoDoCanal);
      aoEvento({ tipo: 'canalFechou', codigo: e.code });
    };
  }

  return {
    abrir,
    abrirCanal,
    mandar(m) {
      if (canal?.readyState === WebSocket.OPEN) canal.send(JSON.stringify(m));
    },
    fecharCanal: soltar,
  };
}
