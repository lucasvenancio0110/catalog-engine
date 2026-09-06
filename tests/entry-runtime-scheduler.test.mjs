import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production scheduler tenant runtime activation', () => {
  it('wires verified-tenant runtime activation into the five-minute scheduler', async () => {
    const entry = await readFile(new URL('../worker/entry.js', import.meta.url), 'utf8');
    expect(entry).toContain("import { runDueTenantRuntimes } from './tenant-runtime-runner.js'");
    expect(entry).toContain('runDueTenantVerifications(env),\n        runDueTenantRuntimes(env),');
    expect(entry).toContain("'tenant_runtime_schedule'");
  });
});
