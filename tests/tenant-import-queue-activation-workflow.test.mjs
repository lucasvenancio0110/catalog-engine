import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/activate-tenant-import-queues.yml', 'utf8');

function expectPresent(value) {
  expect(workflow.includes(value), `missing workflow contract: ${value}`).toBe(true);
}

describe('trusted tenant Queue activation workflow', () => {
  it('never exposes the production activation job to pull_request', () => {
    expect(workflow).not.toMatch(/^\s*pull_request\s*:/m);
    expectPresent('push:');
    expectPresent('branches: ["main"]');
    expectPresent('workflow_dispatch:');
    expectPresent('secrets.CLOUDFLARE_API_TOKEN');
    expectPresent('secrets.CLOUDFLARE_ACCOUNT_ID');
  });

  it('keeps automatic tenant discovery disabled during Queue consumer activation', () => {
    expectPresent('Assert automatic tenant discovery remains OFF');
    expectPresent('"TENANT_IMPORT_AUTOMATION_ENABLED": "0"');
    expectPresent('Main Worker producer bindings are intentionally deferred to M5C-2.');
  });

  it('owns both primary Queues, both DLQs and both dedicated consumer deploys', () => {
    for (const queue of [
      'catalog-engine-import-scan',
      'catalog-engine-import-detail',
      'catalog-engine-import-scan-dlq',
      'catalog-engine-import-detail-dlq'
    ]) {
      expectPresent(queue);
    }
    expectPresent('queues create "$queue"');
    expectPresent('deploy --config wrangler.import-detail.jsonc');
    expectPresent('deploy --config wrangler.import-scan.jsonc');
    expectPresent('queues consumer worker list catalog-engine-import-scan --json');
    expectPresent('queues consumer worker list catalog-engine-import-detail --json');
  });
});
