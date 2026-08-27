import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('M7B recurring sync activation boundary', () => {
  it('mounts the scheduler on the platform cron but keeps production recurring sync disabled', async () => {
    const [entry, configText, deployWorkflow] = await Promise.all([
      readFile('worker/entry.js', 'utf8'),
      readFile('wrangler.jsonc', 'utf8'),
      readFile('.github/workflows/deploy-catalog-api.yml', 'utf8')
    ]);
    const config = JSON.parse(configText);

    expect(entry).toContain(
      "import { runDueTenantSyncScheduling } from './tenant-sync-scheduler.js';"
    );
    expect(entry).toContain(
      "import { runDueTenantIncrementalFinalizations } from './ingestion/incremental-finalization-runner.js';"
    );
    expect(entry).toContain('runDueTenantIncrementalFinalizations(env)');
    expect(entry).toContain("'tenant_incremental_finalization_schedule'");
    expect(entry).toContain('runDueTenantSyncScheduling(env)');
    expect(entry).toContain("'tenant_sync_schedule'");
    expect(config.triggers?.crons).toEqual(['*/5 * * * *']);
    expect(config.vars?.TENANT_IMPORT_AUTOMATION_ENABLED).toBe('1');
    expect(config.vars?.TENANT_SYNC_AUTOMATION_ENABLED).toBe('0');
    expect(config.vars?.TENANT_SYNC_ACTIVE_COHORT).toBe('');
    expect(config.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK).toBe('1');
    expect(deployWorkflow).toContain('SYNC_AUTOMATION_VALUE');
    expect(deployWorkflow).toContain('test "$SYNC_AUTOMATION_VALUE" = "0"');
    expect(deployWorkflow).toContain('test -z "$SYNC_COHORT_VALUE"');
    expect(deployWorkflow).toContain('test "$SYNC_LIMIT_VALUE" = "1"');
    expect(deployWorkflow).toContain('FROM tenant_sync_enrollments');
    expect(deployWorkflow).toContain("Number(row.enrolled_rows) !== 0");
    expect(deployWorkflow).toContain('TENANT_SYNC_AUTOMATION_ENABLED=$SYNC_AUTOMATION_VALUE');
  });

  it('does not wire incremental scheduling directly to Queue sends in the foundation slice', async () => {
    const scheduler = await readFile('worker/tenant-sync-scheduler.js', 'utf8');

    expect(scheduler).toContain("mode='incremental'");
    expect(scheduler).not.toMatch(
      /TENANT_IMPORT_QUEUE|TENANT_IMPORT_DETAIL_QUEUE|\.sendBatch?\s*\(/
    );
  });

  it('keeps a failed incremental or recovery job as a blocking exception until recovery resolves it', async () => {
    const scheduler = await readFile('worker/tenant-sync-scheduler.js', 'utf8');

    expect(scheduler).toContain("unresolved_job.mode IN ('incremental','recovery')");
    expect(scheduler).toContain("unresolved_job.status='failed'");
    expect(scheduler).toContain(
      "conflicting_job.status IN ('pending','queued','scanning','details','finalizing')"
    );
    expect(scheduler).toContain("conflicting_job.mode IN ('incremental','recovery')");
    expect(scheduler).toContain("conflicting_job.status='failed'");
    expect(scheduler).toContain("migration_job.status IN ('pending','running','failed')");
  });
});
