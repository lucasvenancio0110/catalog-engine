import { describe, expect, it, vi } from 'vitest';
import {
  PortalStoreCreationError,
  buildPortalStoreCreationPayload,
  normalizePortalStoreSlug,
  requestPortalStoreCreation
} from '../src/app/store-creation.js';

describe('portal store creation client', () => {
  it('normalizes merchant names into backend-compatible slugs', () => {
    expect(normalizePortalStoreSlug('  Loja São Paulo / 2026  ')).toBe('loja-sao-paulo-2026');
    expect(normalizePortalStoreSlug('---Arena___Store---')).toBe('arena-store');
  });

  it('builds the minimal PB3 payload without branding, domain or source fields', () => {
    expect(
      buildPortalStoreCreationPayload({
        name: 'Loja Arena',
        slug: 'Loja Arena',
        currency: 'brl',
        themeKey: 'stadium',
        customDomain: 'example.com',
        sourceUrl: 'https://supplier.example/'
      })
    ).toEqual({
      name: 'Loja Arena',
      slug: 'loja-arena',
      currency: 'BRL'
    });
  });

  it.each([
    [{ name: 'A', slug: 'loja-a', currency: 'BRL' }, 'invalid_store_name'],
    [{ name: 'Loja', slug: 'ab', currency: 'BRL' }, 'invalid_store_slug'],
    [{ name: 'Loja', slug: 'loja', currency: 'REAL' }, 'invalid_store_currency']
  ])('fails closed for invalid merchant input', (input, code) => {
    expect(() => buildPortalStoreCreationPayload(input)).toThrowError(
      expect.objectContaining({ code })
    );
  });

  it('posts the authenticated minimal payload and accepts a new 201 store', async () => {
    const fetchImpl = vi.fn(async (_url, init) =>
      new Response(
        JSON.stringify({
          store: {
            tenantId: 't_0123456789abcdefabcd',
            slug: 'loja-arena',
            title: 'Loja Arena',
            currency: 'BRL',
            status: 'running',
            currentStep: 'tenant'
          },
          replayed: false
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await requestPortalStoreCreation({
      token: 'access-token',
      input: { name: 'Loja Arena', slug: 'loja-arena', currency: 'BRL' },
      fetchImpl
    });

    expect(result.status).toBe(201);
    expect(result.replayed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/admin/stores');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.headers.authorization).toBe('Bearer access-token');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Loja Arena',
      slug: 'loja-arena',
      currency: 'BRL'
    });
  });

  it('accepts an idempotent 200 replay as success', async () => {
    const result = await requestPortalStoreCreation({
      token: 'access-token',
      input: { name: 'Loja Arena', slug: 'loja-arena', currency: 'BRL' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            store: { tenantId: 't_0123456789abcdefabcd', slug: 'loja-arena' },
            replayed: true
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    });

    expect(result.status).toBe(200);
    expect(result.replayed).toBe(true);
  });

  it('surfaces server error codes without leaking response details', async () => {
    await expect(
      requestPortalStoreCreation({
        token: 'access-token',
        input: { name: 'Loja Arena', slug: 'loja-arena', currency: 'BRL' },
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: 'store_slug_unavailable', internal: 'do-not-use' }), {
            status: 409,
            headers: { 'content-type': 'application/json' }
          })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'PortalStoreCreationError',
        code: 'store_slug_unavailable',
        status: 409
      })
    );
  });

  it('rejects a success response that does not contain a merchant store object', async () => {
    await expect(
      requestPortalStoreCreation({
        token: 'access-token',
        input: { name: 'Loja Arena', slug: 'loja-arena', currency: 'BRL' },
        fetchImpl: async () => new Response('{}', { status: 201 })
      })
    ).rejects.toBeInstanceOf(PortalStoreCreationError);
  });
});
