import { describe, expect, it } from 'vitest';
import { planListingDelta } from '../src/sync/listing-delta.js';

const previous = {
  sourceId: 'source-100',
  publicProductId: 'p_0123456789abcdefabcd',
  categoryId: 'cat-a',
  categoryPathIds: ['root', 'cat-a'],
  listingFingerprint: 'listing-100',
  detailFingerprint: 'detail-100',
  status: 'active',
  missCount: 0
};

describe('listing delta public identity invariant', () => {
  it('fails closed when the same private source identity resolves to a different public product id', () => {
    expect(() =>
      planListingDelta(
        [previous],
        [
          {
            sourceId: previous.sourceId,
            publicProductId: 'p_fedcba9876543210abcd',
            categoryId: previous.categoryId,
            categoryPathIds: previous.categoryPathIds,
            listingFingerprint: previous.listingFingerprint
          }
        ]
      )
    ).toThrow('sync_listing_public_identity_changed');
  });

  it('preserves normal planning when public identity remains stable', () => {
    const plan = planListingDelta(
      [previous],
      [
        {
          sourceId: previous.sourceId,
          publicProductId: previous.publicProductId,
          categoryId: previous.categoryId,
          categoryPathIds: previous.categoryPathIds,
          listingFingerprint: 'listing-100-new'
        }
      ]
    );
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].type).toBe('CHANGED');
  });
});
