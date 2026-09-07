import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handlePortalConstructionMediaRequest } from '../worker/portal-construction-preview.js';

const tenantId = 't_0123456789abcdefabcd';
const mediaId = 'cm_0123456789abcdefabcd';
const mediaPath = `/api/admin/stores/${tenantId}/construction-media/${mediaId}`;

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

function fakeNamespace(media = null) {
  return {
    idFromName: vi.fn((value) => `do:${value}`),
    get: vi.fn((id) => ({
      async fetch(input) {
        expect(id).toBe(`do:${tenantId}`);
        expect(new URL(String(input)).pathname).toBe(`/media/${mediaId}`);
        if (!media) return Response.json({ error: 'construction_media_not_found' }, { status: 404 });
        return Response.json(media);
      }
    }))
  };
}

const authenticate = vi.fn(async () => ({ principalId: 'principal_test', expiresAt: null }));

function request(method = 'GET') {
  return new Request(`https://app.catalogoengine.com${mediaPath}`, { method });
}

function imageResponse({
  body = new Uint8Array([1, 2, 3, 4]),
  type = 'image/jpeg',
  length = 4,
  status = 200,
  headers = {}
} = {}) {
  return new Response(methodBody(status, body), {
    status,
    headers: {
      'content-type': type,
      'content-length': String(length),
      ...headers
    }
  });
}

function methodBody(status, body) {
  return [204, 205, 304].includes(status) ? null : body;
}

describe('IC2 authenticated construction media proxy', () => {
  it('streams an allowlisted image without exposing the supplier URL in the response', async () => {
    const sourceUrl = 'https://photo.yupoo.com/supplier/1000.jpg';
    const refererUrl = 'https://supplier.x.yupoo.com/albums/1000';
    const fetchImpl = vi.fn(async (input, init) => {
      expect(String(input)).toBe(sourceUrl);
      expect(init.redirect).toBe('manual');
      expect(init.headers.referer).toBe(refererUrl);
      return imageResponse();
    });

    const response = await handlePortalConstructionMediaRequest(
      request(),
      {
        CATALOG_DB: fakeDb(),
        TENANT_CONSTRUCTION_STATE: fakeNamespace({ mediaId, sourceUrl, refererUrl })
      },
      { authenticate, fetchImpl }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.arrayBuffer()).toHaveLength(4);
    expect([...response.headers.values()].join(' ')).not.toMatch(/yupoo|supplier/i);
  });

  it('fails closed for non-members before touching construction state or upstream media', async () => {
    const namespace = fakeNamespace({
      mediaId,
      sourceUrl: 'https://photo.yupoo.com/supplier/1000.jpg',
      refererUrl: 'https://supplier.x.yupoo.com/albums/1000'
    });
    const fetchImpl = vi.fn();
    const response = await handlePortalConstructionMediaRequest(
      request(),
      { CATALOG_DB: fakeDb({ membership: false }), TENANT_CONSTRUCTION_STATE: namespace },
      { authenticate, fetchImpl }
    );
    expect(response.status).toBe(404);
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a poisoned construction media locator before issuing any network request', async () => {
    const fetchImpl = vi.fn();
    const response = await handlePortalConstructionMediaRequest(
      request(),
      {
        CATALOG_DB: fakeDb(),
        TENANT_CONSTRUCTION_STATE: fakeNamespace({
          mediaId,
          sourceUrl: 'https://evil.example/steal.jpg',
          refererUrl: 'https://supplier.x.yupoo.com/albums/1000'
        })
      },
      { authenticate, fetchImpl }
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('construction_media_upstream_rejected');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows only same photo host redirects and rejects a redirect escape', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('', { status: 302, headers: { location: 'https://evil.example/image.jpg' } })
    );
    const response = await handlePortalConstructionMediaRequest(
      request(),
      {
        CATALOG_DB: fakeDb(),
        TENANT_CONSTRUCTION_STATE: fakeNamespace({
          mediaId,
          sourceUrl: 'https://photo.yupoo.com/supplier/1000.jpg',
          refererUrl: 'https://supplier.x.yupoo.com/albums/1000'
        })
      },
      { authenticate, fetchImpl }
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('construction_media_upstream_rejected');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects unbounded, oversized or active-content upstream responses', async () => {
    const media = {
      mediaId,
      sourceUrl: 'https://photo.yupoo.com/supplier/1000.jpg',
      refererUrl: 'https://supplier.x.yupoo.com/albums/1000'
    };
    for (const upstream of [
      new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }),
      imageResponse({ length: 9 * 1024 * 1024 }),
      imageResponse({ type: 'image/svg+xml' })
    ]) {
      const response = await handlePortalConstructionMediaRequest(
        request(),
        { CATALOG_DB: fakeDb(), TENANT_CONSTRUCTION_STATE: fakeNamespace(media) },
        { authenticate, fetchImpl: async () => upstream }
      );
      expect(response.status).toBe(502);
      expect(await response.text()).toBe('construction_media_upstream_rejected');
    }
  });

  it('keeps construction media on the Catalog Engine admin route, never on merchant custom domains', () => {
    const entry = fs.readFileSync('worker/entry-publish.js', 'utf8');
    expect(entry).toContain('handlePortalConstructionMediaRequest');
    expect(entry).toContain('construction-(?:preview|media\\/cm_[a-f0-9]{20})');
    expect(entry).toContain('isCatalogPlatformHost');
  });
});
