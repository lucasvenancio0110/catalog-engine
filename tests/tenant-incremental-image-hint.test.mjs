import { describe, expect, it } from 'vitest';
import { planTenantIncrementalScan } from '../worker/ingestion/incremental-plan.js';
import { buildIncrementalScanBatch } from '../worker/ingestion/incremental-persistence.js';

const context = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  mode: 'incremental'
};
const scope = { id: 's_0123456789abcdefabcd', kind: 'source' };

function scanWithHint(imageCountHint) {
  return {
    complete: true,
    taxonomy: [],
    items: [
      {
        albumSourceId: '100',
        publicProductId: 'p_100',
        sourceUrl: 'https://supplier.x.yupoo.com/albums/100',
        sourceTitle: 'Product 100',
        sourceCategoryId: null,
        sourceCategoryPath: [],
        coverSourceUrl: null,
        imageCountHint,
        listingFingerprint: 'fp-100'
      }
    ]
  };
}

function batchFor(scan) {
  const plan = planTenantIncrementalScan({ previousRows: [], scan, scope });
  return buildIncrementalScanBatch({ context, scan, plan });
}

describe('incremental listing image-count evidence', () => {
  it('keeps a missing provider hint as NULL instead of inventing zero images', () => {
    const upsert = batchFor(scanWithHint(null)).find((entry) =>
      entry.sql.includes('INSERT INTO supplier_album_index')
    );
    expect(upsert.params[9]).toBeNull();
  });

  it('preserves an explicit numeric hint when the provider supplied one', () => {
    const upsert = batchFor(scanWithHint(7)).find((entry) =>
      entry.sql.includes('INSERT INTO supplier_album_index')
    );
    expect(upsert.params[9]).toBe(7);
  });
});
