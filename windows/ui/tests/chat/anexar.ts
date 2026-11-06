// Os arquivos e as fotos das specs do chat (as de arquivos.spec.ts, fotos.spec.ts e ponta-a-ponta.spec.ts): escolher
// pelo clipe (a janela de escolher do Windows), arrastar para a conversa e fazer uma imagem num canvas da página. O
// envio de uma foto com a miniatura, como um app a manda, é o enviarFoto da ApiDeTeste (servidor.ts).
import type { Page } from '@playwright/test';

export interface ArquivoDeTeste {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Escolhe os arquivos pelo clipe (a janela de escolher do Windows). */
export async function escolher(page: Page, arquivos: ArquivoDeTeste[]): Promise<void> {
  const janela = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Anexar um arquivo ou uma foto' }).click();
  await (await janela).setFiles(arquivos);
}

/**
 * Arrasta para a conversa arquivos feitos na página (um `drop` com um DataTransfer, como o do Windows), de `tamanho`
 * bytes cada. true: a conversa tomou o drop para ela (o preventDefault: o navegador não abre o arquivo).
 */
export async function arrastar(page: Page, arquivos: Array<{ nome: string; tipo: string; tamanho: number }>): Promise<boolean> {
  const dados = await page.evaluateHandle((lista) => {
    const dt = new DataTransfer();
    for (const a of lista) dt.items.add(new File([new Uint8Array(a.tamanho)], a.nome, { type: a.tipo }));
    return dt;
  }, arquivos);
  return page
    .locator('[role="log"]')
    .evaluate((log, dt) => !log.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })), dados);
}

/**
 * Uma imagem feita num canvas da página, de largura × altura e do tipo dado: o JPEG de uma miniatura, como a de um app,
 * ou um PNG (uma foto).
 */
export async function imagemDaPagina(page: Page, largura: number, altura: number, tipo: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ l, a, t }) => {
      const c = document.createElement('canvas');
      c.width = l;
      c.height = a;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0c2671';
      g.fillRect(0, 0, l, a);
      g.fillStyle = '#00c2cb';
      g.fillRect(l / 4, a / 4, l / 2, a / 2);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(l / 2, a / 2, Math.min(l, a) / 8, 0, Math.PI * 2);
      g.fill();
      const imagem = await new Promise<Blob>((pronto) => c.toBlob((b) => pronto(b!), t, 0.8));
      let texto = '';
      for (const b of new Uint8Array(await imagem.arrayBuffer())) texto += String.fromCharCode(b);
      return btoa(texto);
    },
    { l: largura, a: altura, t: tipo },
  );
  return Buffer.from(base64, 'base64');
}
