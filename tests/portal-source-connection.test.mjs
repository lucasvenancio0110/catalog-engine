import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  PortalSourceConnectionError,
  buildPortalSourceConnectionPayload,
  requestPortalSourceConnection,
  requestPortalSourceState
} from '../src/app/source-connection.js';

const tenantId = 't_0123456789abcdefabcd';

describe('PB5 portal source connection client', () => {
  it('builds only the bounded Yupoo beta connection payload', () => {
    expect(buildPortalSourceConnectionPayload(' https://croccodilos.x.yupoo.com/albums/ ')).toEqual({
      sourceUrl: 'https://croccodilos.x.yupoo.com/albums/',
      sourceKey: 'primary',
      syncStrategy: 'incremental'
    });
  });

  it.each([
    ['not-a-url'],
    ['http://croccodilos.x.yupoo.com/albums/'],
    ['https://user:pass@croccodilos.x.yupoo.com/albums/'],
    ['https://croccodilos.x.yupoo.com/albums/#private']
  ])('fails closed for an unsafe browser input: %s', (sourceUrl) => {
    expect(() => buildPortalSourceConnectionPayload(sourceUrl)).toThrowError(
      expect.objectContaining({ name: 'PortalSourceConnectionError', code: 'invalid_supplier_url' })
    );
  });

  it('rejects an unreasonably large source URL before making a request', () => {
    const huge = `https://croccodilos.x.yupoo.com/albums/?q=${'a'.repeat(2050)}`;
    expect(() => buildPortalSourceConnectionPayload(huge)).toThrowError(
      expect.objectContaining({ code: 'invalid_supplier_url' })
    );
  });

  it('posts the authenticated source only to the selected store boundary', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          source: {
            connectionId: 'src_0123456789abcdefabcd',
            tenantId,
            provider: 'yupoo',
            sourceKey: 'primary',
            status: 'active',
            syncStrategy: 'incremental',
            scopeKind: 'catalog'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await requestPortalSourceConnection({
      tenantId,
      token: 'access-token',
      sourceUrl: 'https://croccodilos.x.yupoo.com/albums/',
      fetchImpl
    });

    expect(result).toEqual({
      provider: 'yupoo',
      sourceKey: 'primary',
      status: 'active',
      syncStrategy: 'incremental',
      scopeKind: 'catalog'
    });
    expect(JSON.stringify(result)).not.toMatch(/yupoo\.com|canonical|locator|connectionId/i);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`/api/admin/stores/${tenantId}/source`);
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.headers.authorization).toBe('Bearer access-token');
    expect(JSON.parse(init.body)).toEqual({
      sourceUrl: 'https://croccodilos.x.yupoo.com/albums/',
      sourceKey: 'primary',
      syncStrategy: 'incremental'
    });
  });

  it('surfaces only the bounded server error code and status', async () => {
    await expect(
      requestPortalSourceConnection({
        tenantId,
        token: 'access-token',
        sourceUrl: 'https://example.com/catalog',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: 'unsupported_supplier_host',
              internal: 'https://private.example/should-not-propagate'
            }),
            { status: 422, headers: { 'content-type': 'application/json' } }
          )
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'PortalSourceConnectionError',
        code: 'unsupported_supplier_host',
        status: 422
      })
    );
  });

  it('allows onboarding to report that no source is connected yet', async () => {
    const source = await requestPortalSourceState({
      tenantId,
      token: 'access-token',
      fetchImpl: async () =>
        new Response(JSON.stringify({ tenantId, source: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    });
    expect(source).toBeNull();
  });

  it('projects only merchant-safe connected source state from onboarding', async () => {
    const source = await requestPortalSourceState({
      tenantId,
      token: 'access-token',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            tenantId,
            source: {
              provider: 'yupoo',
              sourceKey: 'primary',
              status: 'active',
              syncStrategy: 'incremental',
              lastHealthAt: '2026-09-05T08:00:00Z',
              lastSuccessAt: null,
              lastError: null,
              sourceUrl: 'https://should-not-be-consumed.x.yupoo.com/albums/',
              sourceLocatorRef: 'loc_private'
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    });

    expect(source).toEqual({
      provider: 'yupoo',
      sourceKey: 'primary',
      status: 'active',
      syncStrategy: 'incremental',
      lastHealthAt: '2026-09-05T08:00:00Z',
      lastSuccessAt: null,
      lastError: null
    });
    expect(JSON.stringify(source)).not.toMatch(/yupoo\.com|sourceUrl|locator/i);
  });

  it('fails closed on a malformed success projection', async () => {
    await expect(
      requestPortalSourceConnection({
        tenantId,
        token: 'access-token',
        sourceUrl: 'https://croccodilos.x.yupoo.com/albums/',
        fetchImpl: async () =>
          new Response(JSON.stringify({ source: { provider: 'yupoo', status: 'active' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      })
    ).rejects.toBeInstanceOf(PortalSourceConnectionError);
  });

  it('loads PB5 without stealing the Catalog navigation from Appearance', async () => {
    const [appHtml, brandingBootstrap, sourceBootstrap] = await Promise.all([
      readFile(new URL('../app.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/branding-bootstrap.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/source-connection-bootstrap.js', import.meta.url), 'utf8')
    ]);

    expect(appHtml).toContain('/src/app/source-connection-bootstrap.js');
    expect(brandingBootstrap).not.toContain("label.textContent = 'Aparência'");
    expect(sourceBootstrap).toContain("=== 'Catálogo'");
    expect(sourceBootstrap).toContain("=== 'Aparência'");
    expect(sourceBootstrap).not.toMatch(/sourceUrl|canonicalUrl|sourceLocatorRef/);
  });
});
