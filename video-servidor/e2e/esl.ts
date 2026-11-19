// Um cliente pequeno do ESL do FreeSWITCH, para os testes que mandam um comando direto a ele (o esforco.spec.ts). O ESL
// do ambiente de teste atende só na própria máquina (127.0.0.1:8021). A senha entra em abrir() e nunca vai a uma
// mensagem de erro.
import { connect, type Socket } from 'node:net';

interface Recado {
  cabecalhos: Record<string, string>;
  corpo: string;
}

const PORTA = 8021;
/** O prazo de cada passo da entrada (o pedido da senha e a resposta dela). */
const PRAZO_DA_ENTRADA = 5000;

export class Esl {
  private resto = Buffer.alloc(0);
  private readonly fila: Recado[] = [];
  private espera: ((r: Recado | null) => void) | null = null;
  private fechado = false;
  /** Um comando ficou sem resposta: a resposta dele pode chegar depois, e seria tomada pela do comando seguinte. */
  private perdida = false;

  private constructor(private readonly s: Socket) {
    s.on('data', (d: Buffer) => {
      this.resto = Buffer.concat([this.resto, d]);
      this.ler();
    });
    const fim = () => {
      this.fechado = true;
      this.espera?.(null);
      this.espera = null;
    };
    s.on('close', fim);
    s.on('error', fim);
  }

  /** Separa os recados que já chegaram inteiros: os cabeçalhos, uma linha vazia e, com o Content-Length, o corpo. */
  private ler(): void {
    for (;;) {
      const corte = this.resto.indexOf('\n\n');
      if (corte < 0) return;
      const cabecalhos: Record<string, string> = {};
      for (const linha of this.resto.subarray(0, corte).toString('utf8').split('\n')) {
        const i = linha.indexOf(':');
        if (i > 0) cabecalhos[linha.slice(0, i).trim().toLowerCase()] = linha.slice(i + 1).trim();
      }
      const tamanho = Number(cabecalhos['content-length'] ?? 0);
      if (this.resto.length < corte + 2 + tamanho) return;
      const corpo = this.resto.subarray(corte + 2, corte + 2 + tamanho).toString('utf8');
      this.resto = this.resto.subarray(corte + 2 + tamanho);
      const recado = { cabecalhos, corpo };
      if (this.espera) {
        const entregar = this.espera;
        this.espera = null;
        entregar(recado);
      } else {
        this.fila.push(recado);
      }
    }
  }

  /** O próximo recado, ou null se ele não veio em prazoMs ou a ligação fechou. */
  private proximo(prazoMs: number): Promise<Recado | null> {
    const ja = this.fila.shift();
    if (ja) return Promise.resolve(ja);
    if (this.fechado) return Promise.resolve(null);
    return new Promise((ok) => {
      const relogio = setTimeout(() => {
        this.espera = null;
        ok(null);
      }, prazoMs);
      this.espera = (r) => {
        clearTimeout(relogio);
        ok(r);
      };
    });
  }

  /** Entra com a senha. Rejeita com "o ESL não atendeu", "o ESL não pediu a senha" ou "o ESL recusou a entrada", sem
   * a senha no texto. */
  static async abrir(senha: string): Promise<Esl> {
    const s = connect(PORTA, '127.0.0.1');
    await new Promise<void>((ok, falha) => {
      s.once('connect', () => ok());
      s.once('error', () => falha(new Error('o ESL não atendeu')));
    });
    const esl = new Esl(s);
    try {
      const pedido = await esl.proximo(PRAZO_DA_ENTRADA);
      if (pedido?.cabecalhos['content-type'] !== 'auth/request') throw new Error('o ESL não pediu a senha');
      s.write(`auth ${senha}\n\n`);
      const resposta = await esl.proximo(PRAZO_DA_ENTRADA);
      if (!resposta?.cabecalhos['reply-text']?.startsWith('+OK')) throw new Error('o ESL recusou a entrada');
    } catch (e) {
      esl.fechar();
      throw e;
    }
    return esl;
  }

  /** A ligação continua aberta. Depois de um null do api(), diz qual dos dois foi: o prazo (true) ou a queda (false). */
  get aberta(): boolean {
    return !this.fechado;
  }

  /** Manda "api <comando>" e devolve o corpo da resposta; null se ela não veio em prazoMs ou a ligação fechou. Um
   * comando de cada vez. Depois de um null, esta ligação não serve mais (todo comando seguinte dá null): abra outra. */
  async api(comando: string, prazoMs = 5000): Promise<string | null> {
    if (this.fechado || this.perdida) return null;
    this.s.write(`api ${comando}\n\n`);
    for (;;) {
      const r = await this.proximo(prazoMs);
      if (!r) {
        this.perdida = true;
        return null;
      }
      if (r.cabecalhos['content-type'] === 'api/response') return r.corpo;
    }
  }

  fechar(): void {
    this.s.destroy();
  }
}
