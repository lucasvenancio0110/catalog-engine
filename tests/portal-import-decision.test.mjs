import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmPortalFullSourceImport,
  requestPortalImportDecisionState
} from '../src/app/import-decision.js';
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

async function createDatabase({ role = 'owner', withSource = true, withInitialJob = false } = {}) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE catalog_tenants (tenant_id TEXT PRIMARY KEY);
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, source_key)
    );
    CREATE TABLE tenant_import_jobs (
      import_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  database.prepare('INSERT INTO catalog_tenants (tenant_id) VALUES (?)').run(tenantId);
  database
    .prepare(`INSERT INTO tenant_memberships (tenant_id,principal_id,role,status) VALUES (?,?,?,'active')`)
    .run(tenantId, principalId, role);
  if (withSource) {
    database
      .prepare(
        `INSERT INTO tenant_source_connections
          (connection_id,tenant_id,provider,source_key,source_locator_ref,status)
         VALUES ('src_0123456789abcdefabcd',?,'yupoo','primary',?,'active')`
      )
      .run(tenantId, locatorRef);
  }
  if (withInitialJob) {
    database
      .prepare(
        `INSERT INTO tenant_import_jobs
          (import_id,tenant_id,source_key,mode,status,phase,created_at)
         VALUES ('imp_0123456789abcdefabcd',?,'primary','initial','queued','scan','2026-09-05 08:00:00')`
      )
      .run(tenantId);
  }
  const migration = await readFile(
    new URL('../migrations/0026_tenant_import_decisions.sql', import.meta.url),
    'utf8'
  );
  database.exec(migration);
  return { database, db: new D1SqliteAdapter(database) };
}

function request(method = 'GET', body = null) {
  return new Request(`https://app.catalogoengine.com/api/admin/stores/${tenantId}/import-decision`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
}

const authenticate = vi.fn(async () => ({ principalId }));

afterEach(() => {
  authenticate.mockClear();
  while (databases.length) databases.pop().close();
});

describe('PB6 durable import decision authority', () => {
  it('keeps a fresh connected merchant blocked until an explicit full-source decision exists', async () => {
    const { db } = await createDatabase();
    const response = await handlePortalImportDecisionRequest(request(), { CATALOG_DB: db }, { authenticate });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sourceConnected: true, decision: null });
  });

  it('persists one merchant-confirmed full connected source decision without exposing its locator', async () => {
    const { database, db } = await createDatabase();
    const response = await handlePortalImportDecisionRequest(
      request('PUT', { sourceKey: 'primary', decisionKind: 'full_connected_source' }),
      { CATALOG_DB: db },
      { authenticate }
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      sourceConnected: true,
      decision: {
        sourceKey: 'primary',
        decisionKind: 'full_connected_source',
        status: 'confirmed',
        authority: 'merchant',
        confirmedAt: expect.any(String)
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/loc_|source_locator|yupoo\.com|https?:\/\//i);

    const row = database
      .prepare('SELECT source_locator_ref, authority, decided_by_principal_id FROM tenant_import_decisions WHERE tenant_id=?')
      .get(tenantId);
    expect(row).toEqual({
      source_locator_ref: locatorRef,
      authority: 'merchant',
      decided_by_principal_id: principalId
    });
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM tenant_audit_log WHERE action='tenant.import_decision.confirmed'").get().total
    ).toBe(1);
  });

  it('is idempotent and does not duplicate the merchant audit on retry', async () => {
    const { database, db } = await createDatabase();
    for (let index = 0; index < 2; index += 1) {
      const response = await handlePortalImportDecisionRequest(
        request('PUT', { sourceKey: 'primary', decisionKind: 'full_connected_source' }),
        { CATALOG_DB: db },
        { authenticate }
      );
      expect(response.status).toBe(200);
    }
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_import_decisions').get().total).toBe(1);
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM tenant_audit_log WHERE action='tenant.import_decision.confirmed'").get().total
    ).toBe(1);
  });

  it('preserves a pre-PB6 initial import as historical authority instead of fabricating a merchant click', async () => {
    const { database, db } = await createDatabase({ withInitialJob: true });
    const migrated = database
      .prepare('SELECT authority, decided_by_principal_id, confirmed_at FROM tenant_import_decisions WHERE tenant_id=?')
      .get(tenantId);
    expect(migrated).toEqual({
      authority: 'preexisting_import',
      decided_by_principal_id: null,
      confirmed_at: '2026-09-05 08:00:00'
    });

    const response = await handlePortalImportDecisionRequest(request(), { CATALOG_DB: db }, { authenticate });
    const payload = await response.json();
    expect(payload.decision.authority).toBe('preexisting_import');
    expect(JSON.stringify(payload)).not.toContain(locatorRef);
  });

  it('requires an active source and an owner/admin role for mutation', async () => {
    const withoutSource = await createDatabase({ withSource: false });
    const missing = await handlePortalImportDecisionRequest(
      request('PUT', { sourceKey: 'primary', decisionKind: 'full_connected_source' }),
      { CATALOG_DB: withoutSource.db },
      { authenticate }
    );
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: 'import_decision_source_required' });

    const viewer = await createDatabase({ role: 'viewer' });
    const forbidden = await handlePortalImportDecisionRequest(
      request('PUT', { sourceKey: 'primary', decisionKind: 'full_connected_source' }),
      { CATALOG_DB: viewer.db },
      { authenticate }
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'insufficient_role' });
  });

  it('rejects client-invented scopes instead of pretending category selection exists', async () => {
    const { db } = await createDatabase();
    const response = await handlePortalImportDecisionRequest(
      request('PUT', { sourceKey: 'primary', decisionKind: 'selected_categories', categoryIds: ['66243'] }),
      { CATALOG_DB: db },
      { authenticate }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'import_decision_invalid' });
  });
});

describe('PB6 portal import decision client', () => {
  it('sends only the fixed provider-neutral full-source decision', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sourceConnected: true,
          decision: {
            sourceKey: 'primary',
            decisionKind: 'full_connected_source',
            status: 'confirmed',
            authority: 'merchant',
            confirmedAt: '2026-09-05T08:00:00Z',
            sourceLocatorRef: locatorRef
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const decision = await confirmPortalFullSourceImport({
      tenantId,
      token: 'access-token',
      fetchImpl
    });
    expect(decision).toEqual({
      sourceKey: 'primary',
      decisionKind: 'full_connected_source',
      status: 'confirmed',
      authority: 'merchant',
      confirmedAt: '2026-09-05T08:00:00Z'
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      sourceKey: 'primary',
      decisionKind: 'full_connected_source'
    });
    expect(JSON.stringify(decision)).not.toMatch(/locator|categoryIds|yupoo\.com/i);
  });

  it('recovers only the bounded decision projection', async () => {
    const state = await requestPortalImportDecisionState({
      tenantId,
      token: 'access-token',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            sourceConnected: true,
            decision: {
              sourceKey: 'primary',
              decisionKind: 'full_connected_source',
              status: 'confirmed',
              authority: 'preexisting_import',
              confirmedAt: '2026-09-05T08:00:00Z',
              sourceLocatorRef: locatorRef,
              rawProviderCategoryId: '66243'
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    });
    expect(state).toEqual({
      sourceConnected: true,
      decision: {
        sourceKey: 'primary',
        decisionKind: 'full_connected_source',
        status: 'confirmed',
        authority: 'preexisting_import',
        confirmedAt: '2026-09-05T08:00:00Z'
      }
    });
    expect(JSON.stringify(state)).not.toMatch(/locator|category|66243/i);
  });
});

describe('PB6 import dispatcher gate', () => {
  it('requires a decision bound to the exact current source locator before discovering a new initial job', async () => {
    const dispatcher = await readFile(
      new URL('../worker/tenant-import-dispatcher.js', import.meta.url),
      'utf8'
    );
    expect(dispatcher).toContain('JOIN tenant_import_decisions d');
    expect(dispatcher).toContain('d.source_locator_ref=c.source_locator_ref');
    expect(dispatcher).toContain("d.status='confirmed'");
    expect(dispatcher).toContain("d.decision_kind='full_connected_source'");
    expect(dispatcher).toContain('recordPreexistingImportDecisions');
  });
});
