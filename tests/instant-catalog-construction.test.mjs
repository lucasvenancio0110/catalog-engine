import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyConstructionSeed,
  constructionProjection,
  constructionStateContract,
  normalizeConstructionSeed,
  privateConstructionMedia
} from '../worker/instant-catalog-construction.js';
import { handlePortalConstructionPreviewRequest } from '../worker/portal-construction-preview.js';

const tenantId = 't_0123456789abcdefabcd';

function seed(count = 12) {
  return {
    seedId: 'cs_0123456789abcdefabcd',
    readiness: 'indexed',
    complete: false,
    observedAt: '2026-09-07T03:40:00.000Z',
    items: Array.from({ length: count }, (_, index) => {
      const hex = index.toString(16).padStart(20, '0');
      return {
        productId: `p_${hex}`,
        title: `Produto ${index + 1}`,
        listingFingerprint: `${index.toString(16).padStart(64, '0')}`,
        sourceItemUrl: `https://supplier.x.yupoo.com/albums/${1000 + index}`,
        cover: {
          mediaId: `cm_${hex}`,
          sourceUrl: `https://photo.yupoo.com/supplier/${1000 + index}.jpg`
        },
        categories: ['Tênis']
      };
    })
  };
}

function fakeDb({ membership = true } = {}) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return membership ? { role: 'owner' } : null;
            }
          };
        }
      };
    }
  };
}

function fakeNamespace(projection) {
  return {
    idFromName(value) {
      return `do:${value}`;
    },
    get(id) {
      return {
        async fetch() {
          expect(id).toBe(`do:${tenantId}`);
          return new Response(JSON.stringify(projection), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
      };
    }
  };
}

const authenticate = async () => ({ principalId: 'principal_test', expiresAt: null });

describe('IC2 tenant construction state', () => {
  it('accepts only bounded non-authoritative indexed seeds', () => {
    const normalized = normalizeConstructionSeed(seed(12));
    expect(normalized).toMatchObject({
      version: 1,
      readiness: 'indexed',
      complete: false
    });
    expect(normalized.items).toHaveLength(12);
    expect(() => normalizeConstructionSeed({ ...seed(), complete: true })).toThrow(
      'construction_seed_invalid'
    );
    expect(() => normalizeConstructionSeed({ ...seed(49) })).toThrow('construction_seed_invalid');
  });

  it('keeps private provider locators out of the browser-safe projection', () => {
    const state = applyConstructionSeed(null, seed(12), {
      now: '2026-09-07T03:40:01.000Z'
    });
    const projection = constructionProjection(state, { now: '2026-09-07T03:40:02.000Z' });
    expect(projection).toMatchObject({
      version: 1,
      readiness: 'indexed',
      ready: true,
      complete: false,
      productCount: 12
    });
    expect(projection.products).toHaveLength(12);
    expect(JSON.stringify(projection)).not.toMatch(
      /yupoo|https?:\/\/|sourceItemUrl|listingFingerprint|seedId|expiresAt|albumSourceId/i
    );
  });

  it('uses real product count as readiness instead of a timer', () => {
    const eleven = applyConstructionSeed(null, seed(11), {
      now: '2026-09-07T03:40:01.000Z'
    });
    const twelve = applyConstructionSeed(null, seed(12), {
      now: '2026-09-07T03:40:01.000Z'
    });
    expect(constructionProjection(eleven, { now: '2026-09-07T03:40:02.000Z' }).ready).toBe(false);
    expect(constructionProjection(twelve, { now: '2026-09-07T03:40:02.000Z' }).ready).toBe(true);
    expect(constructionStateContract.usefulProductThreshold).toBe(12);
  });

  it('is idempotent for the same seed and ignores stale observations', () => {
    const first = applyConstructionSeed(null, seed(), { now: '2026-09-07T03:40:01.000Z' });
    const duplicate = applyConstructionSeed(first, seed(), { now: '2026-09-07T03:41:00.000Z' });
    expect(duplicate).toEqual(first);

    const stale = {
      ...seed(),
      seedId: 'cs_ffffffffffffffffffff',
      observedAt: '2026-09-07T03:39:00.000Z'
    };
    expect(applyConstructionSeed(first, stale, { now: '2026-09-07T03:41:00.000Z' })).toEqual(first);
  });

  it('keeps private media lookup inside state and expires construction state', () => {
    const state = applyConstructionSeed(null, seed(), { now: '2026-09-07T03:40:01.000Z' });
    expect(
      privateConstructionMedia(state, 'cm_00000000000000000000', {
        now: '2026-09-07T03:40:02.000Z'
      })
    ).toMatchObject({ sourceUrl: 'https://photo.yupoo.com/supplier/1000.jpg' });
    expect(
      constructionProjection(state, { now: '2026-09-07T16:00:02.000Z' })
    ).toMatchObject({ readiness: 'empty', ready: false, productCount: 0 });
  });
});

describe('IC2 membership-scoped construction API', () => {
  const projection = {
    version: 1,
    readiness: 'indexed',
    ready: true,
    complete: false,
    productCount: 12,
    products: [{ id: 'p_00000000000000000000', title: 'Produto 1', coverMediaId: null, categories: [] }],
    updatedAt: '2026-09-07T03:40:01.000Z'
  };

  it('returns only safe no-store projection for an active member', async () => {
    const response = await handlePortalConstructionPreviewRequest(
      new Request(`https://app.catalogoengine.com/api/admin/stores/${tenantId}/construction-preview`),
      {
        CATALOG_DB: fakeDb(),
        TENANT_CONSTRUCTION_STATE: fakeNamespace(projection)
      },
      { authenticate }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(await response.json()).toEqual(projection);
  });

  it('fails closed for a non-member with the same 404 store boundary', async () => {
    const response = await handlePortalConstructionPreviewRequest(
      new Request(`https://app.catalogoengine.com/api/admin/stores/${tenantId}/construction-preview`),
      {
        CATALOG_DB: fakeDb({ membership: false }),
        TENANT_CONSTRUCTION_STATE: fakeNamespace(projection)
      },
      { authenticate }
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'store_not_found' });
  });
});

describe('IC2 production binding boundary', () => {
  it('binds exactly one tenant construction Durable Object while preserving publish entry and sync-off flags', () => {
    const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.main).toBe('./worker/entry-publish.js');
    expect(config.durable_objects?.bindings).toEqual([
      { name: 'TENANT_CONSTRUCTION_STATE', class_name: 'TenantConstructionState' }
    ]);
    expect(config.migrations).toContainEqual({
      tag: 'ic2-construction-state-v1',
      new_sqlite_classes: ['TenantConstructionState']
    });
    expect(config.vars.TENANT_IMPORT_AUTOMATION_ENABLED).toBe('1');
    expect(config.vars.TENANT_SYNC_AUTOMATION_ENABLED).toBe('0');
    expect(config.vars.TENANT_SYNC_ACTIVE_COHORT).toBe('');
  });

  it('exports the DO from the publish-aware entry and gates the API to Catalog Engine platform hosts', () => {
    const entry = fs.readFileSync('worker/entry-publish.js', 'utf8');
    expect(entry).toContain('export { TenantConstructionState }');
    expect(entry).toContain('handlePortalConstructionPreviewRequest');
    expect(entry).toContain('isCatalogPlatformHost');
    expect(entry).toContain("storefrontRoutingError({ reason: 'not_found', status: 404 })");
  });
});
