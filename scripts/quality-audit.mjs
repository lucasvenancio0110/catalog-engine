import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import PQueue from 'p-queue';
import sharp from 'sharp';
import { z } from 'zod';

const imagePathSchema = z.string().regex(/^\.\/assets\/(?:catalog|media\/web)\//);
const mediaDescriptorSchema = z.object({
  id: z.string().regex(/^m_[a-f0-9]{20}$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  format: z.string().min(1),
  url: z.string().regex(/^\.\/assets\/media\/web\//),
  thumbnailUrl: z.string().regex(/^\.\/assets\/media\/thumb\//),
  downloadUrl: z.string().regex(/^\.\/assets\/media\/original\//)
}).passthrough();

const productSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().default(''),
  images: z.array(imagePathSchema).min(1),
  media: z.array(mediaDescriptorSchema).optional(),
  imageCount: z.number().int().nonnegative().optional(),
  entityType: z.literal('product').optional()
}).passthrough();

const catalogSchema = z.object({
  schemaVersion: z.number().int().min(3),
  generatedAt: z.string().min(1),
  store: z.object({
    name: z.string().min(1),
    logo: z.string().optional(),
    whatsapp: z.string().optional(),
    instagram: z.string().optional(),
    theme: z.string().optional(),
    currency: z.string().optional(),
    showDownload: z.boolean().optional(),
    showSource: z.boolean().optional()
  }).passthrough(),
  taxonomy: z.array(z.object({
    id: z.string(),
    type: z.literal('category'),
    name: z.string().min(1)
  }).passthrough()).default([]),
  products: z.array(productSchema).min(1)
}).passthrough();

async function auditImage(relativePath) {
  const localPath = resolve(process.cwd(), relativePath.replace(/^\.\//, ''));
  const file = await stat(localPath);
  const metadata = await sharp(localPath, { failOn: 'warning' }).metadata();

  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error(`Imagem inválida: ${relativePath}`);
  }

  return {
    path: relativePath,
    bytes: file.size,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format
  };
}

const raw = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const catalog = catalogSchema.parse(raw);
const serialized = JSON.stringify(catalog);

if (/x\.yupoo\.com|photo\.yupoo\.com/i.test(serialized)) {
  throw new Error('White-label gate: catálogo público contém URL da fonte Yupoo.');
}

if (catalog.schemaVersion >= 4) {
  const invalidProducts = catalog.products.filter((product) => !/^p_[a-f0-9]{20}$/.test(product.id));
  const invalidCategories = catalog.taxonomy.filter((category) => !/^c_[a-f0-9]{20}$/.test(category.id));
  const rawAssetPaths = catalog.products
    .flatMap((product) => [
      ...product.images,
      ...(product.media || []).flatMap((media) => [media.url, media.thumbnailUrl, media.downloadUrl])
    ])
    .filter((path) => /\/assets\/catalog\/\d+\//.test(path));

  if (invalidProducts.length || invalidCategories.length || rawAssetPaths.length) {
    throw new Error('White-label identity gate: catálogo contém ID/pasta pública não opaca.');
  }

  for (const product of catalog.products) {
    if (catalog.schemaVersion >= 6) {
      if (!Array.isArray(product.media) || product.media.length !== product.images.length) {
        throw new Error(`Schema 6 exige media descriptors alinhados no produto ${product.id}.`);
      }
      if (product.images.some((path) => !path.startsWith('./assets/media/web/'))) {
        throw new Error(`Schema 6 contém imagem de navegação fora do media store no produto ${product.id}.`);
      }
      if (product.media.some((media, index) => media.url !== product.images[index])) {
        throw new Error(`images e media divergiram no produto ${product.id}.`);
      }
    } else if (product.images.some((path) => !path.includes(`/assets/catalog/${product.id}/`))) {
      throw new Error(`Imagem fora do namespace público do produto ${product.id}.`);
    }
  }
}

const paths = [...new Set(catalog.products.flatMap((product) => product.images))];
const queue = new PQueue({ concurrency: 4, timeout: 20_000 });
const jobs = paths.map((path) => queue.add(() => auditImage(path), { id: path }));
const images = await Promise.all(jobs);

const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
const formats = Object.fromEntries(
  [...new Set(images.map((image) => image.format))].map((format) => [
    format,
    images.filter((image) => image.format === format).length
  ])
);

console.log(JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  products: catalog.products.length,
  taxonomyEntries: catalog.taxonomy.length,
  images: images.length,
  totalMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
  formats,
  opaqueIds: catalog.schemaVersion >= 4,
  mediaDescriptors: catalog.schemaVersion >= 6,
  concurrency: 4
}, null, 2));
