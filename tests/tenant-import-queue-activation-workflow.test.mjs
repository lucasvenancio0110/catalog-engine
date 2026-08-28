import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/activate-tenant-import-queues.yml', 'utf8');

function expectPresent(value) {
  expect(workflow.includes(value), `missing workflow contract: ${value}`).toBe(true);
}

describe('trusted tenant Queue activation workflow', () => {
  it('never exposes the production activation job to pull_request and follows a completed application deploy', () => {
    expect(workflow).not.toMatch(/^\s*pull_request\s*:/m);
    expectPresent('workflow_run:');
    expectPresent("workflows: ['Deploy Catalog Engine application']");
    expectPresent('types: [completed]');
    expectPresent('workflow_dispatch:');
    expectPresent("github.event.workflow_run.head_branch == 'main'");
    expectPresent('github.event.workflow_run.head_sha');
    expectPresent('Upstream application deploy did not succeed');
    expectPresent('Checkout exact deployed trusted-main SHA');
    expectPresent('ref: ${{ steps.target.outputs.sha }}');
    expectPresent('secrets.CLOUDFLARE_API_TOKEN');
    expectPresent('secrets.CLOUDFLARE_ACCOUNT_ID');
  });

  it('serializes Worker and Queue control-plane mutations with trusted production work', () => {
    expectPresent('group: catalog-engine-production-d1');
    expectPresent('cancel-in-progress: false');
    expect(workflow).not.toContain('group: catalog-engine-tenant-import-queue-infra');
  });

  it('publishes Queue evidence against the exact deployed SHA instead of the workflow runner SHA', () => {
    expectPresent('SHA: ${{ steps.target.outputs.sha }}');
    expectPresent('4 Queues + 2 consumers verified after exact-SHA deploy');
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
