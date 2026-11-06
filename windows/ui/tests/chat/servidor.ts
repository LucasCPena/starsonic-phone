// O servidor do chat de teste (subido pelo global-setup.ts) visto pelas specs: a página de administração, para criar
// empresas e tirar pessoas, e a ApiDeTeste, que fala a API do protocolo (docs/chat-protocolo.md) como um computador.

export const CHAT_PORTA = 4180;

export function baseDoChat(): string {
  return `http://127.0.0.1:${CHAT_PORTA}`;
}

export interface Pessoa {
  id: number;
  ramal: string;
  nome: string;
  saiu: boolean;
}

// --- A página de administração -------------------------------------------------------------------------------------

// Os cookies da sessão da administração, na memória: uma sessão por processo (uma entrada errada conta para a trava
// do endereço, então só se entra uma vez).
const cookies = new Map<string, string>();
let sessao: Promise<void> | null = null;

function guardarCookies(r: Response): void {
  for (const c of r.headers.getSetCookie()) {
    const [par, ...atributos] = c.split(';').map((p) => p.trim());
    const i = par.indexOf('=');
    const nome = par.slice(0, i);
    const valor = par.slice(i + 1);
    const apagar = valor === '' || atributos.some((a) => /^max-age=(0|-\d+)$/i.test(a));
    if (apagar) cookies.delete(nome);
    else cookies.set(nome, valor);
  }
}

/** Um pedido à página de administração, com os cookies; os redirecionamentos ficam para quem chama. */
async function admin(metodo: string, caminho: string, form?: Record<string, string>): Promise<Response> {
  const r = await fetch(baseDoChat() + caminho, {
    method: metodo,
    redirect: 'manual',
    headers: {
      cookie: [...cookies].map(([n, v]) => `${n}=${v}`).join('; '),
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  guardarCookies(r);
  return r;
}

/** O token do formulário da página (o campo escondido csrf). */
async function csrfDe(r: Response): Promise<string> {
  const html = await r.text();
  const m = /name="csrf" value="([^"]+)"/.exec(html);
  if (!m) throw new Error(`a página de administração veio sem o csrf (status ${r.status})`);
  return m[1];
}

function entrarNaAdministracao(): Promise<void> {
  sessao ??= (async () => {
    const senha = process.env.CHAT_ADMIN_SENHA;
    if (!senha) throw new Error('falta o CHAT_ADMIN_SENHA (o global-setup do chat não rodou)');
    const csrf = await csrfDe(await admin('GET', '/admin/entrar'));
    const r = await admin('POST', '/admin/entrar', { csrf, usuario: 'teste', senha });
    if (r.status !== 303) throw new Error(`a entrada na administração respondeu ${r.status}`);
  })();
  // Uma entrada que falhou não fica guardada: a próxima chamada tenta de novo.
  sessao.catch(() => {
    sessao = null;
  });
  return sessao;
}

export async function novaEmpresa(nome: string): Promise<{ id: number; codigo: string }> {
  await entrarNaAdministracao();
  const csrf = await csrfDe(await admin('GET', '/admin/empresas/nova'));
  const r = await admin('POST', '/admin/empresas', { csrf, nome });
  const local = r.headers.get('location') ?? '';
  const m = /^\/admin\/empresas\/(\d+)$/.exec(local);
  if (r.status !== 303 || !m) throw new Error(`criar a empresa respondeu ${r.status} (Location ${local})`);
  const pagina = await (await admin('GET', local)).text();
  const codigo = /STAR-[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(pagina)?.[0];
  if (!codigo) throw new Error('a página da empresa não mostra o código');
  return { id: Number(m[1]), codigo };
}

export async function tirarPessoa(empresaId: number, pessoaId: number): Promise<void> {
  await entrarNaAdministracao();
  const csrf = await csrfDe(await admin('GET', `/admin/empresas/${empresaId}`));
  const r = await admin('POST', `/admin/empresas/${empresaId}/pessoas/${pessoaId}/tirar`, { csrf });
  if (r.status !== 303) throw new Error(`tirar a pessoa respondeu ${r.status}`);
}

// --- A API do chat -------------------------------------------------------------------------------------------------

/** Liga um computador à empresa pelo código. Só com códigos certos: os errados contam para o limite de 10 por hora. */
export async function ligarComputador(codigo: string, computador: string): Promise<{ chave: string; empresa: string }> {
  const r = await fetch(`${baseDoChat()}/api/v1/computadores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codigo, computador }),
  });
  if (r.status !== 201) throw new Error(`ligar o computador respondeu ${r.status}`);
  const j = await r.json();
  return { chave: j.chave, empresa: j.empresa.nome };
}

export class ApiDeTeste {
  constructor(private readonly chave: string) {}

  async pedir(metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(baseDoChat() + caminho, {
      method: metodo,
      headers: {
        authorization: `Bearer ${this.chave}`,
        ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    return { status: r.status, json: texto ? JSON.parse(texto) : null };
  }

  private async certo(metodo: string, caminho: string, corpo: unknown, esperados: number[]): Promise<any> {
    const r = await this.pedir(metodo, caminho, corpo);
    if (!esperados.includes(r.status)) {
      throw new Error(`${metodo} ${caminho} respondeu ${r.status}: ${JSON.stringify(r.json)}`);
    }
    return r.json;
  }

  async entrar(ramal: string, nome: string): Promise<Pessoa> {
    return (await this.certo('POST', '/api/v1/pessoas/eu', { ramal, nome }, [200])).pessoa;
  }

  async criarDupla(com: number): Promise<number> {
    return (await this.certo('POST', '/api/v1/conversas', { tipo: 'dupla', com }, [200, 201])).conversa.id;
  }

  async criarGrupo(nome: string, pessoas: number[]): Promise<number> {
    return (await this.certo('POST', '/api/v1/conversas', { tipo: 'grupo', nome, pessoas }, [201])).conversa.id;
  }

  async enviarTexto(conversa: number, texto: string, idLocal: string = crypto.randomUUID()): Promise<number> {
    return (await this.certo('POST', `/api/v1/conversas/${conversa}/mensagens`, { idLocal, texto }, [200, 201]))
      .mensagem.id;
  }

  /** O POST /arquivos e o POST da mensagem com o arquivo. */
  async enviarArquivo(conversa: number, bytes: Buffer, nome: string, tipo: string): Promise<number> {
    const up = await fetch(`${baseDoChat()}/api/v1/arquivos`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.chave}`,
        'content-type': tipo,
        'x-arquivo-nome': encodeURIComponent(nome),
      },
      body: new Uint8Array(bytes),
    });
    if (up.status !== 201) throw new Error(`enviar o arquivo respondeu ${up.status}`);
    const arquivo: string = (await up.json()).arquivo.id;
    const idLocal = crypto.randomUUID();
    return (await this.certo('POST', `/api/v1/conversas/${conversa}/mensagens`, { idLocal, arquivo }, [201])).mensagem
      .id;
  }

  /** (Task 7) Um GET binário (a miniatura, o arquivo): os bytes da resposta 200. */
  async baixar(caminho: string): Promise<Buffer> {
    const r = await fetch(baseDoChat() + caminho, { headers: { authorization: `Bearer ${this.chave}` } });
    if (r.status !== 200) throw new Error(`GET ${caminho} respondeu ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  /** Todas as mensagens visíveis da conversa, da mais antiga para a mais nova (em ordem de id). */
  async mensagens(conversa: number): Promise<any[]> {
    let todas: any[] = [];
    let antes: number | null = null;
    for (;;) {
      const q = `limite=50${antes === null ? '' : `&antes=${antes}`}`;
      const j = await this.certo('GET', `/api/v1/conversas/${conversa}/mensagens?${q}`, undefined, [200]);
      const lote: any[] = j.mensagens;
      todas = [...lote, ...todas];
      if (!j.temMais || lote.length === 0) break;
      antes = lote[0].id;
    }
    return todas.sort((x, y) => x.id - y.id);
  }

  async marcarLida(conversa: number, ate: number): Promise<void> {
    await this.certo('POST', `/api/v1/conversas/${conversa}/lida`, { ate }, [204]);
  }

  /** (Task 5) As conversas da pessoa, como o servidor as manda. */
  async conversas(): Promise<any[]> {
    return (await this.certo('GET', '/api/v1/conversas', undefined, [200])).conversas;
  }

  /** (Task 5) Os membros do grupo: quem cuida primeiro, e o resto em ordem de nome. */
  async membros(conversa: number): Promise<any[]> {
    return (await this.certo('GET', `/api/v1/conversas/${conversa}/membros`, undefined, [200])).membros;
  }

  /** (Task 5) Põe as pessoas no grupo (só quem cuida). */
  async porNoGrupo(conversa: number, pessoas: number[]): Promise<void> {
    await this.certo('POST', `/api/v1/conversas/${conversa}/membros`, { pessoas }, [204]);
  }

  /** (Task 5) Tira a pessoa do grupo (só quem cuida); com o próprio id, sai dele. */
  async tirarDoGrupo(conversa: number, pessoa: number): Promise<void> {
    await this.certo('DELETE', `/api/v1/conversas/${conversa}/membros/${pessoa}`, undefined, [204]);
  }

  async desligar(): Promise<void> {
    await this.certo('DELETE', '/api/v1/computadores/eu', undefined, [204]);
  }
}

/** Uma empresa nova com um computador ligado e uma pessoa entrada em cada um. */
export async function empresaComPessoas(
  nome: string,
  pessoas: Array<{ ramal: string; nome: string }>,
): Promise<{ empresaId: number; codigo: string; pessoas: Array<{ chave: string; pessoa: Pessoa; api: ApiDeTeste }> }> {
  const { id, codigo } = await novaEmpresa(nome);
  const ligadas = [];
  for (const p of pessoas) {
    const { chave } = await ligarComputador(codigo, `PC-${p.ramal}`);
    const api = new ApiDeTeste(chave);
    ligadas.push({ chave, pessoa: await api.entrar(p.ramal, p.nome), api });
  }
  return { empresaId: id, codigo, pessoas: ligadas };
}
