// O navegador de cada pessoa do teste: um Chromium com a câmera e o microfone falsos dela (midia.ts), na página do
// cliente mínimo (cliente/cliente.js), que entra pela página do chat e liga ao servidor de vídeo. Ele lê o vídeo e o
// som que chegam do FreeSWITCH: a cor em pontos do mosaico e a frequência mais forte do som.
import { chromium, test, type Browser, type Page } from '@playwright/test';
import {
  argumentosDoChromium,
  combinam,
  escuro,
  FAIXAS_DO_MOSAICO_2,
  FUNDO_DO_MOSAICO_2,
  MOSAICO_2,
  type Cor,
  type Pessoa,
  type Ponto,
} from './midia';
import { repetirAte } from './espera';
import { anotarSegredos, CHAT, PAGINA } from './servidores';

/** O Acesso de quem entra (seção 9 do protocolo); sem a senha, a ligação vai sem o X-Starsonic-Senha. */
export interface AcessoDoNavegador {
  senha?: string;
  video: { wss: string; uri: string };
}

/** Como uma ligação terminou: o código SIP da resposta final (um 403), ou null quando terminou por um BYE. */
export interface Fim {
  codigo: number | null;
  causa: string;
  originador: string;
}

export interface Mensagem {
  tipo: string;
  [campo: string]: any;
}

/** O cliente mínimo, como o cliente.js o põe em window.cliente. */
interface Cliente {
  diagnostico(): unknown;
  estatisticas(): Promise<unknown>;
  entrarPelaPagina(opcoes: { chat: string; codigo: string; nome: string }): Promise<{ bilhete: string }>;
  ligar(acesso: AcessoDoNavegador): Promise<void>;
  mensagens(): Mensagem[];
  amostra(fx: number, fy: number): Cor | null;
  faixa(x0: number, y0: number, x1: number, y1: number): { claros: number; escuros: number; total: number } | null;
  frequencia(): { hz: number; db: number } | null;
  pedirTela(): Promise<string>;
  compartilhar(senha: string): Promise<void>;
  telaNoAr(): boolean;
  pararDeCompartilhar(): Promise<void>;
  pararDeMandar(): void;
  sair(): Promise<void>;
  terminou(prazo: number): Promise<Fim | null>;
}

declare global {
  interface Window {
    cliente: Cliente;
  }
}

const texto = (x: unknown) => JSON.stringify(x);

/** Um Chromium com a câmera e o microfone de uma pessoa, na página do cliente mínimo. */
export class Navegador {
  private fechado = false;
  private readonly console: string[] = [];

  private constructor(
    readonly pessoa: Pessoa,
    private readonly browser: Browser,
    readonly page: Page,
  ) {}

  static async abrir(p: Pessoa): Promise<Navegador> {
    const browser = await chromium.launch({ args: argumentosDoChromium(p) });
    try {
      // A permissão da câmera e do microfone dada à página, como a pessoa a dá. Sem ela, o Chromium esconde o IP
      // dos candidatos atrás de um nome mDNS (<uuid>.local), que o FreeSWITCH não resolve e descarta, e a
      // ligação não acha caminho (no teste não há TURN). Com ela, a coleta dos candidatos também acaba logo.
      const contexto = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const page = await contexto.newPage();
      const n = new Navegador(p, browser, page);
      page.on('console', (m) => n.console.push(`[${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => n.console.push(`[pageerror] ${e.message}`));
      await page.goto(`${PAGINA}/`);
      await page.waitForFunction(() => window.cliente !== undefined);
      return n;
    } catch (e) {
      await browser.close();
      throw e;
    }
  }

  /** O abrir, o canal e o pedir; com o aceito, o cliente liga sozinho. O bilhete do abrir fica anotado. */
  async entrarPelaPagina(codigo: string, nome: string): Promise<void> {
    anotarSegredos({ codigo });
    anotarSegredos(await this.page.evaluate((o) => window.cliente.entrarPelaPagina(o), { chat: CHAT, codigo, nome }));
  }

  async ligar(acesso: AcessoDoNavegador): Promise<void> {
    anotarSegredos(acesso);
    await this.page.evaluate((a) => window.cliente.ligar(a), acesso);
  }

  async mensagens(): Promise<Mensagem[]> {
    const lista = await this.page.evaluate(() => window.cliente.mensagens());
    anotarSegredos(lista);
    return lista;
  }

  /** A primeira mensagem do tipo no canal da página, esperando até prazo ms. */
  async esperarMensagem(tipo: string, prazo = 20_000): Promise<Mensagem> {
    const lista = await repetirAte(
      prazo,
      200,
      () => this.mensagens(),
      (l) => l.some((x) => x.tipo === tipo),
      (l) => `${this.pessoa.letra} não recebeu ${tipo} em ${prazo / 1000} s; recebeu ${texto(l.map((x) => x.tipo))}`,
    );
    return lista.find((x) => x.tipo === tipo) as Mensagem;
  }

  private amostras(pontos: readonly Ponto[]): Promise<Array<Cor | null>> {
    return this.page.evaluate((ps) => ps.map(([x, y]) => window.cliente.amostra(x, y)), pontos);
  }

  /** O estado das ligações e do vídeo do cliente, com os contadores do RTP e do ICE, para as mensagens de erro. */
  private async diagnostico(): Promise<string> {
    try {
      return texto(
        await this.page.evaluate(async () => ({
          estado: window.cliente.diagnostico(),
          midia: await window.cliente.estatisticas(),
        })),
      );
    } catch (e) {
      return `(sem diagnóstico: ${(e as Error).message})`;
    }
  }

  /** Espera cada cor num ponto diferente do vídeo recebido, em qualquer ordem, até prazo ms. */
  async esperarCores(pontos: readonly Ponto[], cores: readonly Cor[], prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.amostras(pontos),
      (vistas) => combinam(vistas, cores),
      async (vistas) =>
        `no vídeo de ${this.pessoa.letra}, as cores ${texto(cores)} não apareceram nos pontos ${texto(pontos)} ` +
        `em ${prazo / 1000} s; as últimas vistas: ${texto(vistas)}; o cliente: ${await this.diagnostico()}`,
    );
  }

  /** Espera o mosaico de 2: as duas cores nos dois quadros e o fundo escuro em cima deles (o de 4 tem gente ali). */
  async esperarMosaicoDe2(cores: readonly Cor[], prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.amostras([...MOSAICO_2, ...FUNDO_DO_MOSAICO_2]),
      (vistas) => combinam(vistas.slice(0, 2), cores) && vistas.slice(2).every(escuro),
      async (vistas) =>
        `o vídeo de ${this.pessoa.letra} não voltou ao mosaico de 2 com ${texto(cores)} em ${prazo / 1000} s; ` +
        `as últimas vistas (os dois quadros e o fundo): ${texto(vistas)}; o cliente: ${await this.diagnostico()}`,
    );
  }

  /** Espera a faixa do nome de cada quadro do mosaico de 2 com o texto claro sobre o fundo escuro. */
  async esperarNomesNoMosaicoDe2(prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.page.evaluate((fs) => fs.map(([x0, y0, x1, y1]) => window.cliente.faixa(x0, y0, x1, y1)), FAIXAS_DO_MOSAICO_2),
      (faixas) => faixas.every((f) => f !== null && f.claros >= 20 && f.escuros >= f.total / 2),
      async (faixas) =>
        `as faixas dos nomes no vídeo de ${this.pessoa.letra} não têm texto: ${texto(faixas)}; o cliente: ${await this.diagnostico()}`,
    );
  }

  /** Espera a frequência mais forte do som recebido a até 25 Hz de hz. */
  async esperarFrequencia(hz: number, prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.page.evaluate(() => window.cliente.frequencia()),
      (f) => f !== null && f.db > -80 && Math.abs(f.hz - hz) <= 25,
      async (f) => `${this.pessoa.letra} não ouviu ${hz} Hz em ${prazo / 1000} s; o último: ${texto(f)}; o cliente: ${await this.diagnostico()}`,
    );
  }

  /** A senha da tela compartilhada, pedida pelo canal da página. */
  async pedirTela(): Promise<string> {
    const senha = await this.page.evaluate(() => window.cliente.pedirTela());
    anotarSegredos({ senha });
    return senha;
  }

  async compartilhar(senha: string): Promise<void> {
    await this.page.evaluate((s) => window.cliente.compartilhar(s), senha);
  }

  telaNoAr(): Promise<boolean> {
    return this.page.evaluate(() => window.cliente.telaNoAr());
  }

  async pararDeCompartilhar(): Promise<void> {
    await this.page.evaluate(() => window.cliente.pararDeCompartilhar());
  }

  /** Nada mais sai da ligação da câmera (a RTCPeerConnection fecha sem o BYE), com o WebSocket aberto. */
  async pararDeMandar(): Promise<void> {
    await this.page.evaluate(() => window.cliente.pararDeMandar());
  }

  async sair(): Promise<void> {
    await this.page.evaluate(() => window.cliente.sair());
  }

  /** Como a ligação da câmera terminou, esperando até prazo ms; null se ela não terminou. */
  terminou(prazo = 10_000): Promise<Fim | null> {
    return this.page.evaluate((p) => window.cliente.terminou(p), prazo);
  }

  /** Sai da reunião (o BYE das ligações) e fecha o navegador: uma ligação esquecida no FreeSWITCH mandaria a mídia
   * para uma porta que o navegador do teste seguinte pode pegar. Pode ser chamado de novo. */
  async fechar(): Promise<void> {
    if (this.fechado) return;
    try {
      await this.sair();
    } catch {
      // a página já não responde
    }
    await this.fecharAba();
  }

  /** Fecha o navegador inteiro (o browser.close()), sem o sair() e sem o BYE, como quem fecha a aba. */
  async fecharAba(): Promise<void> {
    if (this.fechado) return;
    this.fechado = true;
    try {
      await this.mensagens();
    } catch {
      // a página já não responde: o que ela tinha já foi anotado
    }
    await this.browser.close();
    try {
      await test.info().attach(`console-${this.pessoa.letra}`, { body: this.console.join('\n'), contentType: 'text/plain' });
    } catch {
      // fora de um teste
    }
  }
}
