import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  controlPlaneSeed,
  fixtureIdentity,
  initialDataPlaneSeed,
  retainedMigrationFailureEvidence
} from '../scripts/cloudflare-tenant-data-plane-fleet-canary.mjs';
import { tenantDataPlaneCurrentBatch as tenantDataPlaneV4Batch } from '../worker/tenant-data-plane-schema-v4.js';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-tenant-data-plane-fleet-canary.mjs', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('tenant data-plane fleet maintenance production canary', () => {
  it('builds a valid v4 fixture with LKG, media and merchant override before production polling starts', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    const fixture = fixtureIdentity('success', 'fleet-canary-unit-fixture');
    const source = {
      provider: 'yupoo',
      sourceKey: fixture.sourceKey,
      sourceUrl: fixture.sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    };
    for (const statement of [
      ...tenantDataPlaneV4Batch({ tenantId: fixture.tenantId, source }),
      ...initialDataPlaneSeed(fixture)
    ]) {
      database.prepare(statement.sql).run(...statement.params);
    }

    expect(
      database.prepare('SELECT tenant_id, schema_version FROM data_plane_identity').get()
    ).toEqual({ tenant_id: fixture.tenantId, schema_version: 4 });
    expect(
      database
        .prepare(
          `SELECT GROUP_CONCAT(version, ',') AS versions
             FROM (SELECT version FROM data_plane_schema_migrations ORDER BY version)`
        )
        .get().versions
    ).toBe('1,2,3,4');
    expect(database.prepare('SELECT COUNT(*) AS total FROM catalog_products').get().total).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS total FROM media_sources').get().total).toBe(1);
    expect(
      database.prepare('SELECT listing_fingerprint FROM supplier_album_index').get()
        .listing_fingerprint
    ).toBe(fixture.listingFingerprint);
    expect(
      database.prepare('SELECT override_json FROM catalog_product_classification_overrides').get()
        .override_json
    ).toBe(fixture.overrideJson);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('builds valid ready control-plane fixtures without pre-creating scheduler-owned migration jobs', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    for (const migration of fs.readdirSync('migrations').sort()) {
      database.exec(fs.readFileSync(`migrations/${migration}`, 'utf8'));
    }

    for (const kind of ['success', 'failure', 'blocked']) {
      const fixture = fixtureIdentity(kind, `fleet-canary-control-${kind}`);
      fixture.databaseId = `${kind.padEnd(8, '0')}-1111-4111-8111-111111111111`;
      for (const statement of controlPlaneSeed(fixture, 'fleet-canary-worker-v1')) {
        database.prepare(statement.sql).run(...statement.params);
      }
    }

    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS total
             FROM tenant_catalog_instances
            WHERE status='ready' AND schema_version=4`
        )
        .get().total
    ).toBe(3);
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM tenant_data_plane_migration_jobs').get().total
    ).toBe(0);
    expect(
      database
        .prepare(
          `SELECT mode, status, phase
             FROM tenant_import_jobs
            WHERE mode='incremental'`
        )
        .get()
    ).toEqual({ mode: 'incremental', status: 'scanning', phase: 'scan' });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS total
             FROM tenant_provisioning_runs
            WHERE status='success' AND current_step='complete'
              AND updated_at=?1`
        )
        .get('2000-01-01T00:00:00Z').total
    ).toBe(3);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('keeps PR validation secret-free and production execution tied to trusted main', () => {
    const validateStart = workflow.indexOf('  validate:');
    const canaryStart = workflow.indexOf('  canary:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(canaryStart).toBeGreaterThan(validateStart);
    expect(workflow.slice(validateStart, canaryStart)).not.toContain('secrets.CLOUDFLARE');
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toMatch(/^  push:/m);
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' || github.event_name == 'push'"
    );
    const pushStart = workflow.indexOf('  push:');
    const dispatchStart = workflow.indexOf('  workflow_dispatch:', pushStart);
    const pushContract = workflow.slice(pushStart, dispatchStart);
    expect(pushContract).toContain("branches: ['main']");
    expect(pushContract).toContain(
      "'.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml'"
    );
    expect(pushContract).not.toContain('worker/');
  });

  it('proves scheduler ownership without manually creating migration jobs or touching Queue messages', () => {
    expect(script).toContain('waitForSchedulerOwnedOutcomes');
    expect(script).toContain('schedulerOwnedMaintenance: true');
    expect(script).toContain('manualQueueMessagesProduced: false');
    expect(script).not.toContain('INSERT INTO tenant_data_plane_migration_jobs');
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('/purge');
    expect(script).not.toContain('.send(');
    expect(script).not.toContain('.sendBatch(');
  });

  it('starts from a real v4 data plane and verifies v5 ledger plus private staging tables', () => {
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v4.js'");
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v5.js'");
    expect(script).toContain(
      "expectedLedger = expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? '1,2,3,4,5' : '1,2,3,4'"
    );
    for (const table of [
      'supplier_sync_stage_runs',
      'supplier_sync_stage_observations',
      'supplier_sync_stage_events',
      'supplier_sync_stage_categories'
    ]) {
      expect(script).toContain(table);
    }
    expect(script).toContain("{ sql: 'PRAGMA foreign_key_check', params: [] }");
    expect(script).toContain("PRAGMA table_info('tenant_data_plane_migration_jobs')");
    expect(script).toContain('fleet_canary_control_schema_not_ready');
  });

  it('proves success, controlled failure, active-import exclusion and durable LKG/override preservation', () => {
    expect(script).toContain("for (const kind of ['success', 'failure', 'blocked'])");
    expect(script).toContain("'incremental', 'scanning', 'scan'");
    expect(script).toContain('tenant_dispatch_namespace_mismatch');
    expect(script).toContain('fleet_canary_active_import_was_not_excluded');
    expect(script).toContain('fleet_canary_historical_onboarding_changed');
    expect(script).toContain('fleet_canary_last_known_good_changed');
    expect(script).toContain('merchantOverridePreserved: true');
    expect(script).toContain('defaultCatalogCountUnchanged: true');
    expect(script).toContain('unrelatedTenantIsolationVerified: true');
  });

  it('retains opaque evidence on unexpected failure and cleans fixtures only after full success', () => {
    const cleanupIndex = script.indexOf('await cleanupFixtures(fixtures);');
    const successOutputIndex = script.indexOf('tenantDataPlaneFleetCanaryPassed: true');
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(successOutputIndex).toBeGreaterThan(cleanupIndex);
    expect(script).toContain('fleetCanaryFixturesRetained: true');
    expect(script).toContain('tenantId: fixture.tenantId');
    const retainedEvidenceStart = script.indexOf('function retainedFixtureEvidence');
    const mainStart = script.indexOf('async function main()', retainedEvidenceStart);
    expect(retainedEvidenceStart).toBeGreaterThan(-1);
    expect(mainStart).toBeGreaterThan(retainedEvidenceStart);
    expect(script.slice(retainedEvidenceStart, mainStart)).not.toContain(
      'databaseId: fixture.databaseId'
    );
    expect(script).toContain('migrationFailureEvidence');
  });

  it('bounds retained migration failure details to stable safe fields', () => {
    expect(
      retainedMigrationFailureEvidence('success', {
        status: 'failed',
        attempt_count: 3,
        last_error_code: 'tenant_d1_migration_apply_unreachable'
      })
    ).toEqual({
      kind: 'success',
      status: 'failed',
      attemptCount: 3,
      safeErrorCode: 'tenant_d1_migration_apply_unreachable'
    });
    expect(
      retainedMigrationFailureEvidence('success', {
        status: 'failed',
        attempt_count: 1,
        last_error_code: 'https://private.example/token'
      }).safeErrorCode
    ).toBe('fleet_canary_migration_error_invalid');
  });

  it('keeps recurring tenant sync explicitly off in deploy and canary gates', () => {
    expect(workflow).toContain('TENANT_SYNC_AUTOMATION_ENABLED must remain 0 for M7C4');
    expect(script).toContain('fleet_canary_requires_recurring_sync_off');
    expect(deployWorkflow).toContain('TENANT_SYNC_AUTOMATION_ENABLED');
  });

  it('requires trusted deploy to bind the infrastructure-only fleet migration runtime', () => {
    expect(deployWorkflow).toContain('--secrets-file "$RUNTIME_SECRETS"');
    expect(deployWorkflow).toContain('Verify main Worker infrastructure secret bindings');
    expect(deployWorkflow).toContain('/workers/scripts/catalog-engine/settings');
    expect(deployWorkflow).toContain(
      'verify-worker-platform-bindings.mjs "$WORKER_SETTINGS" --require'
    );
  });
});
