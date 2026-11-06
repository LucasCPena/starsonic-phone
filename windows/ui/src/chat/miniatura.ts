// A miniatura de uma foto (Task 7; docs/chat-protocolo.md, seção 6): um JPEG de até 480 px no lado maior e de até
// 204.800 bytes, feito no app de quem manda a foto. E a medida de uma imagem (a da miniatura que chega do servidor: o
// balão da foto já nasce com a altura dela).

/** O lado maior da miniatura. */
const LADO_MAIOR = 480;
/** O maior JPEG que o servidor guarda como miniatura (200 KiB). */
const MAX_BYTES = 204_800;
/** As qualidades do JPEG, da melhor para a menor, até a miniatura caber. */
const QUALIDADES = [0.8, 0.6, 0.4];

/**
 * A miniatura da foto: o createImageBitmap, a escala para caber em 480×480 (nunca maior que a foto) num canvas de
 * fundo branco (o JPEG não tem transparência) e o toBlob('image/jpeg'), com a qualidade em 0,8, depois 0,6 e 0,4, até
 * caber nos 204.800 bytes. null: a foto não abre (quebrada, ou num formato que o navegador não lê) ou não coube.
 */
export async function fazerMiniatura(arquivo: Blob): Promise<Blob | null> {
  let imagem: ImageBitmap;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    return null;
  }
  try {
    const escala = Math.min(1, LADO_MAIOR / Math.max(imagem.width, imagem.height));
    const lado = (px: number) => Math.min(LADO_MAIOR, Math.max(1, Math.round(px * escala)));
    const canvas = document.createElement('canvas');
    canvas.width = lado(imagem.width);
    canvas.height = lado(imagem.height);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    for (const qualidade of QUALIDADES) {
      const jpeg = await new Promise<Blob | null>((pronto) => canvas.toBlob(pronto, 'image/jpeg', qualidade));
      if (jpeg && jpeg.size <= MAX_BYTES) return jpeg;
    }
    return null;
  } finally {
    imagem.close();
  }
}

/** A largura e a altura de uma imagem, em px; null: ela não abre. */
export async function medirImagem(imagem: Blob): Promise<{ largura: number; altura: number } | null> {
  try {
    const aberta = await createImageBitmap(imagem);
    const medida = { largura: aberta.width, altura: aberta.height };
    aberta.close();
    return medida;
  } catch {
    return null;
  }
}
