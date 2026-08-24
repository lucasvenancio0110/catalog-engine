import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  namespacedTenantCatalogWorkerSource,
  queryD1Batch,
  tenantBootstrapWorkerSource
} from '../worker/cloudflare-platform.js';
import {
  TENANT_DATA_PLANE_COMMAND_PATH,
  TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH,
  handleTenantDataPlaneCommand,
  handleTenantDataPlaneSchemaMigrationCommand,
  normalizeTenantDataPlaneBatch
} from '../worker/tenant-data-plane-command.js';
import { tenantDataPlaneCurrentBatch as tenantDataPlaneV5Batch } from '../worker/tenant-data-plane-schema-v5.js';

const tenantId = 't_0123456789abcdefabcd';
const workerScriptName = 'ce-0123456789abcdefabcd';
const databaseId = '11111111-2222-3333-4444-555555555555';

function fakeD1() {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return { sql, params };
        }
      };
    },
    async batch(statements) {
      return statements.map((statement) => ({
        success: true,
        results: statement.sql.startsWith('SELECT')
          ? [{ tenant_id: statement.params[0] || null }]
          : [],
        meta: { changes: statement.sql.startsWith('SELECT') ? 0 : 1 }
      }));
    }
  };
}

function tenantFetcher(boundTenantId = tenantId) {
  const env = { TENANT_ID: boundTenantId, CATALOG_DB: fakeD1() };
  return {
    fetch(request) {
      return handleTenantDataPlaneCommand(request, env);
    }
  };
}

function applySqliteBatch(database, batch) {
  database.exec('BEGIN');
  try {
    for (const query of batch) database.prepare(query.sql).run(...(query.params || []));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function sqliteD1(database) {
  return {
    prepare(sql) {
      return {
        sql,
        params: [],
        bind(...params) {
          return { sql, params };
        }
      };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params = [] }) => {
          const statement = database.prepare(sql);
          const read = /^\s*(SELECT|PRAGMA)\b/i.test(sql);
          return {
            success: true,
            results: read ? statement.all(...params) : [],
            meta: read ? { changes: 0 } : { changes: Number(statement.run(...params).changes || 0) }
          };
        });
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

describe('native tenant data-plane command', () => {
  it('routes an ingestion batch to the deterministic tenant User Worker without Cloudflare REST credentials', async () => {
    const get = vi.fn((scriptName) => (scriptName === workerScriptName ? tenantFetcher() : null));
    const fetchImpl = vi.fn(() => {
      throw new Error('administrative Cloudflare D1 REST must not be used');
    });

    const result = await queryD1Batch(
      {
        dispatchNamespace: 'catalog-engine-production',
        databaseId,
        tenantDispatch: { get },
        batch: [
          {
            sql: 'SELECT tenant_id FROM data_plane_identity WHERE tenant_id=?1',
            params: [tenantId]
          }
        ]
      },
      { fetchImpl }
    );

    expect(result[0].results).toEqual([{ tenant_id: tenantId }]);
    expect(get).toHaveBeenCalledWith(workerScriptName);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when a batch cannot resolve exactly one opaque tenant id', async () => {
    await expect(
      queryD1Batch({
        tenantDispatch: { get: vi.fn() },
        databaseId,
        batch: [{ sql: 'SELECT 1', params: [] }]
      })
    ).rejects.toMatchObject({ code: 'tenant_data_plane_tenant_unresolved' });
  });

  it('rejects a cross-tenant command before touching D1', async () => {
    const db = fakeD1();
    db.batch = vi.fn(db.batch);
    const request = new Request(
      `https://catalog-engine.internal${TENANT_DATA_PLANE_COMMAND_PATH}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-catalog-tenant-id': 't_bbbbbbbbbbbbbbbbbbbb'
        },
        body: JSON.stringify({
          version: 1,
          tenantId: 't_bbbbbbbbbbbbbbbbbbbb',
          batch: [
            {
              sql: 'SELECT tenant_id FROM data_plane_identity WHERE tenant_id=?1',
              params: [tenantId]
            }
          ]
        })
      }
    );

    const response = await handleTenantDataPlaneCommand(request, {
      TENANT_ID: tenantId,
      CATALOG_DB: db
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('tenant_data_plane_tenant_mismatch');
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('allows only one-statement DML/read operations on the internal protocol', () => {
    expect(() =>
      normalizeTenantDataPlaneBatch([{ sql: 'CREATE TABLE unsafe(id TEXT)', params: [] }])
    ).toThrow('tenant_data_plane_sql_invalid');
    expect(() =>
      normalizeTenantDataPlaneBatch([{ sql: 'SELECT 1; DELETE FROM catalog_products', params: [] }])
    ).toThrow('tenant_data_plane_sql_invalid');
  });

  it('applies only the embedded versioned schema plan through the tenant D1 binding', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      applySqliteBatch(
        database,
        tenantDataPlaneV5Batch({
          tenantId,
          source: {
            sourceKey: 'primary',
            provider: 'yupoo',
            sourceUrl: 'https://private-source.invalid/catalog',
            syncStrategy: 'incremental',
            removalMissThreshold: 3
          }
        })
      );
      const env = { TENANT_ID: tenantId, CATALOG_DB: sqliteD1(database) };
      const request = () =>
        new Request(`https://catalog-engine.internal${TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-catalog-tenant-id': tenantId
          },
          body: JSON.stringify({ version: 2, tenantId, targetSchemaVersion: 6 })
        });

      const first = await handleTenantDataPlaneSchemaMigrationCommand(request(), env);
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({
        ok: true,
        version: 2,
        schemaVersion: 6,
        applied: true
      });
      expect(
        database
          .prepare('SELECT group_concat(version) AS versions FROM data_plane_schema_migrations')
          .get().versions
      ).toBe('1,2,3,4,5,6');
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name LIKE 'supplier_sync_stage_%'"
          )
          .get().total
      ).toBe(16);

      const replay = await handleTenantDataPlaneSchemaMigrationCommand(request(), env);
      expect(await replay.json()).toMatchObject({ schemaVersion: 6, applied: false });
    } finally {
      database.close();
    }
  });

  it('rejects caller-supplied SQL on the schema migration command', async () => {
    const response = await handleTenantDataPlaneSchemaMigrationCommand(
      new Request(`https://catalog-engine.internal${TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-catalog-tenant-id': tenantId
        },
        body: JSON.stringify({
          version: 2,
          tenantId,
          targetSchemaVersion: 6,
          sql: 'DROP TABLE catalog_products'
        })
      }),
      { TENANT_ID: tenantId, CATALOG_DB: fakeD1() }
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('tenant_data_plane_contract_invalid');
  });

  it('executes the embedded migration command from the generated User Worker module', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      applySqliteBatch(
        database,
        tenantDataPlaneV5Batch({
          tenantId,
          source: {
            sourceKey: 'primary',
            provider: 'yupoo',
            sourceUrl: 'https://private-source.invalid/catalog',
            syncStrategy: 'incremental',
            removalMissThreshold: 3
          }
        })
      );
      const source = tenantBootstrapWorkerSource();
      const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}`;
      const generatedWorker = (await import(moduleUrl)).default;
      const response = await generatedWorker.fetch(
        new Request(`https://catalog-engine.internal${TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-catalog-tenant-id': tenantId
          },
          body: JSON.stringify({ version: 2, tenantId, targetSchemaVersion: 6 })
        }),
        { TENANT_ID: tenantId, CATALOG_DB: sqliteD1(database) },
        {}
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ schemaVersion: 6, applied: true });
    } finally {
      database.close();
    }
  });

  it('ships the internal command inside bootstrap User Workers without exposing an admin API', () => {
    const source = tenantBootstrapWorkerSource();
    expect(source).toContain(TENANT_DATA_PLANE_COMMAND_PATH);
    expect(source).toContain(TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH);
    expect(source).toContain('x-catalog-tenant-id');
    expect(source).not.toContain('/api/admin/');
    expect(source).not.toContain('CLOUDFLARE_PLATFORM_API_TOKEN');

    const legacy = namespacedTenantCatalogWorkerSource({ includeSchemaMigration: false });
    expect(legacy).toContain(TENANT_DATA_PLANE_COMMAND_PATH);
    expect(legacy).not.toContain(TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH);
  });
});
