import { describe, expect, it } from 'vitest';
import {
  contentFingerprint,
  publicProductId,
  publicScopeIdentity,
  reconcileScopedSyncState
} from '../scripts/catalog-sync.mjs';

const t1 = '2026-08-16T10:00:00.000Z';
const t2 = '2026-08-16T11:00:00.000Z';
const t3 = '2026-08-16T12:00:00.000Z';
const t4 = '2026-08-16T13:00:00.000Z';

function observed(sourceId, name = `Produto ${sourceId}`) {
  return {
    publicId: publicProductId('yupoo', sourceId),
    contentHash: contentFingerprint({
      name,
      category: 'Teste',
      description: '',
      sourceImages: [`https://photo.example/${sourceId}.jpg`]
    })
  };
}

describe('publicScopeIdentity', () => {
  it('normalizes transient pagination/query parameters into the same catalog scope', () => {
    const base = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/albums/');
    const paged = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/albums/?page=3&tab=gallery&uid=1');
    expect(base).toEqual(paged);
    expect(base.kind).toBe('catalog');
    expect(base.id).toMatch(/^s_[a-f0-9]{20}$/);
  });

  it('creates distinct opaque category scopes without exposing raw category IDs', () => {
    const brazil = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/categories/490727');
    const saoPaulo = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/categories/66243');
    expect(brazil.kind).toBe('category');
    expect(saoPaulo.kind).toBe('category');
    expect(brazil.id).not.toBe(saoPaulo.id);
    expect(brazil.id).not.toContain('490727');
    expect(saoPaulo.id).not.toContain('66243');
  });

  it('separates identical paths from different suppliers', () => {
    const a = publicScopeIdentity('yupoo', 'https://a.x.yupoo.com/categories/123');
    const b = publicScopeIdentity('yupoo', 'https://b.x.yupoo.com/categories/123');
    expect(a.id).not.toBe(b.id);
  });
});

describe('reconcileScopedSyncState', () => {
  it('keeps a product globally active when it leaves one complete scope but still belongs to another', () => {
    const catalog = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/albums/');
    const category = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/categories/490727');
    const p1 = observed('1');
    const shared = observed('2');
    const p3 = observed('3');

    let state = reconcileScopedSyncState(null, [p1, shared], {
      scopeId: catalog.id,
      scopeKind: catalog.kind,
      complete: false,
      now: t1
    });
    state = reconcileScopedSyncState(state, [shared, p3], {
      scopeId: category.id,
      scopeKind: category.kind,
      complete: false,
      now: t2
    });

    const categoryComplete = reconcileScopedSyncState(state, [p3], {
      scopeId: category.id,
      scopeKind: category.kind,
      complete: true,
      now: t3
    });

    expect(categoryComplete.changes.detached).toEqual([shared.publicId]);
    expect(categoryComplete.changes.removed).toEqual([]);
    expect(categoryComplete.products[shared.publicId].status).toBe('active');
    expect(categoryComplete.scopes[catalog.id].members).toContain(shared.publicId);
    expect(categoryComplete.scopes[category.id].members).not.toContain(shared.publicId);
  });

  it('removes globally only after the product has no active scope membership left', () => {
    const catalog = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/albums/');
    const category = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/categories/490727');
    const shared = observed('2');

    let state = reconcileScopedSyncState(null, [shared], {
      scopeId: catalog.id,
      scopeKind: catalog.kind,
      complete: false,
      now: t1
    });
    state = reconcileScopedSyncState(state, [shared], {
      scopeId: category.id,
      scopeKind: category.kind,
      complete: false,
      now: t2
    });
    state = reconcileScopedSyncState(state, [], {
      scopeId: category.id,
      scopeKind: category.kind,
      complete: true,
      now: t3
    });
    expect(state.products[shared.publicId].status).toBe('active');

    state = reconcileScopedSyncState(state, [], {
      scopeId: catalog.id,
      scopeKind: catalog.kind,
      complete: true,
      now: t4
    });
    expect(state.changes.removed).toEqual([shared.publicId]);
    expect(state.products[shared.publicId].status).toBe('removed');
  });

  it('does not detach memberships in a partial scope scan', () => {
    const category = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/categories/490727');
    const p1 = observed('1');
    const p2 = observed('2');
    let state = reconcileScopedSyncState(null, [p1, p2], {
      scopeId: category.id,
      scopeKind: category.kind,
      complete: false,
      now: t1
    });

    state = reconcileScopedSyncState(state, [p1], {
      scopeId: category.id,
      scopeKind: category.kind,
      complete: false,
      now: t2
    });

    expect(state.changes.detached).toEqual([]);
    expect(state.changes.removed).toEqual([]);
    expect(state.changes.unobserved).toEqual([p2.publicId]);
    expect(state.scopes[category.id].members).toContain(p2.publicId);
  });

  it('migrates schema v1 into the active catalog scope without exposing legacy source identity', () => {
    const catalog = publicScopeIdentity('yupoo', 'https://supplier.x.yupoo.com/albums/');
    const p1 = observed('1');
    const legacy = {
      schemaVersion: 1,
      generatedAt: t1,
      scope: { complete: false },
      products: {
        [p1.publicId]: {
          contentHash: p1.contentHash,
          firstSeenAt: t1,
          lastSeenAt: t1,
          status: 'active',
          removedAt: null
        }
      }
    };

    const migrated = reconcileScopedSyncState(legacy, [p1], {
      scopeId: catalog.id,
      scopeKind: catalog.kind,
      complete: false,
      now: t2
    });

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.scopes[catalog.id].members).toEqual([p1.publicId]);
    expect(JSON.stringify(migrated)).not.toContain('supplier.x.yupoo.com');
  });
});
