import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function extensionFor(format = '') {
  return ({ jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', avif: 'avif' })[format] || format || 'bin';
}

export async function processMediaFile(sourcePath, store) {
  const bytes = await readFile(sourcePath);
  const hash = sha256(bytes);
  const image = sharp(bytes, { failOn: 'warning', animated: false }).rotate();
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error(`Imagem sem metadados válidos: ${sourcePath}`);
  }

  const extension = extensionFor(metadata.format);
  const originalKey = `original/${hash}.${extension}`;
  const webKey = `web/${hash}.webp`;
  const thumbKey = `thumb/${hash}.webp`;

  const web = await sharp(bytes, { failOn: 'warning', animated: false })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  const thumb = await sharp(bytes, { failOn: 'warning', animated: false })
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  const [originalStored, webStored, thumbStored] = await Promise.all([
    store.put(originalKey, bytes),
    store.put(webKey, web.data),
    store.put(thumbKey, thumb.data)
  ]);

  return {
    id: `m_${hash.slice(0, 20)}`,
    hash,
    width: metadata.width,
    height: metadata.height,
    bytes: bytes.length,
    format: metadata.format,
    url: webStored.url,
    thumbnailUrl: thumbStored.url,
    downloadUrl: originalStored.url,
    web: {
      width: web.info.width,
      height: web.info.height,
      bytes: web.data.length,
      format: 'webp'
    },
    thumbnail: {
      width: thumb.info.width,
      height: thumb.info.height,
      bytes: thumb.data.length,
      format: 'webp'
    }
  };
}
