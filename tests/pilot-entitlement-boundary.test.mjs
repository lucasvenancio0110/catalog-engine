import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../migrations/0023_create_account_entitlements.sql', import.meta.url);
const attributesUrl = new URL('../.gitattributes', import.meta.url);
const workflowUrl = new URL('../.github/workflows/manage-pilot-entitlement.yml', import.meta.url);
const commandUrl = new URL('../scripts/manage-pilot-entitlement.mjs', import.meta.url);
const entryUrl = new URL('../worker/entry.js', import.meta.url);
const storeCreationBoundaryUrl = new URL('../worker/portal-store-creation.js', import.meta.url);

describe('PB2 pilot entitlement production boundary', () => {
  it('uses forward-only account tables, append-only events and transaction-local owner guards', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS account_principals');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS account_entitlements');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS account_entitlement_events');
    expect(sql).toContain('trg_account_entitlement_events_no_update');
    expect(sql).toContain('trg_account_entitlement_events_no_delete');
    expect(sql).toContain("RAISE(ABORT, 'entitlement_event_append_only')");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS account_store_creation_slots');
    expect(sql).toContain('trg_portal_owner_entitlement_guard');
    expect(sql).toContain("RAISE(ABORT, 'store_creation_not_entitled')");
    expect(sql).toContain("RAISE(ABORT, 'store_limit_reached')");
    expect(sql).toContain('trg_portal_owner_entitlement_slot');
    expect(sql).toContain('PRIMARY KEY (principal_id, slot_number)');
    expect(sql).toContain('max_stores INTEGER NOT NULL DEFAULT 1 CHECK (max_stores = 1)');
    expect(sql).not.toMatch(/@|auth0\||gmail|yupoo/i);
  });

  it('keeps D1 trigger migrations compatible with the remote statement splitter', async () => {
    const [sql, attributes] = await Promise.all([
      readFile(migrationUrl, 'utf8'),
      readFile(attributesUrl, 'utf8')
    ]);
    expect(sql).not.toContain('\r');
    expect(sql).not.toMatch(/SELECT\s+CASE/i);
    const triggerBlocks = [...sql.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map((match) => match[0]);
    expect(triggerBlocks).toHaveLength(4);
    for (const trigger of triggerBlocks) expect(trigger).toMatch(/\nBEGIN\n/);
    expect(attributes).toContain('migrations/*.sql text eol=lf');
  });

  it('keeps production grant/revoke manual, confirmed, trusted-main-only and serialized with D1 mutations', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/\bschedule:/);
    expect(workflow).not.toMatch(/\bpull_request:/);
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('catalog-engine-production-d1');
    expect(workflow).toContain('test "$CONFIRMATION" = "PILOT"');
    expect(workflow).toContain('Require checkout to remain current main');
    expect(workflow).toContain('CURRENT_MAIN_SHA');
    expect(workflow).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(workflow).toContain('node scripts/manage-pilot-entitlement.mjs');
  });

  it('requires a previously authenticated opaque account and persists an audit event for every mutation', async () => {
    const command = await readFile(commandUrl, 'utf8');
    expect(command).toContain('pilot_entitlement_requires_trusted_main');
    expect(command).toContain("/^prn_[a-f0-9]{20}$/");
    expect(command).toContain('pilot_entitlement_principal_not_registered');
    expect(command).toContain('account_entitlement_events');
    expect(command).toContain("'pilot_grant'");
    expect(command).toContain('max_stores=1');
    expect(command).not.toMatch(/password|client_secret|refresh_token/i);
  });

  it('touches the account before store creation and keeps entitlement ahead of the canonical mutation', async () => {
    const [entry, boundary] = await Promise.all([
      readFile(entryUrl, 'utf8'),
      readFile(storeCreationBoundaryUrl, 'utf8')
    ]);

    const touch = entry.indexOf('await touchAccountPrincipal(env.CATALOG_DB, auth.principalId)');
    const handler = entry.indexOf('return handlePortalStoreCreation({', touch);
    const delegatedControlPlane = entry.indexOf(
      'delegate: (nextRequest, nextEnv, nextCtx) => app.fetch(nextRequest, nextEnv, nextCtx)',
      handler
    );
    expect(touch).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(touch);
    expect(delegatedControlPlane).toBeGreaterThan(handler);

    const replay = boundary.indexOf('const replay = await loadExactCreatedStore');
    const gate = boundary.indexOf('await requireStoreCreationEntitlement(env.CATALOG_DB, principalId)');
    const canonicalization = boundary.indexOf('canonicalStoreCreationRequest(request, plan)', gate);
    const mutation = boundary.indexOf('const response = await delegate(', gate);
    expect(replay).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(replay);
    expect(canonicalization).toBeGreaterThan(gate);
    expect(mutation).toBeGreaterThan(gate);
  });
});
