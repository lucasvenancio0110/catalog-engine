import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('M7B recurring sync activation boundary', () => {
  it('mounts the scheduler on the platform cron but keeps production recurring sync disabled', async () => {
    const [entry, configText] = await Promise.all([
      readFile('worker/entry.js', 'utf8'),
      readFile('wrangler.jsonc', 'utf8')
    ]);
    const config = JSON.parse(configText);

    expect(entry).toContain("import { runDueTenantSyncScheduling } from './tenant-sync-scheduler.js';");
    expect(entry).toContain('runDueTenantSyncScheduling(env)');
    expect(entry).toContain("'tenant_sync_schedule'");
    expect(config.triggers?.crons).toEqual(['*/5 * * * *']);
    expect(config.vars?.TENANT_IMPORT_AUTOMATION_ENABLED).toBe('1');
    expect(config.vars?.TENANT_SYNC_AUTOMATION_ENABLED).toBe('0');
  });

  it('does not wire incremental scheduling directly to Queue sends in the foundation slice', async () => {
    const scheduler = await readFile('worker/tenant-sync-scheduler.js', 'utf8');

    expect(scheduler).toContain("mode='incremental'");
    expect(scheduler).not.toMatch(/TENANT_IMPORT_QUEUE|TENANT_IMPORT_DETAIL_QUEUE|\.sendBatch?\s*\(/);
  });
});
