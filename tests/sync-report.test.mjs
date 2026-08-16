import { describe, expect, it } from 'vitest';
import { buildSyncReport } from '../scripts/sync-report.mjs';

const beforeCatalog = {
  products: [
    { id: 'p_a', name: 'Produto Antigo' },
    { id: 'p_b', name: 'Produto Preservado' },
    { id: 'p_c', name: 'Produto Removido' }
  ]
};

const afterCatalog = {
  products: [
    { id: 'p_a', name: 'Produto Atualizado' },
    { id: 'p_b', name: 'Produto Preservado' },
    { id: 'p_d', name: 'Produto Novo' }
  ]
};

describe('buildSyncReport', () => {
  it('shows names and the partial-scan protection message', () => {
    const report = buildSyncReport({
      beforeCatalog,
      afterCatalog,
      syncState: {
        generatedAt: '2026-08-16T18:00:00.000Z',
        scope: { kind: 'catalog', complete: false, stopReason: 'product-limit' },
        summary: { new: 1, updated: 1, restored: 0, removed: 0, detached: 0, unobserved: 1 },
        changes: { new: ['p_d'], updated: ['p_a'], restored: [], removed: [], detached: [], unobserved: ['p_b'] }
      }
    });

    expect(report).toContain('**Tipo de escopo:** Catálogo geral');
    expect(report).toContain('**Escopo:** PARCIAL');
    expect(report).toContain('Proteção ativa');
    expect(report).toContain('Produto Novo');
    expect(report).toContain('Produto Atualizado');
    expect(report).toContain('Produto Preservado');
  });

  it('uses the previous catalog name for a confirmed removal', () => {
    const report = buildSyncReport({
      beforeCatalog,
      afterCatalog,
      syncState: {
        scope: { kind: 'catalog', complete: true, stopReason: 'empty-page' },
        summary: { new: 0, updated: 0, restored: 0, removed: 1, detached: 1, unobserved: 0 },
        changes: { new: [], updated: [], restored: [], removed: ['p_c'], detached: ['p_c'], unobserved: [] }
      }
    });

    expect(report).toContain('**Escopo:** COMPLETO');
    expect(report).toContain('Produto Removido');
    expect(report).not.toContain('Proteção ativa');
  });

  it('explains when a product leaves one scope but remains active in another', () => {
    const report = buildSyncReport({
      beforeCatalog,
      afterCatalog: {
        products: [
          ...afterCatalog.products,
          { id: 'p_c', name: 'Produto Removido' }
        ]
      },
      syncState: {
        scope: { kind: 'category', complete: true, stopReason: 'empty-page' },
        summary: { new: 0, updated: 0, restored: 0, removed: 0, detached: 1, unobserved: 0 },
        changes: { new: [], updated: [], restored: [], removed: [], detached: ['p_c'], unobserved: [] }
      }
    });

    expect(report).toContain('**Tipo de escopo:** Categoria');
    expect(report).toContain('Proteção entre escopos');
    expect(report).toContain('Desvinculados deste escopo');
    expect(report).toContain('Produto Removido');
    expect(report).toContain('não significa necessariamente remover da loja');
  });
});
