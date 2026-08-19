import { describe, expect, it } from 'vitest';
import worker from '../worker/entry.js';

function portalEnv(observedPaths) {
  return {
    CATALOG_ADMIN_HOST: 'app.catalogoengine.com',
    CATALOG_PLATFORM_HOSTS: 'catalog-engine.lucassantanals0110.workers.dev,catalogoengine.com,app.catalogoengine.com',
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        observedPaths.push(pathname);
        return new Response('<title>Catalog Engine — Portal</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
    }
  };
}

const ctx = { waitUntil() {} };

describe('Catalog Engine admin surface routing', () => {
  it('rewrites the admin root to the canonical extensionless portal asset path', async () => {
    const observedPaths = [];
    const response = await worker.fetch(
      new Request('https://app.catalogoengine.com/'),
      portalEnv(observedPaths),
      ctx
    );

    expect(response.status).toBe(200);
    expect(observedPaths).toEqual(['/app']);
    expect(await response.text()).toContain('Catalog Engine — Portal');
  });

  it('maps client-side portal routes to the same portal shell without redirecting', async () => {
    const observedPaths = [];
    const response = await worker.fetch(
      new Request('https://app.catalogoengine.com/lojas/minha-loja?tab=catalogo'),
      portalEnv(observedPaths),
      ctx
    );

    expect(response.status).toBe(200);
    expect(observedPaths).toEqual(['/app']);
  });

  it('normalizes an explicit app.html request internally instead of exposing the redirecting asset URL', async () => {
    const observedPaths = [];
    const response = await worker.fetch(
      new Request('https://app.catalogoengine.com/app.html'),
      portalEnv(observedPaths),
      ctx
    );

    expect(response.status).toBe(200);
    expect(observedPaths).toEqual(['/app']);
  });
});
