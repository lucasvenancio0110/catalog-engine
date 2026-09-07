import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { handleInstantSeedMessage } from '../worker/instant-seed-consumer.js';
import {
  assertPublicSafeInstantSeedMessage,
  buildInstantSeedMessage,
  parseInstantSeedMessage
} from '../worker/instant-seed-queue.js';

const tenantId = 't_0123456789abcdefabcd';
const privateSource = 'https://supplier.x.yupoo.com/albums/';

function dbReturning(row) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => row)
      }))
    }))
  };
}

function constructionNamespace(initialProjection = null) {
  let projection =
    initialProjection || {
      version: 1,
      readiness: 'empty',
      ready: false,
      complete: false,
      productCount: 0,
      products: [],
      updatedAt: null
    };
  const writes = [];
  const stub = {
    fetch: vi.fn(async (input, init = {}) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/projection') return Response.json(projection);
      if (pathname === '/seed' && init.method === 'PUT') {
        const seed = JSON.parse(init.body);
        writes.push(seed);
        projection = {
          version: 1,
          readiness: 'indexed',
          ready: seed.items.length >= 12,
          complete: false,
          productCount: seed.items.length,
          products: seed.items.map((item) => ({
            id: item.productId,
            title: item.title,
            coverMediaId: item.cover?.mediaId || null,
            categories: item.categories || []
          })),
          updatedAt: seed.observedAt
        };
        return Response.json({ ok: true, revision: 1 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    })
  };
  return {
    binding: {
      idFromName: vi.fn((value) => `id:${value}`),
      get: vi.fn(() => stub)
    },
    stub,
    writes
  };
}

function seed(count = 12) {
  return {
    seedId: 'cs_0123456789abcdefabcd',
    readiness: 'indexed',
    complete: false,
    observedAt: '2026-09-07T03:55:00.000Z',
    items: Array.from({ length: count }, (_, index) => ({
      productId: `p_${String(index).padStart(20, '0')}`,
      title: `Produto ${index + 1}`,
      listingFingerprint: 'a'.repeat(64),
      sourceItemUrl: `https://supplier.x.yupoo.com/albums/${1000 + index}`,
      cover: {
        mediaId: `cm_${String(index).padStart(20, '0')}`,
        sourceUrl: `https://photo.yupoo.com/supplier/${1000 + index}.jpg`
      },
      categories: []
    }))
  };
}

describe('IC2 instant seed Queue contract', () => {
  it('keeps delivery minimal and free from private provider/runtime locators', () => {
    const message = assertPublicSafeInstantSeedMessage(
      buildInstantSeedMessage({ tenantId, sourceKey: 'primary' })
    );
    expect(message).toEqual({
      v: 1,
      type: 'instant-seed',
      tenantId,
      sourceKey: 'primary'
    });
    expect(JSON.stringify(message)).not.toMatch(/https?:\/\/|yupoo|provider|sourceUrl|locator|d1|worker/i);
    expect(parseInstantSeedMessage(message)).toEqual(message);
  });

  it('rejects extra fields so a raw source URL cannot be smuggled into Queue payloads', () => {
    expect(() =>
      parseInstantSeedMessage({
        ...buildInstantSeedMessage({ tenantId }),
        sourceUrl: privateSource
      })
    ).toThrow(/instant_seed_message_invalid/);
  });

  it('resolves current confirmed source authority server-side and writes only to that tenant construction object', async () => {
    const construction = constructionNamespace();
    const previewSeed = vi.fn(async () => seed(12));
    const resolveProvider = vi.fn(() => ({ previewSeed }));
    const db = dbReturning({ provider: 'yupoo', source_url: privateSource });

    const result = await handleInstantSeedMessage(
      buildInstantSeedMessage({ tenantId }),
      { CATALOG_DB: db, TENANT_CONSTRUCTION_STATE: construction.binding },
      { resolveProvider }
    );

    expect(result).toEqual({ outcome: 'success', state: 'seeded', productCount: 12 });
    expect(construction.binding.idFromName).toHaveBeenCalledWith(tenantId);
    expect(resolveProvider).toHaveBeenCalledWith('yupoo');
    expect(previewSeed).toHaveBeenCalledWith(privateSource, { maxItems: 24, deadlineMs: 4500 });
    expect(construction.writes).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(privateSource);
  });

  it('acks logically stale authority without contacting a provider', async () => {
    const construction = constructionNamespace();
    const resolveProvider = vi.fn();
    const result = await handleInstantSeedMessage(
      buildInstantSeedMessage({ tenantId }),
      {
        CATALOG_DB: dbReturning(null),
        TENANT_CONSTRUCTION_STATE: construction.binding
      },
      { resolveProvider }
    );
    expect(result).toEqual({ outcome: 'stale', code: 'instant_seed_authority_stale' });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it('does not refetch the supplier when duplicate delivery finds an existing L0 seed', async () => {
    const construction = constructionNamespace({
      version: 1,
      readiness: 'indexed',
      ready: true,
      complete: false,
      productCount: 12,
      products: [],
      updatedAt: '2026-09-07T03:55:00.000Z'
    });
    const resolveProvider = vi.fn();
    const db = dbReturning({ provider: 'yupoo', source_url: privateSource });
    const result = await handleInstantSeedMessage(
      buildInstantSeedMessage({ tenantId }),
      { CATALOG_DB: db, TENANT_CONSTRUCTION_STATE: construction.binding },
      { resolveProvider }
    );
    expect(result).toEqual({ outcome: 'success', state: 'already_seeded', productCount: 12 });
    expect(db.prepare).not.toHaveBeenCalled();
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it('keeps the private consumer bounded and bound to the existing main-worker Durable Object namespace', async () => {
    const config = JSON.parse(await readFile('wrangler.instant-seed.jsonc', 'utf8'));
    expect(config.name).toBe('catalog-engine-instant-seed');
    expect(config.main).toBe('./worker/instant-seed-entry.js');
    expect(config.workers_dev).toBe(false);
    expect(config.d1_databases).toHaveLength(1);
    expect(config.d1_databases[0].binding).toBe('CATALOG_DB');
    expect(config.durable_objects.bindings).toEqual([
      {
        name: 'TENANT_CONSTRUCTION_STATE',
        class_name: 'TenantConstructionState',
        script_name: 'catalog-engine'
      }
    ]);
    expect(config.queues.consumers).toEqual([
      {
        queue: 'catalog-engine-instant-seed',
        max_batch_size: 1,
        max_batch_timeout: 1,
        max_retries: 3,
        dead_letter_queue: 'catalog-engine-instant-seed-dlq',
        max_concurrency: 2,
        retry_delay: 15
      }
    ]);
  });

  it('deploys Queue infrastructure only from trusted main, never from pull_request validation', async () => {
    const workflow = await readFile('.github/workflows/deploy-instant-seed-consumer.yml', 'utf8');
    expect(workflow).toContain("branches: ['main']");
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
    expect(workflow).toContain('queues create "$queue"');
    expect(workflow).toContain('deploy --config wrangler.instant-seed.jsonc');
    expect(workflow).toContain('queues consumer worker list catalog-engine-instant-seed --json');
  });
});
