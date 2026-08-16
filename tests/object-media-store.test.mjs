import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ObjectMediaStore } from '../scripts/media/object-media-store.mjs';
import { optimizeCatalogMedia } from '../scripts/media-pipeline.mjs';

class MemoryObjectDriver {
  constructor() { this.objects = new Map(); }
  async has(key) { return this.objects.has(key); }
  async put(key, bytes, metadata = {}) { this.objects.set(key, { bytes: Buffer.from(bytes), metadata }); }
  async list() { return [...this.objects.entries()].map(([key, value]) => ({ key, bytes: value.bytes.length })); }
  async delete(key) { this.objects.delete(key); }
  async metadata(key) { const value = this.objects.get(key); return value ? { bytes: value.bytes.length } : null; }
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'catalog-object-media-'));
  await mkdir(resolve(root, 'data'), { recursive: true });
  await mkdir(resolve(root, 'assets/catalog/p_one'), { recursive: true });
  const source = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 30, g: 70, b: 210 } }
  }).jpeg({ quality: 95 }).toBuffer();
  await writeFile(resolve(root, 'assets/catalog/p_one/01.jpg'), source);
  await writeFile(resolve(root, 'data/catalog.json'), JSON.stringify({
    schemaVersion: 5,
    taxonomyVersion: 1,
    generatedAt: '2026-08-16T00:00:00.000Z',
    store: { name: 'Teste' },
    taxonomy: [],
    products: [{ id: 'p_aaaaaaaaaaaaaaaaaaaa', name: 'Produto', category: 'Teste', images: ['./assets/catalog/p_one/01.jpg'] }]
  }, null, 2));
  return { root, source };
}

describe('ObjectMediaStore', () => {
  it('stores content by stable keys while exposing CDN URLs', async () => {
    const { root, source } = await fixture();
    const driver = new MemoryObjectDriver();
    const store = new ObjectMediaStore({ driver, publicBase: 'https://cdn.example.com/catalog-media' });
    const result = await optimizeCatalogMedia({ root, store });
    const media = result.catalog.products[0].media[0];

    expect(result.catalog.schemaVersion).toBe(7);
    expect(result.catalog.mediaVersion).toBe(2);
    expect(result.catalog.mediaStats.storageMode).toBe('object');
    expect(result.catalog.mediaStats.publicBase).toBe('https://cdn.example.com/catalog-media');
    expect(media.originalKey).toBe(`original/${media.hash}.jpg`);
    expect(media.webKey).toBe(`web/${media.hash}.webp`);
    expect(media.thumbnailKey).toBe(`thumb/${media.hash}.webp`);
    expect(media.downloadUrl).toBe(`https://cdn.example.com/catalog-media/${media.originalKey}`);
    expect(media.url).toBe(`https://cdn.example.com/catalog-media/${media.webKey}`);
    expect(media.thumbnailUrl).toBe(`https://cdn.example.com/catalog-media/${media.thumbnailKey}`);
    expect(driver.objects.size).toBe(3);
    expect(Buffer.compare(driver.objects.get(media.originalKey).bytes, source)).toBe(0);
  });

  it('garbage-collects only unreferenced object keys', async () => {
    const driver = new MemoryObjectDriver();
    await driver.put('original/keep.jpg', Buffer.from('keep'));
    await driver.put('web/keep.webp', Buffer.from('keep'));
    await driver.put('thumb/keep.webp', Buffer.from('keep'));
    await driver.put('web/orphan.webp', Buffer.from('orphan'));
    const store = new ObjectMediaStore({ driver, publicBase: 'https://cdn.example.com/media' });
    const result = await store.prune(['original/keep.jpg', 'web/keep.webp', 'thumb/keep.webp']);
    expect(result.removed).toBe(1);
    expect(await driver.has('web/orphan.webp')).toBe(false);
    expect(await driver.has('original/keep.jpg')).toBe(true);
  });

  it('requires HTTPS public bases', () => {
    expect(() => new ObjectMediaStore({ driver: new MemoryObjectDriver(), publicBase: 'http://cdn.example.com/media' })).toThrow(/HTTPS/);
  });
});
