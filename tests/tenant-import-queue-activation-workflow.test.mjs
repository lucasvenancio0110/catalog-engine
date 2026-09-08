import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/activate-tenant-import-queues.yml', 'utf8');

function expectPresent(value) {
  expect(workflow.includes(value), `missing workflow contract: ${value}`).toBe(true);
}

describe('trusted tenant Queue activation workflow', () => {
  it('never exposes the production activation job to pull_request and follows only a successful application deploy', () => {
    expect(workflow).not.toMatch(/^\s*pull_request\s*:/m);
    expectPresent('workflow_run:');
    expectPresent("workflows: ['Deploy Catalog Engine application']");
    expectPresent('types: [completed]');
    expectPresent('workflow_dispatch:');
    expectPresent("github.event.workflow_run.conclusion == 'success'");
    expectPresent("github.event.workflow_run.head_branch == 'main'");
    expectPresent('github.event.workflow_run.head_sha');
    expectPresent('Checkout exact deployed trusted-main SHA');
    expectPresent('ref: ${{ steps.target.outputs.sha }}');
    expectPresent('secrets.CLOUDFLARE_API_TOKEN');
    expectPresent('secrets.CLOUDFLARE_ACCOUNT_ID');
  });

  it('rejects failed or cancelled deploy workflow_run events before the production concurrency slot', () => {
    const jobsStart = workflow.indexOf('\njobs:');
    const activateStart = workflow.indexOf('\n  activate:', jobsStart);
    const concurrencyStart = workflow.indexOf('\n    concurrency:', activateStart);
    const envStart = workflow.indexOf('\n    env:', concurrencyStart);

    expect(jobsStart).toBeGreaterThan(-1);
    expect(activateStart).toBeGreaterThan(jobsStart);
    expect(concurrencyStart).toBeGreaterThan(activateStart);
    expect(envStart).toBeGreaterThan(concurrencyStart);

    const workflowHeader = workflow.slice(0, jobsStart);
    const activateGate = workflow.slice(activateStart, concurrencyStart);
    const concurrencyBlock = workflow.slice(concurrencyStart, envStart);

    expect(workflowHeader).not.toContain('group: catalog-engine-production-d1');
    expect(activateGate).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(concurrencyBlock).toContain('group: catalog-engine-production-d1');
    expect(concurrencyBlock).toContain('cancel-in-progress: false');
  });

  it('serializes Worker and Queue control-plane mutations with trusted production work', () => {
    expectPresent('group: catalog-engine-production-d1');
    expectPresent('cancel-in-progress: false');
    expect(workflow).not.toContain('group: catalog-engine-tenant-import-queue-infra');
  });

  it('publishes Queue evidence against the exact deployed SHA instead of the workflow runner SHA', () => {
    expectPresent('SHA: ${{ steps.target.outputs.sha }}');
    expectPresent('IC4B detail batch=1/max=4');
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
    expectPresent('Build bounded IC4B detail consumer config');
    expectPresent('node scripts/build-ic4b-detail-config.mjs');
    expectPresent('/tmp/wrangler.import-detail.ic4b.json');
    expectPresent('deploy --config /tmp/wrangler.import-detail.ic4b.json');
    expectPresent('deploy --config wrangler.import-scan.jsonc');
    expectPresent('queues consumer worker list catalog-engine-import-scan --json');
    expectPresent('queues consumer worker list catalog-engine-import-detail --json');
  });

  it('verifies the promoted IC4B topology instead of trusting the generated config alone', () => {
    expectPresent('Verify Queue consumers and IC4B policies are attached');
    expectPresent('Number(settings.batch_size) !== 1');
    expectPresent('Number(settings.max_concurrency) !== 4');
    expectPresent('Number(settings.max_retries) !== 5');
    expectPresent('Number(settings.max_wait_time_ms) !== 5000');
    expectPresent('Number(settings.retry_delay) !== 120');
    expectPresent('catalog-engine-import-detail-dlq');
    expectPresent('wrangler.import-detail.jsonc remains the explicit 4/2 rollback template.');
  });
});
