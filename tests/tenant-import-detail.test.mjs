import { describe, expect, it } from 'vitest';
import { buildTenantProductWriteBatch } from '../worker/ingestion/detail-consumer.js';
import {
  fetchYupooAlbumDetailWorker,
  mediaId,
  parseYupooAlbumHtml
} from '../worker/ingestion/yupoo-detail.js';

const tenantId = 't_0123456789abcdefabcd';
const importId = 'imp_0123456789abcdefabcd';
const source = 'https://supplier.x.yupoo.com/albums/';
const album = 'https://supplier.x.yupoo.com/albums/123?uid=1';

describe('Worker-safe tenant detail ingestion', () => {
  it('sanitizes public text and selects private Yupoo media variants deterministically', async () => {
    const detail = await parseYupooAlbumHtml(
      `<html><head>
        <meta property="og:title" content="Manchester City 2026 | Album | Wholesale" />
        <meta name="description" content="New jersey https://supplier.x.yupoo.com/albums/123 WhatsApp: +5511999999999" />
      </head><body>
        <img data-origin-src="//photo.yupoo.com/supplier/group/full.jpg" />
        <img src="//photo.yupoo.com/supplier/group/small.jpg" />
      </body></html>`,
      album
    );

    expect(detail.name).toBe('Manchester City 2026');
    expect(detail.description).not.toMatch(/https?:\/\/|WhatsApp|yupoo/i);
    expect(detail.images).toHaveLength(1);
    expect(detail.images[0].sourceUrl).toBe('https://photo.yupoo.com/supplier/group/full.jpg');
    expect(detail.images[0].thumbnailSourceUrl).toBe(
      'https://photo.yupoo.com/supplier/group/small.jpg'
    );
    expect(detail.detailFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await mediaId(detail.images[0].sourceUrl)).toMatch(/^m_[a-f0-9]{20}$/);
  });

  it('rejects album redirects that leave the original supplier host', async () => {
    const fetchImpl = async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/collect' }
      });

    await expect(
      fetchYupooAlbumDetailWorker(album, source, { fetchImpl })
    ).rejects.toThrow(/supplier_(?:redirect|url)_rejected/);
  });

  it('builds idempotent public product writes while supplier URLs stay only in private media statements', async () => {
    const detail = await parseYupooAlbumHtml(
      `<html><head><meta property="og:title" content="Manchester City Home Jersey 2026" /></head><body>
        <img data-origin-src="//photo.yupoo.com/supplier/item/full.jpg" />
      </body></html>`,
      album
    );
    const context = {
      tenantId,
      importId,
      sourceKey: 'primary'
    };
    const evidence = {
      albumSourceId: '123',
      publicProductId: 'p_0123456789abcdefabcd',
      sourceUrl: album,
      sourceTitle: 'Manchester City Home Jersey 2026',
      categoryPath: [
        { sourceId: '10', name: 'Premier League', depth: 0 },
        { sourceId: '11', name: 'Manchester City', parentSourceId: '10', depth: 1 }
      ]
    };

    const write = await buildTenantProductWriteBatch({
      context,
      evidence,
      detail,
      claimToken: 'claim-test'
    });

    expect(write.normalized.team?.id).toBe('manchester-city');
    expect(write.normalized.league?.id).toBe('premier-league');
    expect(write.media).toHaveLength(1);
    const publicQueries = write.batch.filter((query) =>
      /catalog_(?:products|categories|leagues|teams|facets|product_)/.test(query.sql)
    );
    expect(JSON.stringify(publicQueries)).not.toMatch(/x\.yupoo\.com|photo\.yupoo\.com/i);
    const mediaQuery = write.batch.find((query) => query.sql.includes('INSERT INTO media_sources'));
    expect(JSON.stringify(mediaQuery.params)).toMatch(/photo\.yupoo\.com/);
    expect(JSON.stringify(mediaQuery.params)).toMatch(/supplier\.x\.yupoo\.com/);
    expect(write.batch.some((query) => query.sql.includes('ON CONFLICT(product_id) DO UPDATE'))).toBe(
      true
    );
    expect(
      write.batch.some((query) => query.sql.includes("SET state='success'"))
    ).toBe(true);
  });

  it('classifies informational supplier albums as non-products', async () => {
    const detail = await parseYupooAlbumHtml(
      `<html><head><meta property="og:title" content="Purchase tutorial and shipping instructions" /></head><body></body></html>`,
      album
    );
    expect(detail.classification.entityType).toBe('information');
  });
});
