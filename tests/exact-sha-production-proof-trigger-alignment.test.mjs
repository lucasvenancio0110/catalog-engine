import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const queueWorkflow = fs.readFileSync('.github/workflows/activate-tenant-import-queues.yml', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');
const fleetWorkflow = fs.readFileSync(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml',
  'utf8'
);
const autoWorkflow = fs.readFileSync(
  '.github/workflows/cloudflare-auto-tenant-import-canary.yml',
  'utf8'
);

describe('exact-SHA production proof trigger alignment', () => {
  it('runs Queue activation after the application deploy instead of competing with it on push', () => {
    expect(queueWorkflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(queueWorkflow).toContain('github.event.workflow_run.head_sha');
    expect(queueWorkflow).toContain('ref: ${{ steps.target.outputs.sha }}');
    expect(queueWorkflow).not.toMatch(/^\s*push\s*:/m);
  });

  it('revalidates the application when Queue activation orchestration changes', () => {
    expect(deployWorkflow).toContain("'.github/workflows/activate-tenant-import-queues.yml'");
  });

  it('revalidates the application when M7D9 production-proof inputs change', () => {
    for (const path of [
      '.github/workflows/cloudflare-m7d9-removal-canary.yml',
      'scripts/cloudflare-m7d9-removal-canary.mjs',
      'scripts/d1-batch-chunks.mjs',
      'tests/d1-batch-chunks.test.mjs',
      'tests/tenant-m7d9-removal-canary.test.mjs'
    ]) {
      expect(deployWorkflow).toContain(`'${path}'`);
    }
  });

  it('revalidates the application when the automatic import production proof changes', () => {
    for (const path of [
      '.github/workflows/cloudflare-auto-tenant-import-canary.yml',
      'scripts/cloudflare-auto-tenant-import-canary.mjs',
      'tests/tenant-import-auto-canary.test.mjs'
    ]) {
      expect(deployWorkflow).toContain(`'${path}'`);
    }
  });

  it('waits outside the mutation lock before fleet and automatic import take the shared production lock', () => {
    for (const workflow of [fleetWorkflow, autoWorkflow]) {
      const prerequisiteStart = workflow.indexOf('  prerequisites:');
      const canaryStart = workflow.indexOf('  canary:');
      expect(prerequisiteStart).toBeGreaterThan(-1);
      expect(canaryStart).toBeGreaterThan(prerequisiteStart);
      const prerequisiteBlock = workflow.slice(prerequisiteStart, canaryStart);
      const canaryBlock = workflow.slice(canaryStart);
      expect(prerequisiteBlock).not.toContain('group: catalog-engine-production-d1');
      expect(canaryBlock).toContain('group: catalog-engine-production-d1');
      expect(canaryBlock).toContain("needs.prerequisites.result == 'success'");
    }
    expect(fleetWorkflow).toContain('application and Queue evidence outside mutation lock');
    expect(autoWorkflow).toContain('application, Queue and fleet evidence outside mutation lock');
  });
});
