import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production scheduler tenant runtime activation', () => {
  it('prioritizes already-due verified-tenant runtime activation before the general scheduler batch', async () => {
    const entry = await readFile(new URL('../worker/entry.js', import.meta.url), 'utf8');
    expect(entry).toContain("import { runDueTenantRuntimes } from './tenant-runtime-runner.js'");

    const runtimeCall = entry.indexOf('const runtimeSummary = await runDueTenantRuntimes(env);');
    const batchStart = entry.indexOf('const results = await Promise.allSettled([');
    const verificationCall = entry.indexOf('runDueTenantVerifications(env)', batchStart);

    expect(runtimeCall).toBeGreaterThan(-1);
    expect(batchStart).toBeGreaterThan(runtimeCall);
    expect(verificationCall).toBeGreaterThan(batchStart);
    expect(entry.slice(batchStart)).not.toContain('runDueTenantRuntimes(env)');
    expect(entry).toContain('staged: summary.staged || 0');
    expect(entry).toContain("console.log('tenant_runtime_schedule'");
    expect(entry).toContain("console.error('tenant_runtime_schedule_failed'");
    expect(entry).toContain('A tenant that becomes newly');
    expect(entry).toContain('eligible later in this tick can safely wait for the next five-minute cron.');
  });
});
