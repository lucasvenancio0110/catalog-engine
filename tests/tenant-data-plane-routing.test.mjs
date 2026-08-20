import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/entry.js';
import { TENANT_DATA_PLANE_COMMAND_PATH } from '../worker/tenant-data-plane-command.js';

function fakeDb(row) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return row;
            }
          };
        }
      };
    }
  };
}

const ctx = { waitUntil() {} };

describe('tenant internal data-plane public routing boundary', () => {
  it('does not dispatch the internal D1 command from a merchant hostname', async () => {
    const get = vi.fn(() => ({
      fetch: vi.fn(async () => new Response('should-not-run', { status: 418 }))
    }));
    const assetsFetch = vi.fn(async () => new Response('shared-platform', { status: 200 }));
    const env = {
      CATALOG_DB: fakeDb({
        tenant_id: 't_aaaaaaaaaaaaaaaaaaaa',
        domain_status: 'active',
        data_plane_key: 'dp-tenant-a',
        data_plane_status: 'ready',
        setup_status: 'published',
        worker_script_name: 'ce-aaaaaaaaaaaaaaaaaaaa',
        worker_status: 'active',
        runtime_kind: 'catalog',
        runtime_status: 'verified',
        runtime_version: 1
      }),
      TENANT_DISPATCH: { get },
      ASSETS: { fetch: assetsFetch },
      CATALOG_PLATFORM_HOSTS: 'catalog-engine.example,app.catalog-engine.example',
      CATALOG_ADMIN_HOST: 'app.catalog-engine.example'
    };

    const response = await worker.fetch(
      new Request(`https://shop.example.com${TENANT_DATA_PLANE_COMMAND_PATH}`, { method: 'GET' }),
      env,
      ctx
    );

    expect(get).not.toHaveBeenCalled();
    expect(response.status).not.toBe(418);
  });
});
