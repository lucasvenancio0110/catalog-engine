import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { optimizeCatalogMedia } from '../scripts/media-pipeline.mjs';

async function fixtureRoot() {
  const root = await mkdtemp(resolve(tmpdir(), 'catalog-media-'));
  await mkdir(resolve(root, 'data'), { recursive: true });
  await mkdir(resolve(root, 'assets/catalog/p_one'), { recursive: true });
  await mkdir(resolve(root, 'assets/catalog/p_two'), { recursive: true });

  const source = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: { r: 210, g: 30, b: 70 } }
  }).png().toBuffer();
  await writeFile(resolve(root, 'assets/catalog/p_one/01.png'), source);
  await writeFile(resolve(root, 'assets/catalog/p_two/01.png'), source);

  await writeFile(resolve(root, 'data/catalog.json'), JSON.stringify({
    schemaVersion: 5,
    taxonomyVersion: 1,
    generatedAt: '2026-08-16T00:00:00.000Z',
    store: { name: 'Teste' },
    taxonomy: [],
    products: [
      { id: 'p_aaaaaaaaaaaaaaaaaaaa', name: 'Produto A', category: 'Teste', images: ['./assets/catalog/p_one/01.png'] },
      { id: 'p_bbbbbbbbbbbbbbbbbbbb', name: 'Produto B', category: 'Teste', images: ['./assets/catalog/p_two/01.png'] }
    ]
  }, null, 2));

  return { root, source };
}

describe('optimizeCatalogMedia', () => {
  it('preserves one original HD file, creates web/thumb derivatives and deduplicates identical content', async () => {
    const { root, source } = await fixtureRoot();
    const result = await optimizeCatalogMedia({ root });
    const [productA, productB] = result.catalog.products;
    const [a] = productA.media;
    const [b] = productB.media;

    expect(result.catalog.schemaVersion).toBe(6);
    expect(result.catalog.mediaVersion).toBe(1);
    expect(result.catalog.mediaStats.logicalImages).toBe(2);
    expect(result.catalog.mediaStats.uniqueImages).toBe(1);
    expect(result.catalog.mediaStats.duplicateReferences).toBe(1);
    expect(result.catalog.mediaStats.deduplicatedBytes).toBe(source.length);
    expect(a.hash).toBe(b.hash);
    expect(a.url).toBe(b.url);
    expect(a.downloadUrl).toBe(b.downloadUrl);
    expect(a.thumbnailUrl).toBe(b.thumbnailUrl);
    expect(productA.images).toEqual([a.url]);
    expect(productB.images).toEqual([b.url]);
    expect(a.width).toBe(1000);
    expect(a.height).toBe(800);
    expect(a.bytes).toBe(source.length);
    expect(a.downloadUrl).toMatch(/^\.\/assets\/media\/original\/[a-f0-9]{64}\.png$/);
    expect(a.url).toMatch(/^\.\/assets\/media\/web\/[a-f0-9]{64}\.webp$/);
    expect(a.thumbnailUrl).toMatch(/^\.\/assets\/media\/thumb\/[a-f0-9]{64}\.webp$/);

    await expect(stat(resolve(root, a.downloadUrl.replace(/^\.\//, '')))).resolves.toBeTruthy();
    await expect(stat(resolve(root, a.url.replace(/^\.\//, '')))).resolves.toBeTruthy();
    await expect(stat(resolve(root, a.thumbnailUrl.replace(/^\.\//, '')))).resolves.toBeTruthy();
    await expect(stat(resolve(root, 'assets/catalog'))).rejects.toThrow();

    const originalBytes = await readFile(resolve(root, a.downloadUrl.replace(/^\.\//, '')));
    expect(Buffer.compare(originalBytes, source)).toBe(0);
  });

  it('is idempotent after the catalog already contains rich media descriptors', async () => {
    const { root } = await fixtureRoot();
    const first = await optimizeCatalogMedia({ root });
    const second = await optimizeCatalogMedia({ root });

    expect(second.catalog.products.map((product) => product.images)).toEqual(
      first.catalog.products.map((product) => product.images)
    );
    expect(second.catalog.products.map((product) => product.media)).toEqual(
      first.catalog.products.map((product) => product.media)
    );
    expect(second.catalog.mediaStats).toEqual(first.catalog.mediaStats);
    expect(second.prune.removed).toBe(0);
  });
});
