import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production scheduler tenant runtime activation', () => {
  it('runs verified-tenant runtime activation after the prerequisite scheduler batch', async () => {
    const entry = await readFile(new URL('../worker/entry.js', import.meta.url), 'utf8');
    expect(entry).toContain("import { runDueTenantRuntimes } from './tenant-runtime-runner.js'");

    const batchStart = entry.indexOf('Promise.allSettled([');
    const batchEnd = entry.indexOf(']).then(async (results) => {', batchStart);
    const runtimeCall = entry.indexOf('const runtimeSummary = await runDueTenantRuntimes(env);', batchEnd);
    const verificationCall = entry.indexOf('runDueTenantVerifications(env)', batchStart);

    expect(batchStart).toBeGreaterThan(-1);
    expect(batchEnd).toBeGreaterThan(batchStart);
    expect(verificationCall).toBeGreaterThan(batchStart);
    expect(verificationCall).toBeLessThan(batchEnd);
    expect(runtimeCall).toBeGreaterThan(batchEnd);
    expect(entry.slice(batchStart, batchEnd)).not.toContain('runDueTenantRuntimes(env)');
    expect(entry).toContain("console.log('tenant_runtime_schedule'");
    expect(entry).toContain("console.error('tenant_runtime_schedule_failed'");
  });
});
