import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  choosePreviewAuthority,
  realConstructionCount,
  requestPortalConstructionMedia,
  requestPortalConstructionPreview,
  validateConstructionProjection
} from '../src/app/construction-preview.js';

const tenantId = 't_0123456789abcdefabcd';
const token = 'access_test';

function product(index) {
  const suffix = index.toString(16).padStart(20, '0');
  return {
    id: `p_${suffix}`,
    title: `Produto ${index}`,
    coverMediaId: `cm_${suffix}`,
    categories: []
  };
}

function projection(count = 12, overrides = {}) {
  return {
    version: 1,
    readiness: count ? 'indexed' : 'empty',
    ready: count >= 12,
    complete: false,
    productCount: count,
    products: Array.from({ length: Math.min(count, 24) }, (_, index) => product(index + 1)),
    updatedAt: count ? '2026-09-07T04:30:00.000Z' : null,
    ...overrides
  };
}

describe('IC2 portal construction preview client', () => {
  it('accepts only the bounded opaque projection contract', () => {
    const parsed = validateConstructionProjection(projection(12));
    expect(parsed.ready).toBe(true);
    expect(parsed.productCount).toBe(12);
    expect(parsed.products).toHaveLength(12);
    expect(JSON.stringify(parsed)).not.toMatch(/https?:\/\/|yupoo|sourceUrl|worker|d1/i);
  });

  it('fails closed when a browser projection contains private or inconsistent evidence', () => {
    expect(() => validateConstructionProjection({
      ...projection(12),
      sourceUrl: 'https://private.example/catalog'
    })).toThrowError('construction_preview_invalid_response');

    expect(() => validateConstructionProjection(projection(11, { ready: true })))
      .toThrowError('construction_preview_invalid_response');

    expect(() => validateConstructionProjection(projection(0, {
      readiness: 'empty',
      ready: false,
      productCount: 1,
      products: []
    }))).toThrowError('construction_preview_invalid_response');
  });

  it('requests construction state with membership bearer auth and no locator in the URL', async () => {
    const fetchImpl = vi.fn(async (input, init) => {
      expect(String(input)).toBe(`/api/admin/stores/${tenantId}/construction-preview`);
      expect(init.method).toBe('GET');
      expect(init.cache).toBe('no-store');
      expect(init.headers.authorization).toBe(`Bearer ${token}`);
      return Response.json(projection(12));
    });

    const result = await requestPortalConstructionPreview({ tenantId, token, fetchImpl });
    expect(result.ready).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('loads an opaque construction image through the authenticated proxy only', async () => {
    const mediaId = 'cm_00000000000000000001';
    const fetchImpl = vi.fn(async (input, init) => {
      expect(String(input)).toBe(`/api/admin/stores/${tenantId}/construction-media/${mediaId}`);
      expect(init.headers.authorization).toBe(`Bearer ${token}`);
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      });
    });

    const blob = await requestPortalConstructionMedia({ tenantId, mediaId, token, fetchImpl });
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('image/jpeg');
  });

  it('gives verified L2 authority precedence but allows real L0 readiness before it', () => {
    expect(choosePreviewAuthority({ verifiedReady: false, construction: projection(12) })).toBe('construction');
    expect(choosePreviewAuthority({ verifiedReady: true, construction: projection(12) })).toBe('verified');
    expect(choosePreviewAuthority({ verifiedReady: false, construction: projection(4) })).toBe(null);
    expect(realConstructionCount(projection(4))).toBe(4);
  });

  it('wires the branded creation flow to real construction state without supplier locators', () => {
    const source = fs.readFileSync('src/app/provisioning-progress-experience.js', 'utf8');
    expect(source).toContain('requestPortalConstructionPreview');
    expect(source).toContain("'Ver loja em construção'");
    expect(source).toContain("new PQueue({ concurrency: 3 })");
    expect(source).toContain('requestPortalConstructionMedia');
    expect(source).toContain("authority === 'verified'");
    expect(source).not.toMatch(/photo\.yupoo|\.x\.yupoo\.com|sourceUrl|worker locator|d1 uuid/i);
  });
});
