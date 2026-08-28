import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  controlPlaneSeed,
  fixtureIdentity,
  initialDataPlaneSeed,
  retainedMigrationFailureEvidence
} from '../scripts/cloudflare-tenant-data-plane-fleet-canary.mjs';
import { tenantDataPlaneCurrentBatch as tenantDataPlaneV7Batch } from '../worker/tenant-data-plane-schema-v7.js';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-tenant-data-plane-fleet-canary.mjs', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('tenant data-plane fleet maintenance production canary', () => {
  it('builds a valid v7 fixture with LKG, staged candidate evidence and merchant override before polling', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    const fixture = fixtureIdentity('success', 'fleet-canary-unit-fixture');
    expect(fixture.dispatchNamespace).toBe('catalog-engine-production');
    const source = {
      provider: 'yupoo',
      sourceKey: fixture.sourceKey,
      sourceUrl: fixture.sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    };
    for (const statement of [
      ...tenantDataPlaneV7Batch({ tenantId: fixture.tenantId, source }),
      ...initialDataPlaneSeed(fixture)
    ]) {
      database.prepare(statement.sql).run(...statement.params);
    }

    expect(
      database.prepare('SELECT tenant_id, schema_version FROM data_plane_identity').get()
    ).toEqual({ tenant_id: fixture.tenantId, schema_version: 7 });
    expect(
      database
        .prepare(
          `SELECT GROUP_CONCAT(version, ',') AS versions
             FROM (SELECT version FROM data_plane_schema_migrations ORDER BY version)`
        )
        .get().versions
    ).toBe('1,2,3,4,5,6,7');
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
    expect(database.prepare('SELECT state FROM supplier_sync_stage_runs').get()).toEqual({
      state: 'preserved'
    });
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
             FROM tenant_catalog_instances i
             JOIN supplier_sources s ON s.tenant_id=i.tenant_id
            WHERE i.status='ready' AND i.schema_version=7
              AND s.source_key='fleet-canary'`
        )
        .get().total
    ).toBe(3);
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM tenant_data_plane_migration_jobs').get().total
    ).toBe(0);
    expect(
      database
        .prepare(
          `SELECT GROUP_CONCAT(kind, ',') AS kinds
             FROM (
               SELECT CASE WHEN migration_command_version=4 THEN 'prepared' ELSE 'pending' END AS kind
                 FROM tenant_data_plane_provider_state
                ORDER BY tenant_id
             )`
        )
        .get().kinds
    ).toContain('prepared');
    const capabilityRows = database.prepare(
      `SELECT migration_command_version, migration_command_prepared_at
           FROM tenant_data_plane_provider_state
          WHERE tenant_id=?1`
    );
    for (const kind of ['success', 'blocked']) {
      const fixture = fixtureIdentity(kind, `fleet-canary-control-${kind}`);
      expect(capabilityRows.get(fixture.tenantId)).toEqual({
        migration_command_version: 0,
        migration_command_prepared_at: null
      });
    }
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

  it('keeps PR validation secret-free and production execution behind a completed trusted-main deploy', () => {
    const validateStart = workflow.indexOf('  validate:');
    const canaryStart = workflow.indexOf('  canary:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(canaryStart).toBeGreaterThan(validateStart);
    expect(workflow.slice(validateStart, canaryStart)).not.toContain('secrets.CLOUDFLARE');
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain("'worker/ingestion/tenant-data-plane.js'");
    expect(workflow).toContain("'worker/tenant-data-plane-command.js'");
    expect(workflow).not.toMatch(/^  push:/m);
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("format('catalog-engine-tenant-fleet-pr-{0}'");
    expect(workflow).toContain("|| 'catalog-engine-production-d1'");
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(deployWorkflow).toContain(
      "'.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml'"
    );
    expect(deployWorkflow).toContain("'scripts/cloudflare-tenant-data-plane-fleet-canary.mjs'");
    expect(deployWorkflow).toContain("'tests/tenant-data-plane-fleet-canary.test.mjs'");
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

  it('starts from a real v7 data plane and verifies the v8 removal schema is additive and inert', () => {
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v7.js'");
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v8.js'");
    expect(script).toContain("'1,2,3,4,5,6,7,8'");
    expect(script).toContain("'1,2,3,4,5,6,7'");
    expect(script).toContain('supplier_scope_memberships');
    expect(script).toContain('supplier_sync_stage_removal_policy');
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
    expect(script).toContain("{ includeSchemaMigration: fixture.kind === 'failure' }");
    expect(script).toContain('prepareTenantMigrationCommandCapability(successFixture');
    expect(script).toContain('trustedCiOwnedWorkerPreparation: true');
    expect(script).toContain("runtimeCapabilityRefreshed: fixture.kind === 'success'");
    expect(script).toContain('TENANT_SYNC_CANDIDATE_TABLES');
    expect(script).toContain('candidateRowsPreserved: dataPlane.candidateRowCount');
    expect(script).toContain('fleet_canary_authority_model_invalid');
    expect(script).toContain('authorityRevision: dataPlane.servingAuthority?.revision ?? null');
    expect(script).toContain('historicalRunAuthorityBackfilled: dataPlane.stageAuthorityRows > 0');
    expect(script).toContain('TENANT_SYNC_CANDIDATE_TABLES.map((table) => ({');
    expect(script).toContain('candidateRows.reduce(');
    expect(script).not.toContain("join(' UNION ALL ')");
    expect(script).toContain('fleet_canary_historical_stage_changed');
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
    expect(workflow).toContain('TENANT_SYNC_AUTOMATION_ENABLED must remain 0');
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
    expect(deployWorkflow).toContain(
      'Prepare eligible tenant migration command capabilities from trusted CI'
    );
  });
});
