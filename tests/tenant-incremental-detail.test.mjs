import { describe, expect, it } from 'vitest';
import { buildIncrementalCandidateDetailBatch } from '../worker/ingestion/incremental-detail-consumer.js';

const context = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary'
};

const evidence = {
  albumSourceId: '100',
  publicProductId: 'p_100',
  sourceUrl: 'https://supplier.example/albums/100',
  sourceTitle: 'Supplier title',
  sourceCategoryId: '10',
  listingFingerprint: 'listing-fp',
  eventType: 'CHANGED',
  categoryPath: [
    { sourceId: '1', name: 'Football', parentSourceId: null, depth: 0 },
    { sourceId: '10', name: 'Club Shirts', parentSourceId: '1', depth: 1 }
  ]
};

const detail = {
  name: 'Example Product',
  description: 'Description',
  images: [
    {
      sourceUrl: 'https://cdn.example/1.jpg',
      displaySourceUrl: 'https://cdn.example/1-display.jpg',
      thumbnailSourceUrl: 'https://cdn.example/1-thumb.jpg'
    },
    { sourceUrl: 'https://cdn.example/2.jpg' }
  ],
  classification: { entityType: 'product' },
  detailFingerprint: 'detail-fp'
};

const provider = {
  key: 'test-provider',
  contractVersion: 1,
  publicCategoryId: async (sourceId) => `cat_${sourceId}`,
  mediaId: async (sourceUrl) => `media_${sourceUrl.endsWith('1.jpg') ? '1' : '2'}`
};

function mutatingSql(batch) {
  return batch.map((entry) => String(entry.sql || '')).filter((sql) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql));
}

describe('M7D4 staged affected detail writes', () => {
  it('builds only run-scoped candidate mutations and leaves CEI/promotion out of scope', async () => {
    const result = await buildIncrementalCandidateDetailBatch({
      context,
      evidence,
      detail,
      claimToken: 'claim-1',
      provider
    });

    expect(result.media).toHaveLength(2);
    expect(result.categories).toHaveLength(2);
    const mutations = mutatingSql(result.batch);
    expect(mutations.length).toBeGreaterThan(0);
    expect(
      mutations.every((sql) =>
        /supplier_sync_stage_(?:catalog_categories|media_sources|product_details|product_media|product_categories)/i.test(
          sql
        )
      )
    ).toBe(true);
    expect(
      mutations.some((sql) =>
        /\b(?:catalog_products|catalog_product_intelligence_state|supplier_album_index|media_sources|product_media|supplier_sync_stage_classification_state|supplier_sync_stage_intelligence_state)\b/i.test(
          sql
        )
      )
    ).toBe(false);

    const detailUpdate = result.batch.find((entry) =>
      String(entry.sql).includes("SET detail_state='complete'")
    );
    expect(detailUpdate).toBeTruthy();
    expect(detailUpdate.sql).toContain("claim_token=?20 AND detail_state='processing'");
    expect(detailUpdate.params).toContain('detail-fp');
    expect(detailUpdate.params).toContain('claim-1');
  });

  it('keeps normalized private evidence bounded before any D1 write plan is returned', async () => {
    await expect(
      buildIncrementalCandidateDetailBatch({
        context,
        evidence,
        detail: { ...detail, description: 'x'.repeat(270_000) },
        claimToken: 'claim-2',
        provider
      })
    ).rejects.toThrow('sync_detail_evidence_too_large');
  });

  it('orders candidate category parents and media before the complete-state product update', async () => {
    const result = await buildIncrementalCandidateDetailBatch({
      context,
      evidence,
      detail,
      claimToken: 'claim-3',
      provider
    });
    const categoryIndex = result.batch.findIndex((entry) =>
      String(entry.sql).includes('INSERT INTO supplier_sync_stage_catalog_categories')
    );
    const mediaIndex = result.batch.findIndex((entry) =>
      String(entry.sql).includes('INSERT INTO supplier_sync_stage_media_sources')
    );
    const completeIndex = result.batch.findIndex((entry) =>
      String(entry.sql).includes("SET detail_state='complete'")
    );
    const relationIndex = result.batch.findIndex((entry) =>
      String(entry.sql).includes('INSERT OR IGNORE INTO supplier_sync_stage_product_categories')
    );

    expect(categoryIndex).toBeGreaterThanOrEqual(0);
    expect(mediaIndex).toBeGreaterThan(categoryIndex);
    expect(completeIndex).toBeGreaterThan(mediaIndex);
    expect(relationIndex).toBeGreaterThan(completeIndex);
  });
});
