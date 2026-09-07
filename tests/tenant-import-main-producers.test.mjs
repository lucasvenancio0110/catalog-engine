import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

function parseJsonc(path) {
  const raw = fs.readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(raw);
}

const config = parseJsonc('wrangler.jsonc');
const deploy = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('main tenant import producer activation boundary', () => {
  it('binds required import plus IC2 instant-seed producers while preserving automation boundaries', () => {
    expect(config.vars.TENANT_IMPORT_AUTOMATION_ENABLED).toBe('1');
    expect(config.vars.TENANT_SYNC_AUTOMATION_ENABLED).toBe('0');
    expect(config.vars.TENANT_SYNC_ACTIVE_COHORT).toBe('');
    expect(config.vars.TENANT_SYNC_MAX_JOBS_PER_TICK).toBe('1');
    expect(config.queues?.consumers ?? []).toEqual([]);
    expect(config.queues?.producers).toEqual([
      { binding: 'TENANT_IMPORT_QUEUE', queue: 'catalog-engine-import-scan' },
      { binding: 'TENANT_IMPORT_DETAIL_QUEUE', queue: 'catalog-engine-import-detail' },
      { binding: 'TENANT_INSTANT_SEED_QUEUE', queue: 'catalog-engine-instant-seed' }
    ]);
  });

  it('keeps code deploy separate from catalog publication and verifies existing import producer boundaries after deploy', () => {
    expect(deploy).toContain('Verify tenant import producers and automation boundaries');
    expect(deploy).toContain('TENANT_IMPORT_AUTOMATION_ENABLED');
    expect(deploy).toContain('TENANT_SYNC_AUTOMATION_ENABLED');
    expect(deploy).toContain('test "$SYNC_AUTOMATION_VALUE" = "0"');
    expect(deploy).toContain('catalog-engine-import-scan');
    expect(deploy).toContain('catalog-engine-import-detail');
    expect(deploy).not.toContain('sync-public-catalog-d1.mjs');
    expect(deploy).not.toContain('publish-default-catalog');
  });

  it('publishes a trusted commit status only from the main deployment workflow', () => {
    expect(deploy).not.toMatch(/^\s*pull_request\s*:/m);
    expect(deploy).toContain('statuses: write');
    expect(deploy).toContain('catalog-engine/application-deploy');
    expect(deploy).toContain(
      'App deployed + smoke passed; infrastructure bindings and sync-off boundary verified'
    );
  });
});
