// O chat da reunião e o sinalizador de qualidade de ponta a ponta: a página de verdade, servida pelo chat em
// /r/<código>, com o chat, o agente e o FreeSWITCH de verdade. Três pessoas de fora na mesma reunião de teste: A
// (Carlos Lima), B (Bia Ramos) e C (Maria Lima). Os textos das mensagens são únicos e compridos: o teste dos registros
// (seguranca.spec.ts) os procura nas saídas dos três servidores, e o conferirOConsole, no console de cada página.
import { expect, test, type Locator } from '@playwright/test';
import { repetirAte } from './espera';
import { A, B, C } from './midia';
import { Navegador, Pagina, type Mensagem } from './navegador';
import { ana, novaReuniaoDeTeste, type EventosDoApp } from './servidores';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RECADO = 'Recado 7c41 do Carlos: https://exemplo.com.br/relatorio';
const RESPOSTA = 'Resposta 9d02 da Bia para todos desta reunião';
const DEPOIS_DA_SAIDA = 'Aviso 5e17 do Carlos para quem ficou na reunião';
const DA_OUTRA_REUNIAO = 'Assunto b3a8 que é só da outra reunião';

// ---- As peças da página. ----

const oChat = (p: Pagina) => p.page.locator('button[data-botao="chat"]');
const numero = (p: Pagina) => oChat(p).locator('.contagem');
const painel = (p: Pagina) => p.page.getByRole('complementary', { name: 'Chat da reunião' });
const campo = (p: Pagina) => p.page.getByLabel('Mensagem para todos da reunião', { exact: true });
const mensagens = (p: Pagina) => p.page.locator('.painel-mensagens > .mensagem');
const aviso = (p: Pagina) => p.page.locator('.aviso-curto');
const sinal = (p: Pagina) => p.page.locator('button[data-botao="qualidade"]');
const textoDoSinal = (p: Pagina) => sinal(p).locator('.sinal-texto');
const cartao = (p: Pagina) => p.page.locator('#sinal-cartao');

/** A mensagem da lista com o texto: o balão dela. */
const balao = (p: Pagina, texto: string): Locator =>
  mensagens(p).locator('.mensagem-texto').filter({ hasText: texto });
/** A mensagem da lista com o texto, inteira. */
const mensagem = (p: Pagina, texto: string): Locator => mensagens(p).filter({ hasText: texto });

/**
 * O lado da lista em que a mensagem está: o cabeçalho dela (quem escreveu e a hora, que é curto) encostado na direita
 * ou na esquerda da lista, com a margem dela.
 */
async function ladoDe(p: Pagina, texto: string): Promise<'direita' | 'esquerda' | 'meio'> {
  const lista = await p.page.locator('.painel-mensagens').boundingBox();
  const quem = await mensagem(p, texto).locator('.mensagem-quem').boundingBox();
  if (!lista || !quem) throw new Error(`a mensagem não está na tela de ${p.pessoa.letra}`);
  const daEsquerda = quem.x - lista.x;
  const daDireita = lista.x + lista.width - (quem.x + quem.width);
  if (daDireita <= 2 && daEsquerda > 40) return 'direita';
  if (daEsquerda <= 2 && daDireita > 40) return 'esquerda';
  return 'meio';
}

/** A hora de agora como a página a escreve ("14:02"), no fuso dela. */
const horaDaPagina = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(ms);

// ---- O canal de cada página, visto pelo teste. ----

/** Um quadro do canal com uma mensagem do chat, e a hora em que o teste o viu. */
interface Quadro {
  quando: number;
  m: Mensagem;
}

interface CanalVisto {
  mandados: Quadro[];
  recebidos: Quadro[];
}

/** As mensagens do chat (o tipo "mensagem") que o canal da página manda e recebe, daqui em diante. Antes do entrar. */
function vigiarOCanal(p: Pagina): CanalVisto {
  const visto: CanalVisto = { mandados: [], recebidos: [] };
  p.page.on('websocket', (ws) => {
    if (new URL(ws.url()).pathname !== '/api/v1/pagina/canal') return;
    const guardar = (lista: Quadro[]) => ({ payload }: { payload: string | Buffer }) => {
      const quando = Date.now();
      try {
        const m = JSON.parse(String(payload)) as Mensagem;
        if (m.tipo === 'mensagem') lista.push({ quando, m });
      } catch {
        // não é uma mensagem da página
      }
    };
    ws.on('framesent', guardar(visto.mandados));
    ws.on('framereceived', guardar(visto.recebidos));
  });
  return visto;
}

/** O quadro com o texto, esperado por até 10 s. */
function quadroCom(lista: Quadro[], texto: string, de: string): Promise<Quadro> {
  return repetirAte(
    10_000,
    50,
    () => lista.find((q) => q.m.texto === texto),
    (q) => q !== undefined,
    () => `o canal de ${de} não viu a mensagem em 10 s`,
  ) as Promise<Quadro>;
}

/** A pessoa escreve no chat aberto e manda com o Enter. */
async function escrever(p: Pagina, texto: string): Promise<void> {
  await campo(p).fill(texto);
  await campo(p).press('Enter');
}

// ---- O sinalizador, visto pelo teste. ----

/** Cada texto que o botão do sinalizador mostrou desde o olhar, com os ms passados e os números do cartão da hora. */
type Visto = [number, string, string];

/** Começa a olhar o sinalizador da página: o texto de agora e cada mudança dele. */
async function olharOSinal(p: Pagina): Promise<void> {
  await p.page.evaluate(() => {
    const w = window as unknown as { sinalDoTeste: { desde: number; vistos: Array<[number, string, string]> } };
    const texto = document.querySelector('.sinal-texto') as HTMLElement;
    const numeros = document.querySelector('.sinal-numeros') as HTMLElement;
    const desde = Date.now();
    const vistos: Array<[number, string, string]> = [[0, texto.textContent ?? '', numeros.textContent ?? '']];
    w.sinalDoTeste = { desde, vistos };
    new MutationObserver(() => {
      const agora = texto.textContent ?? '';
      if (agora !== vistos[vistos.length - 1][1]) vistos.push([Date.now() - desde, agora, numeros.textContent ?? '']);
    }).observe(texto, { childList: true, characterData: true, subtree: true });
  });
}

const vistosNoSinal = (p: Pagina): Promise<Visto[]> =>
  p.page.evaluate(() => (window as unknown as { sinalDoTeste: { vistos: Visto[] } }).sinalDoTeste.vistos);

/** Espera o sinalizador dizer Conexão boa, e devolve o que ele mostrou até lá. */
function ateAConexaoBoa(p: Pagina, prazo: number): Promise<Visto[]> {
  return repetirAte(
    prazo,
    250,
    () => vistosNoSinal(p),
    (vistos) => vistos[vistos.length - 1][1] === 'Conexão boa',
    (vistos) =>
      `o sinalizador de ${p.pessoa.letra} não chegou a Conexão boa em ${prazo / 1000} s; ele mostrou ` +
      JSON.stringify(vistos),
  );
}

// ---- As três pessoas na reunião de teste. ----

test.describe.serial('o chat e o sinalizador, com três pessoas na reunião de teste', () => {
  let a: Pagina | undefined;
  let b: Pagina | undefined;
  let c: Pagina | undefined;
  let canalDeA: CanalVisto = { mandados: [], recebidos: [] };
  let canalDeB: CanalVisto = { mandados: [], recebidos: [] };
  let canalDeC: CanalVisto = { mandados: [], recebidos: [] };

  test.afterAll(async () => {
    await a?.fechar();
    await b?.fechar();
    await c?.fechar();
  });

  /** As três páginas, que o primeiro teste pôs na reunião. */
  function asTres(): [Pagina, Pagina, Pagina] {
    if (!a || !b || !c) throw new Error('o primeiro teste não pôs A, B e C na reunião');
    return [a, b, c];
  }

  test('o sinalizador sai do Medindo para Conexão boa', async () => {
    const codigo = await novaReuniaoDeTeste();
    a = await Pagina.abrir(A);
    b = await Pagina.abrir(B);
    c = await Pagina.abrir(C);
    canalDeA = vigiarOCanal(a);
    canalDeB = vigiarOCanal(b);
    canalDeC = vigiarOCanal(c);

    // Cada uma entra, e o sinalizador dela começa medindo: o teste passa a olhar o que ele mostra.
    for (const [p, nome] of [
      [a, 'Carlos Lima'],
      [b, 'Bia Ramos'],
      [c, 'Maria Lima'],
    ] as const) {
      await p.entrar(codigo, nome);
      await expect(p.controles()).toBeVisible({ timeout: 30_000 });
      await olharOSinal(p);
      await expect(textoDoSinal(p)).toHaveText('Medindo a conexão…');
      await expect(sinal(p)).toHaveAccessibleName('Medindo a conexão');
    }

    // Em até 15 s da entrada de cada uma, o Medindo dá lugar à Conexão boa, sem passar por outro estado.
    for (const p of asTres()) {
      const vistos = await ateAConexaoBoa(p, 30_000);
      expect(
        vistos.map(([, texto]) => texto),
        `o que o sinalizador de ${p.pessoa.letra} mostrou`,
      ).toEqual(['Medindo a conexão…', 'Conexão boa']);
      expect(vistos[1][0], `os ms até a Conexão boa de ${p.pessoa.letra}`).toBeLessThanOrEqual(15_000);
      await expect(sinal(p)).toHaveAccessibleName('Conexão boa. Ver os detalhes');
    }

    // O cartão de cada uma tem os dois números, que o navegador deu de verdade.
    for (const p of asTres()) {
      await sinal(p).click();
      await expect(cartao(p)).toBeVisible();
      await expect(cartao(p).locator('.sinal-titulo')).toHaveText('Sua conexão está boa');
      await expect(cartao(p).locator('.sinal-numeros')).toHaveText(/^Perda: \d+% · Atraso: \d+ ms$/);
      await sinal(p).click();
      await expect(cartao(p)).toBeHidden();
      await p.conferirOConsole();
    }
  });

  // Os critérios 1 e 2 do desenho.
  test('a mensagem chega aos outros', async () => {
    const [carlos, bia, maria] = asTres();
    await oChat(carlos).click();
    await expect(painel(carlos)).toBeVisible();
    const antes = Date.now();
    await escrever(carlos, RECADO);

    // Em B e em C, com o chat fechado: o número no botão e o aviso curto, com quem escreveu.
    for (const p of [bia, maria]) {
      await expect(aviso(p).locator('.aviso-curto-quem')).toHaveText('Carlos Lima escreveu');
      await expect(aviso(p).locator('.aviso-curto-linha')).toHaveText(RECADO);
      await expect(numero(p)).toHaveText('1');
      await expect(p.botao('Chat, 1 mensagem nova')).toBeVisible();
    }

    // Do quadro que A mandou até o que B e C receberam passa menos de 1 s. Só quem escreveu recebe o id e o "voce".
    const mandado = await quadroCom(canalDeA.mandados, RECADO, 'A');
    for (const [canal, de] of [
      [canalDeB, 'B'],
      [canalDeC, 'C'],
    ] as const) {
      const recebido = await quadroCom(canal.recebidos, RECADO, de);
      expect(recebido.quando - mandado.quando, `os ms até a mensagem chegar a ${de}`).toBeLessThan(1_000);
      expect(recebido.m).toEqual({
        tipo: 'mensagem',
        de: expect.any(String),
        nome: 'Carlos Lima',
        voce: false,
        texto: RECADO,
      });
    }
    const resposta = await quadroCom(canalDeA.recebidos, RECADO, 'A');
    expect(resposta.m).toMatchObject({ tipo: 'mensagem', id: mandado.m.id, nome: 'Carlos Lima', voce: true });

    // Em A, ela aparece à direita, com "Você" e a hora, e deixa de estar indo.
    const depois = Date.now();
    const horas = [`· ${horaDaPagina(antes)}`, `· ${horaDaPagina(depois)}`];
    const minha = mensagem(carlos, RECADO);
    await expect(minha).toHaveAttribute('data-de', 'voce');
    await expect(minha).toHaveAttribute('data-situacao', 'enviada');
    await expect(minha.locator('.mensagem-nome')).toHaveText('Você');
    expect(horas).toContain((await minha.locator('.mensagem-hora').innerText()).trim());
    expect(await ladoDe(carlos, RECADO), 'o lado da mensagem de A, na página dela').toBe('direita');

    // B abre o chat e vê quem escreveu, a hora e o link, que abre em outra aba.
    await oChat(bia).click();
    await expect(painel(bia)).toBeVisible();
    const dela = mensagem(bia, RECADO);
    await expect(dela).toHaveAttribute('data-de', 'outro');
    await expect(dela.locator('.mensagem-nome')).toHaveText('Carlos Lima');
    expect(await ladoDe(bia, RECADO), 'o lado da mensagem de A, na página de B').toBe('esquerda');
    expect(horas).toContain((await dela.locator('.mensagem-hora').innerText()).trim());
    await expect(balao(bia, RECADO)).toHaveText(RECADO);
    const link = balao(bia, RECADO).getByRole('link');
    await expect(link).toHaveText('https://exemplo.com.br/relatorio');
    await expect(link).toHaveAttribute('href', 'https://exemplo.com.br/relatorio');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // O chat aberto zera o número de B; o de C continua.
    await expect(numero(bia)).toBeHidden();
    await expect(numero(maria)).toHaveText('1');

    for (const p of asTres()) await p.conferirOConsole();
  });

  test('cada um responde, e ninguém vê a conversa de outra reunião', async () => {
    test.setTimeout(240_000);
    const [carlos, bia, maria] = asTres();
    // Outra reunião, ao mesmo tempo: uma marcada da empresa, com a colega (o app, pela API, e a imagem dela pelo
    // cliente mínimo) e uma pessoa de fora, pela página. A reunião de teste é uma só de cada vez: outra a encerraria.
    const app = ana();
    const outra = await app.criarMarcada();
    let eventos: EventosDoApp | undefined;
    let colega: Navegador | undefined;
    let roberto: Pagina | undefined;
    try {
      eventos = await app.eventos();
      colega = await Navegador.abrir(B);
      await colega.ligar(await app.entrar(outra));
      roberto = await Pagina.abrir(A);
      const canalDoRoberto = vigiarOCanal(roberto);
      await roberto.entrar(outra, 'Roberto Alves');
      const pedido = await eventos.esperar(
        (e) => e.tipo === 'reuniaoPedido' && e.reuniao === outra && e.pedido?.nome === 'Roberto Alves',
      );
      await app.aceitar(outra, pedido.pedido.id);
      await expect(roberto.controles()).toBeVisible({ timeout: 30_000 });

      // B responde: A, com o chat aberto, vê a resposta; C, com ele fechado, vê o aviso e o número, que passa a 2.
      await escrever(bia, RESPOSTA);
      await expect(mensagem(bia, RESPOSTA)).toHaveAttribute('data-situacao', 'enviada');
      await expect(mensagem(carlos, RESPOSTA).locator('.mensagem-nome')).toHaveText('Bia Ramos');
      await expect(mensagem(carlos, RESPOSTA)).toHaveAttribute('data-de', 'outro');
      await expect(numero(carlos)).toBeHidden();
      await expect(aviso(maria).locator('.aviso-curto-quem')).toHaveText('Bia Ramos escreveu');
      await expect(numero(maria)).toHaveText('2');
      await quadroCom(canalDeA.recebidos, RESPOSTA, 'A');
      await quadroCom(canalDeC.recebidos, RESPOSTA, 'C');

      // A pessoa da outra reunião escreve lá: a mensagem dela vale (o servidor a devolve), e fica só lá.
      await oChat(roberto).click();
      await expect(painel(roberto)).toBeVisible();
      await escrever(roberto, DA_OUTRA_REUNIAO);
      await expect(mensagem(roberto, DA_OUTRA_REUNIAO)).toHaveAttribute('data-situacao', 'enviada');

      // Passados 2 s: a outra reunião não recebeu nada desta, e esta não recebeu nada da outra. O app da colega não
      // recebe o chat da reunião.
      await esperar(2_000);
      expect(
        canalDoRoberto.recebidos.map((q) => q.m.texto),
        'o que o canal da outra reunião recebeu',
      ).toEqual([DA_OUTRA_REUNIAO]);
      for (const [canal, de] of [
        [canalDeA, 'A'],
        [canalDeB, 'B'],
        [canalDeC, 'C'],
      ] as const) {
        expect(
          canal.recebidos.filter((q) => q.m.texto === DA_OUTRA_REUNIAO),
          `a mensagem da outra reunião no canal de ${de}`,
        ).toEqual([]);
      }
      await expect(mensagens(roberto)).toHaveCount(1);
      const comOTexto = eventos.todos((e) => JSON.stringify(e).includes(DA_OUTRA_REUNIAO));
      expect(comOTexto, 'os eventos do app da colega com o texto da mensagem').toEqual([]);
      await roberto.conferirOConsole();
    } finally {
      eventos?.fechar();
      await roberto?.fechar();
      await colega?.fechar();
      await app.encerrar(outra).catch(() => {});
    }
    for (const p of asTres()) await p.conferirOConsole();
  });

  // O critério 5 do desenho, para quem sai.
  test('quem saiu não recebe', async () => {
    const [carlos, bia, maria] = asTres();
    await maria.botao('Sair').click();
    await expect(maria.titulo('Você saiu da reunião')).toBeVisible();
    // O chat só sabe da saída quando o agente a conta, e até lá ainda repassa o chat a C. O palco sem ela, na página
    // de A, é o chat que já sabe: só ele o manda.
    await carlos.esperarQuadros(['Você', 'Bia Ramos'], 30_000);
    const antes = canalDeC.recebidos.length;

    await escrever(carlos, DEPOIS_DA_SAIDA);
    await expect(mensagem(bia, DEPOIS_DA_SAIDA).locator('.mensagem-nome')).toHaveText('Carlos Lima');
    await quadroCom(canalDeB.recebidos, DEPOIS_DA_SAIDA, 'B');
    // Em 2 s, o canal de C, que continua aberto, não recebe nenhuma mensagem do chat.
    await esperar(2_000);
    expect(canalDeC.recebidos.length, 'as mensagens do chat no canal de quem saiu').toBe(antes);

    // C entra de novo, abre o chat e não vê nada de antes: nem as que chegaram com ela dentro.
    await maria.botao('Entrar de novo').click();
    await expect(maria.controles()).toBeVisible({ timeout: 30_000 });
    await expect(numero(maria)).toBeHidden();
    await oChat(maria).click();
    await expect(painel(maria)).toBeVisible();
    await expect(maria.page.getByText('Nenhuma mensagem ainda.', { exact: true })).toBeVisible();
    await expect(mensagens(maria)).toHaveCount(0);
    // E volta a receber as de agora.
    await escrever(bia, 'Bem-vinda de volta, Maria: recado 2f6c');
    await expect(mensagem(maria, 'recado 2f6c').locator('.mensagem-nome')).toHaveText('Bia Ramos');

    for (const p of asTres()) await p.conferirOConsole();
  });
});

// A seção 7.4 do desenho: o mosaico e o som chegam sempre, também com todos sem câmera e sem microfone, e por isso o
// sinalizador não toma a reunião parada por uma conexão ruim.
test('Conexão boa por 20 s com todos sem câmera e sem microfone', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  const paginas: Pagina[] = [];
  try {
    for (const [pessoa, nome] of [
      [A, 'Carlos Lima'],
      [B, 'Bia Ramos'],
      [C, 'Maria Lima'],
    ] as const) {
      const p = await Pagina.abrir(pessoa);
      paginas.push(p);
      await p.entrar(codigo, nome, { cameraDesligada: true });
      await expect(p.controles()).toBeVisible({ timeout: 30_000 });
      await olharOSinal(p);
      await p.botao('Microfone').click();
      await expect(p.botao('Microfone')).toHaveAttribute('aria-pressed', 'false');
      await expect(p.botao('Câmera')).toHaveAttribute('aria-pressed', 'false');
    }
    for (const p of paginas) await ateAConexaoBoa(p, 30_000);

    // O texto do botão de cada uma, lido a cada segundo, por 20 s: sempre Conexão boa. Se não for, o erro leva os
    // números do cartão daquela hora.
    for (let segundo = 1; segundo <= 20; segundo++) {
      await esperar(1_000);
      for (const p of paginas) {
        const texto = await textoDoSinal(p).innerText();
        if (texto === 'Conexão boa') continue;
        const numeros = await cartao(p).locator('.sinal-numeros').evaluate((el) => el.textContent);
        throw new Error(
          `aos ${segundo} s, o sinalizador de ${p.pessoa.letra} mostrou "${texto}", com "${numeros}"; ` +
            `antes disso: ${JSON.stringify(await vistosNoSinal(p))}`,
        );
      }
    }
    // E nenhum deles mudou entre uma leitura e outra.
    for (const p of paginas) {
      const vistos = await vistosNoSinal(p);
      expect(vistos[vistos.length - 1][1], `o sinalizador de ${p.pessoa.letra}`).toBe('Conexão boa');
      expect(
        vistos.filter(([, texto]) => texto !== 'Medindo a conexão…' && texto !== 'Conexão boa'),
        `os outros estados que o sinalizador de ${p.pessoa.letra} mostrou`,
      ).toEqual([]);
      await p.conferirOConsole();
    }
  } finally {
    for (const p of paginas) await p.fechar();
  }
});

// O FreeSWITCH manda o relatório também do vídeo de quem entrou sem câmera: o primeiro, uns 3 s depois da entrada, diz
// 255 de 256 perdidos, e fica sendo o último até o seguinte. Quem liga a câmera nesse meio tempo não pode ver, como
// perda dela, um relatório de antes de a câmera ligar. Três páginas ligam a câmera 3, 4,5 e 6 s depois de entrar.
test('quem entra sem câmera e a liga logo depois não vê a conexão ruim', async () => {
  test.setTimeout(240_000);
  const codigo = await novaReuniaoDeTeste();
  const paginas: Pagina[] = [];
  try {
    for (const [pessoa, nome, espera] of [
      [A, 'Carlos Lima', 3_000],
      [B, 'Bia Ramos', 4_500],
      [C, 'Maria Lima', 6_000],
    ] as const) {
      const p = await Pagina.abrir(pessoa);
      paginas.push(p);
      await p.entrar(codigo, nome, { cameraDesligada: true });
      await expect(p.controles()).toBeVisible({ timeout: 30_000 });
      await olharOSinal(p);
      await esperar(espera);
      await p.botao('Câmera').click();
      await expect(p.botao('Câmera')).toHaveAttribute('aria-pressed', 'true');
    }
    // Por 20 s, o botão de cada uma só mostra o Medindo e a Conexão boa.
    await esperar(20_000);
    for (const p of paginas) {
      const vistos = await vistosNoSinal(p);
      expect(
        vistos.filter(([, texto]) => texto !== 'Medindo a conexão…' && texto !== 'Conexão boa'),
        `os outros estados que o sinalizador de ${p.pessoa.letra} mostrou, com os números da hora`,
      ).toEqual([]);
      expect(vistos[vistos.length - 1][1], `o sinalizador de ${p.pessoa.letra}, no fim`).toBe('Conexão boa');
      await p.conferirOConsole();
    }
  } finally {
    for (const p of paginas) await p.fechar();
  }
});
