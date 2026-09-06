import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { recoverExhaustedInitialDetailLeases } from '../worker/ingestion/initial-detail-recovery.js';

const message = {
  version: 1,
  type: 'finalize',
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary'
};

function contextRow() {
  return {
    import_id: message.importId,
    mode: 'initial',
    import_status: 'details',
    phase: 'details',
    detail_enqueue_cursor: 4,
    discovered_count: 4,
    provider: 'yupoo',
    source_url: 'https://supplier.x.yupoo.com/albums/',
    sync_strategy: 'incremental',
    removal_miss_threshold: 3,
    d1_database_id: '11111111-2222-3333-4444-555555555555',
    database_status: 'active',
    worker_status: 'active',
    dispatch_namespace: 'catalog-engine-production',
    provisioning_id: 'pv_0123456789abcdefabcd',
    provisioning_step: 'import',
    schema_version: 8
  };
}

function fakeDb(row = contextRow()) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              return sql.includes('FROM tenant_import_jobs j') ? row : null;
            }
          };
        }
      };
    }
  };
}

function runtime(db) {
  return {
    CATALOG_DB: db,
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_PLATFORM_API_TOKEN: 'test-runtime-credential-placeholder',
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production'
  };
}

function response(result) {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('initial detail expired-lease recovery', () => {
  it('terminalizes only expired processing claims at or above the bounded detail limit', async () => {
    let requestBody;
    const fetchImpl = vi.fn(async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return response([
        { success: true, results: [], meta: { changes: 1 } },
        { success: true, results: [], meta: { changes: 1 } }
      ]);
    });

    const result = await recoverExhaustedInitialDetailLeases(message, runtime(fakeDb()), { fetchImpl });
    expect(result).toEqual({ outcome: 'success', recovered: 1 });
    const terminalize = requestBody.batch[0];
    expect(terminalize.sql).toContain("state='processing'");
    expect(terminalize.sql).toContain('lease_until<=CURRENT_TIMESTAMP');
    expect(terminalize.sql).toContain('attempt_count>=?5');
    expect(terminalize.sql).toContain("state='deferred'");
    expect(terminalize.sql).toContain("outcome_code='retry_exhausted'");
    expect(Number(terminalize.params.at(-1))).toBe(4);
  });

  it('is idempotent and keeps the source index aligned with recovered durable state', async () => {
    let requestBody;
    const fetchImpl = vi.fn(async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return response([
        { success: true, results: [], meta: { changes: 0 } },
        { success: true, results: [], meta: { changes: 1 } }
      ]);
    });

    const result = await recoverExhaustedInitialDetailLeases(message, runtime(fakeDb()), { fetchImpl });
    expect(result.recovered).toBe(0);
    expect(requestBody.batch[1].sql).toContain("d.state='deferred'");
    expect(requestBody.batch[1].sql).toContain("d.outcome_code='retry_exhausted'");
    expect(requestBody.batch[1].sql).toContain('detail_retry_after=NULL');
  });

  it('does not contain cross-tenant or unbounded recovery predicates', () => {
    const source = fs.readFileSync('worker/ingestion/initial-detail-recovery.js', 'utf8');
    expect(source).toContain('tenant_id=?1');
    expect(source).toContain('source_key=?2');
    expect(source).toContain('import_id=?3');
    expect(source).toContain('attempt_count>=?5');
    expect(source).not.toMatch(/\bDELETE\b/i);
    expect(source).not.toContain('.send(');
    expect(source).not.toContain('.sendBatch(');
  });
});
