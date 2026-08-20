import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

function parseJsonc(path) {
  const raw = fs.readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(raw);
}

const config = parseJsonc('wrangler.jsonc');
const deploy = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('main tenant import producer activation boundary', () => {
  it('binds only the required scan/detail producers with automatic discovery enabled', () => {
    expect(config.vars.TENANT_IMPORT_AUTOMATION_ENABLED).toBe('1');
    expect(config.queues?.consumers ?? []).toEqual([]);
    expect(config.queues?.producers).toEqual([
      { binding: 'TENANT_IMPORT_QUEUE', queue: 'catalog-engine-import-scan' },
      { binding: 'TENANT_IMPORT_DETAIL_QUEUE', queue: 'catalog-engine-import-detail' }
    ]);
  });

  it('keeps code deploy separate from catalog publication and verifies producer bindings after deploy', () => {
    expect(deploy).toContain('Verify tenant import producer bindings and automation setting');
    expect(deploy).toContain('TENANT_IMPORT_AUTOMATION_ENABLED');
    expect(deploy).toContain('catalog-engine-import-scan');
    expect(deploy).toContain('catalog-engine-import-detail');
    expect(deploy).not.toContain('sync-public-catalog-d1.mjs');
    expect(deploy).not.toContain('publish-default-catalog');
  });

  it('publishes a trusted commit status only from the main deployment workflow', () => {
    expect(deploy).not.toMatch(/^\s*pull_request\s*:/m);
    expect(deploy).toContain('statuses: write');
    expect(deploy).toContain('catalog-engine/application-deploy');
    expect(deploy).toContain('Queue producers and automation setting verified');
  });
});
