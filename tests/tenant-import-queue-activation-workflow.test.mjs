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

  it('preserves the configured automation state instead of forcing OFF during consumer deployment', () => {
    expectPresent('Validate tenant import automation setting');
    expectPresent('TENANT_IMPORT_AUTOMATION_ENABLED');
    expectPresent('test "$AUTOMATION_VALUE" = "0" -o "$AUTOMATION_VALUE" = "1"');
    expectPresent('Automation state is owned by wrangler.jsonc and is not changed by this workflow.');
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
