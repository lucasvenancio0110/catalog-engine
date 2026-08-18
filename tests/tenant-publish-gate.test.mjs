import { describe, expect, it } from 'vitest';
import {
  maybeAdvanceTenantToPublish,
  tenantPublishPrerequisites
} from '../worker/tenant-publish-gate.js';

const tenantId = 't_aaaaaaaaaaaaaaaaaaaa';

function fakeDb(row) {
  const batches = [];
  return {
    batches,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,
            async first() {
              return row;
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

function readyRow(overrides = {}) {
  return {
    provisioning_id: 'pv_aaaaaaaaaaaaaaaaaaaa',
    current_step: 'domain',
    runtime_kind: 'catalog',
    runtime_status: 'verified',
    runtime_version: 1,
    domain_id: 'dom_aaaaaaaaaaaaaaaaaaaa',
    domain_status: 'active',
    provider_status: 'active',
    ssl_status: 'active',
    ...overrides
  };
}

describe('tenant publish gate', () => {
  it('blocks publish when the custom domain is ready but runtime smoke is not verified', async () => {
    const db = fakeDb(readyRow({ runtime_status: 'staged' }));
    const result = await maybeAdvanceTenantToPublish(db, tenantId);
    expect(result).toMatchObject({ ready: false, reason: 'tenant_runtime_not_verified' });
    expect(db.batches).toHaveLength(0);
  });

  it('blocks publish when runtime is verified but the domain is not provider/SSL active', async () => {
    const db = fakeDb(readyRow({ ssl_status: 'pending_validation' }));
    const result = await tenantPublishPrerequisites(db, tenantId);
    expect(result).toMatchObject({ ready: false, reason: 'tenant_domain_not_verified' });
  });

  it('advances to publish only when both isolated runtime and domain are verified', async () => {
    const db = fakeDb(readyRow());
    const result = await maybeAdvanceTenantToPublish(db, tenantId);
    expect(result).toMatchObject({ ready: true, reason: 'ready', advanced: true });
    expect(db.batches).toHaveLength(1);
    const sql = db.batches[0].map((statement) => statement.sql).join('\n');
    expect(sql).toContain("step_key='domain'");
    expect(sql).toContain("current_step='publish'");
  });
});
