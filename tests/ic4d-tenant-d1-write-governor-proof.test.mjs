import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-ic4d-tenant-d1-write-governor.yml',
  'utf8'
);
const probe = fs.readFileSync('worker/ic4d-write-governor-probe.js', 'utf8');

describe('IC4D trusted production proof contract', () => {
  it('runs after exact-SHA application deploy and waits for the full prerequisite chain', () => {
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('catalog-engine/application-deploy');
    expect(workflow).toContain('catalog-engine/queue-consumer-activation');
    expect(workflow).toContain('catalog-engine/tenant-import-auto-canary');
    expect(workflow).toContain('catalog-engine/pb9-production-proof');
    expect(workflow).toContain('catalog-engine/ic2-production-proof');
    expect(workflow).toContain('catalog-engine/ic3-production-proof');
    expect(workflow).toContain('catalog-engine/ic4b-detail-fanout');
    expect(workflow).toContain('catalog-engine/ic4c-provider-governor');
    expect(workflow).toContain('ref: ${{ env.TARGET_SHA }}');
  });

  it('uses the real production TenantD1WriteGovernor class in an isolated guarded Durable Object probe', () => {
    expect(probe).toContain("from './ingestion/tenant-d1-write-governor.js'");
    expect(probe).toContain('export { TenantD1WriteGovernor }');
    expect(workflow).toContain("main: './worker/ic4d-write-governor-probe.js'");
    expect(workflow).toContain("name: 'TENANT_D1_WRITE_GOVERNOR'");
    expect(workflow).toContain("class_name: 'TenantD1WriteGovernor'");
    expect(workflow).toContain('x-probe-token');
    expect(workflow).toContain('workers_dev: true');
  });

  it('proves slow-D1 slowdown without loss, bounded recovery and tenant isolation', () => {
    expect(probe).toContain('contract.slowWriteMs + 250');
    expect(probe).toContain('singleWriterAfterCooldown');
    expect(probe).toContain('recoveredLimit');
    expect(probe).toContain("governorStub(env, 'tenant-a')");
    expect(probe).toContain("governorStub(env, 'tenant-b')");
    expect(probe).toContain('independentTenantAdmitted');
    expect(probe).toContain('workLossObserved: false');
    expect(probe).toContain('status: 503');
    expect(probe).toContain('transportError: true');
  });

  it('publishes success only after proof resource cleanup and preserves recurring sync OFF', () => {
    const cleanup = workflow.indexOf('Delete isolated IC4D proof Worker and Durable Object namespace');
    const publish = workflow.indexOf('Publish successful IC4D production proof');
    expect(cleanup).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(cleanup);
    expect(workflow).toContain('recurringIntelligentSyncChanged == false');
    expect(workflow).toContain('privateIdentifiersExposed == false');
    expect(workflow).toContain('workLossObserved == false');
    expect(workflow).toContain('catalog-engine/ic4d-tenant-d1-write-governor');
  });
});
