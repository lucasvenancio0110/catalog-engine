import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const queueWorkflow = fs.readFileSync('.github/workflows/activate-tenant-import-queues.yml', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('exact-SHA production proof trigger alignment', () => {
  it('revalidates Queue consumers when trusted fleet preparation changes', () => {
    expect(queueWorkflow).toContain('scripts/cloudflare-tenant-data-plane-fleet-prepare.mjs');
  });

  it('revalidates the application when Queue activation orchestration changes', () => {
    expect(deployWorkflow).toContain('.github/workflows/activate-tenant-import-queues.yml');
  });
});
