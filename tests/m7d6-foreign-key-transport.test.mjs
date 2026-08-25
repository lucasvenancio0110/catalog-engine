import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { normalizeTenantDataPlaneBatch } from '../worker/tenant-data-plane-command.js';

const accountId = 'a'.repeat(32);
const apiToken = 'token'.repeat(8);
const dispatchNamespace = 'catalog-engine-production';
const databaseId = '12ac414c-4aef-4668-a8f9-dc63d57d449f';

describe('M7D6 foreign-key verification transport', () => {
  it('normalizes the read-only foreign key pragma to tenant-command-safe SELECT SQL', async () => {
    let sentBatch = null;
    const fetchImpl = async (_url, init) => {
      sentBatch = JSON.parse(init.body).batch;
      return Response.json({
        success: true,
        result: [{ success: true, results: [], meta: { changes: 0 } }]
      });
    };

    const result = await queryD1Batch(
      {
        accountId,
        apiToken,
        dispatchNamespace,
        databaseId,
        batch: [{ sql: 'PRAGMA foreign_key_check', params: [] }]
      },
      { fetchImpl }
    );

    expect(result).toHaveLength(1);
    expect(sentBatch).toEqual([
      { sql: 'SELECT * FROM pragma_foreign_key_check', params: [] }
    ]);
    expect(() => normalizeTenantDataPlaneBatch(sentBatch)).not.toThrow();
  });

  it('preserves foreign-key finding row semantics after normalization', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));
        INSERT INTO child (parent_id) VALUES (999);
      `);

      const pragmaRows = database.prepare('PRAGMA foreign_key_check').all();
      const selectRows = database.prepare('SELECT * FROM pragma_foreign_key_check').all();

      expect(pragmaRows).toHaveLength(1);
      expect(selectRows).toEqual(pragmaRows);
    } finally {
      database.close();
    }
  });
});
