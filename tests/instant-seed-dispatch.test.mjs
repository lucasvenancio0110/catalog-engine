import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePortalImportDecisionRequest } from '../worker/portal-import-decision.js';

const tenantId = 't_0123456789abcdefabcd';
const principalId = 'prn_0123456789abcdefabcd';
const locatorRef = 'loc_0123456789abcdefabcd';
const databases = [];

class BoundStatement {
  constructor(statement, params = []) {
    this.statement = statement;
    this.params = params;
  }
  bind(...params) {
    return new BoundStatement(this.statement, params);
  }
  all() {
    return { results: this.statement.all(...this.params) };
  }
  first() {
    return this.statement.get(...this.params) || null;
  }
  run() {
    const result = this.statement.run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1SqliteAdapter {
  constructor(database) {
    this.database = database;
  }
  prepare(sql) {
    return new BoundStatement(this.database.prepare(sql));
  }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE tenant_memberships (
      tenant_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, principal_id)
    );
    CREATE TABLE tenant_source_connections (
      connection_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_locator_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE (tenant_id, source_key)
    );
    CREATE TABLE tenant_import_decisions (
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_locator_ref TEXT NOT NULL,
      decision_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      authority TEXT NOT NULL,
      decided_by_principal_id TEXT,
      confirmed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, source_key)
    );
    CREATE TABLE tenant_audit_log (
      audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      principal_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database
    .prepare("INSERT INTO tenant_memberships VALUES (?,?,'owner','active')")
    .run(tenantId, principalId);
  database
    .prepare(
      `INSERT INTO tenant_source_connections
        (connection_id,tenant_id,provider,source_key,source_locator_ref,status)
       VALUES ('src_0123456789abcdefabcd',?,'yupoo','primary',?,'active')`
    )
    .run(tenantId, locatorRef);
  return { database, db: new D1SqliteAdapter(database) };
}

function putRequest() {
  return new Request(
    `https://app.catalogoengine.com/api/admin/stores/${tenantId}/import-decision`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceKey: 'primary', decisionKind: 'full_connected_source' })
    }
  );
}

const authenticate = vi.fn(async () => ({ principalId }));

afterEach(() => {
  authenticate.mockClear();
  while (databases.length) databases.pop().close();
});

describe('IC2 immediate instant-seed dispatch', () => {
  it('enqueues only opaque tenant/source identity after the merchant decision is durable', async () => {
    const { database, db } = createDatabase();
    const send = vi.fn(async () => {});
    const response = await handlePortalImportDecisionRequest(
      putRequest(),
      { CATALOG_DB: db, TENANT_INSTANT_SEED_QUEUE: { send } },
      { authenticate }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.sourceConnected).toBe(true);
    expect(payload.decision.status).toBe('confirmed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      { v: 1, type: 'instant-seed', tenantId, sourceKey: 'primary' },
      { contentType: 'json', delaySeconds: 0 }
    );
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/https?:\/\/|yupoo|loc_|provider|d1|worker/i);
    expect(
      database.prepare('SELECT status,authority FROM tenant_import_decisions WHERE tenant_id=?').get(tenantId)
    ).toEqual({ status: 'confirmed', authority: 'merchant' });
  });

  it('keeps the durable decision when Queue delivery fails and safely re-enqueues on retry', async () => {
    const { database, db } = createDatabase();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce(undefined);
    const env = { CATALOG_DB: db, TENANT_INSTANT_SEED_QUEUE: { send } };

    const failed = await handlePortalImportDecisionRequest(putRequest(), env, { authenticate });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'instant_seed_enqueue_failed' });
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_import_decisions').get().total).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_audit_log').get().total).toBe(1);

    const retried = await handlePortalImportDecisionRequest(putRequest(), env, { authenticate });
    expect(retried.status).toBe(200);
    expect((await retried.json()).decision.status).toBe('confirmed');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_import_decisions').get().total).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_audit_log').get().total).toBe(1);
  });

  it('preserves pre-IC2 rollback/test behavior when the fast-path Queue binding is absent', async () => {
    const { db } = createDatabase();
    const response = await handlePortalImportDecisionRequest(
      putRequest(),
      { CATALOG_DB: db },
      { authenticate }
    );
    expect(response.status).toBe(200);
    expect((await response.json()).decision.status).toBe('confirmed');
  });
});
