import { describe, expect, it, vi } from 'vitest';
import { handleTenantImportFinalizeMessage } from '../worker/ingestion/finalize-consumer.js';

const message = {
  version: 1,
  type: 'finalize',
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary'
};
const databaseId = '11111111-2222-3333-4444-555555555555';
const accountId = '0123456789abcdef0123456789abcdef';
const dispatchNamespace = 'catalog-engine-production';

function contextRow(discovered = 3) {
  return {
    import_id: message.importId,
    mode: 'initial',
    import_status: 'details',
    phase: 'details',
    detail_enqueue_cursor: discovered,
    discovered_count: discovered,
    provider: 'yupoo',
    source_url: 'https://supplier.x.yupoo.com/albums/',
    sync_strategy: 'incremental',
    removal_miss_threshold: 3,
    d1_database_id: databaseId,
    database_status: 'active',
    worker_status: 'active',
    dispatch_namespace: dispatchNamespace,
    provisioning_id: 'pv_0123456789abcdefabcd',
    provisioning_step: 'import',
    schema_version: 2
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
              return sql.includes('FROM tenant_import_jobs j') ? row : null;
            },
            async run() {
              runs.push({ sql, params });
              return { meta: { changes: 1 } };
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

function response(result) {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function runtime(db) {
  return {
    CATALOG_DB: db,
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: accountId,
    CLOUDFLARE_PLATFORM_API_TOKEN: 'test-runtime-credential-placeholder',
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: dispatchNamespace
  };
}

describe('tenant import finalize barrier', () => {
  it('waits until every discovered album is terminal', async () => {
    const db = fakeDb(contextRow(3));
    const fetchImpl = vi.fn(async () =>
      response([
        { success: true, results: [{ state: 'success', total: 1 }] },
        { success: true, results: [{ total: 1, automatic: 1, review: 0, unknown_count: 0 }] },
        { success: true, results: [{ leaks: 0 }] }
      ])
    );

    const result = await handleTenantImportFinalizeMessage(message, runtime(db), { fetchImpl });
    expect(result).toMatchObject({ outcome: 'not_ready', terminal: 1, discovered: 3 });
    expect(db.runs).toHaveLength(0);
    expect(db.batches).toHaveLength(0);
  });

  it('advances successful imports to classify, never directly to publish', async () => {
    const db = fakeDb(contextRow(3));
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.batch[0].sql.includes('SELECT state')) {
        return response([
          {
            success: true,
            results: [
              { state: 'success', total: 2 },
              { state: 'skipped', total: 1 }
            ]
          },
          { success: true, results: [{ total: 2, automatic: 1, review: 1, unknown_count: 0 }] },
          { success: true, results: [{ leaks: 0 }] }
        ]);
      }
      return response(body.batch.map(() => ({ success: true, results: [], meta: { changes: 1 } })));
    });

    const result = await handleTenantImportFinalizeMessage(message, runtime(db), { fetchImpl });
    expect(result).toMatchObject({ outcome: 'success', products: 2, automatic: 1, review: 1 });
    expect(db.batches).toHaveLength(1);
    const sql = db.batches[0].map((statement) => statement.sql).join('\n');
    expect(sql).toContain("phase='complete'");
    expect(sql).toContain("current_step='classify'");
    expect(sql).not.toContain("current_step='publish'");
  });
});
