import { describe, expect, it, vi } from 'vitest';
import {
  processTenantPublish,
  runDueTenantPublishes
} from '../worker/tenant-publish-runner.js';

const tenantId = 't_aaaaaaaaaaaaaaaaaaaa';
const job = { job_id: 'pubjob_aaaaaaaaaaaaaaaaaaaa', tenant_id: tenantId };

function context(overrides = {}) {
  return {
    provisioning_id: 'pv_aaaaaaaaaaaaaaaaaaaa',
    current_step: 'publish',
    data_plane_status: 'provisioning',
    schema_version: 3,
    setup_status: 'ready',
    worker_script_name: 'ce-aaaaaaaaaaaaaaaaaaaa',
    worker_status: 'active',
    runtime_kind: 'catalog',
    runtime_status: 'verified',
    runtime_version: 1,
    domain_id: 'dom_aaaaaaaaaaaaaaaaaaaa',
    hostname: 'shop.example.com',
    domain_status: 'active',
    provider_status: 'active',
    ssl_status: 'active',
    verification_status: 'success',
    classifier_version: 1,
    finding_count: 0,
    ...overrides
  };
}

function fakeDb(row) {
  const runs = [];
  const batches = [];
  return {
    runs,
    batches,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,
            async first() {
              if (sql.includes('FROM tenant_provisioning_runs r')) return row;
              return null;
            },
            async run() {
              runs.push({ sql, params });
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: [] };
            }
          };
        }
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
}

function dispatchEnv(db) {
  return {
    CATALOG_DB: db,
    TENANT_DISPATCH: {
      get() {
        return {
          async fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/health') {
              return Response.json({
                ok: true,
                service: 'catalog-engine-tenant',
                runtimeVersion: 1,
                schemaVersion: 3,
                catalogApi: true,
                mediaProxy: true,
                database: 'bound'
              });
            }
            if (url.pathname === '/api/catalog/meta') {
              return Response.json({ stats: { products: 42 } });
            }
            return Response.json({ error: 'not_found' }, { status: 404 });
          }
        };
      }
    }
  };
}

describe('final tenant publish checkpoint', () => {
  it('fails closed before DB reads when the dispatch binding is absent', async () => {
    const db = { prepare: vi.fn() };
    const result = await runDueTenantPublishes({ CATALOG_DB: db });
    expect(result).toEqual({
      enabled: false,
      reason: 'tenant_dispatch_unbound',
      processed: 0
    });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('blocks without mutating publish state when a prerequisite regresses', async () => {
    const db = fakeDb(context({ runtime_status: 'staged' }));
    const result = await processTenantPublish(db, { job, env: dispatchEnv(db) });
    expect(result).toEqual({ outcome: 'blocked', reason: 'tenant_publish_runtime_not_ready' });
    expect(db.runs).toHaveLength(0);
    expect(db.batches).toHaveLength(0);
  });

  it('re-smokes the exact tenant runtime then atomically activates the storefront', async () => {
    const db = fakeDb(context());
    const env = dispatchEnv(db);
    const get = vi.spyOn(env.TENANT_DISPATCH, 'get');
    const result = await processTenantPublish(db, { job, env });

    expect(result).toMatchObject({
      outcome: 'success',
      hostname: 'shop.example.com',
      runtimeVersion: 1,
      schemaVersion: 3,
      products: 42
    });
    expect(get).toHaveBeenCalledWith('ce-aaaaaaaaaaaaaaaaaaaa');
    expect(db.batches).toHaveLength(2);
    const publishBatch = db.batches[1].map((statement) => statement.sql).join('\n');
    expect(publishBatch).toContain("SET status='ready'");
    expect(publishBatch).toContain("SET setup_status='published'");
    expect(publishBatch).toContain("SET status='success', current_step='publish'");
    expect(publishBatch).toContain("'tenant.store.published'");
  });
});
