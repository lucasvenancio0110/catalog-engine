import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/cloudflare-ic4c-provider-governor.yml', 'utf8');
const probe = fs.readFileSync('worker/ic4c-governor-probe.js', 'utf8');

describe('IC4C trusted provider-governor proof', () => {
  it('runs only after exact-SHA production regressions are green', () => {
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('catalog-engine/application-deploy');
    expect(workflow).toContain('catalog-engine/queue-consumer-activation');
    expect(workflow).toContain('catalog-engine/tenant-import-auto-canary');
    expect(workflow).toContain('catalog-engine/pb9-production-proof');
    expect(workflow).toContain('catalog-engine/ic2-production-proof');
    expect(workflow).toContain('catalog-engine/ic3-production-proof');
    expect(workflow).toContain('catalog-engine/ic4b-detail-fanout');
    expect(workflow).toContain('ref: ${{ env.TARGET_SHA }}');
  });

  it('proves the real Durable Object coordination semantics and all required pressure classes', () => {
    expect(probe).toContain('env.PROVIDER_DETAIL_GOVERNOR.idFromName');
    expect(probe).toContain('Promise.all');
    expect(probe).toContain('status: 429');
    expect(probe).toContain('status: 503');
    expect(probe).toContain('timeout: true');
    expect(probe).toContain('latencyMs: contract.latencyDegradeMs + 500');
    expect(probe).toContain('concurrentAdmitted');
    expect(probe).toContain('privateIdentifiersExposed: false');
    expect(workflow).toContain('.concurrentAdmitted == 4');
    expect(workflow).toContain('.concurrentRejected == 4');
    expect(workflow).toContain('.pressure.throttled429.reducedLimit == 2');
    expect(workflow).toContain('.pressure.upstream5xx.reducedLimit == 2');
    expect(workflow).toContain('.pressure.timeout.reducedLimit == 2');
    expect(workflow).toContain('.pressure.degradedLatency.reducedLimit == 2');
  });

  it('guards the transient workers.dev probe and removes it before publishing success', () => {
    expect(probe).toContain("request.headers.get('x-probe-token')");
    expect(probe).toContain("return new Response('not_found', { status: 404 })");
    expect(workflow).toContain('x-probe-token: ${{ steps.probe.outputs.token }}');
    expect(workflow).toContain('Delete isolated IC4C proof Worker and Durable Object namespace');
    expect(workflow).toContain('if: always()');
    expect(workflow.indexOf('Delete isolated IC4C proof Worker and Durable Object namespace')).toBeLessThan(
      workflow.indexOf('Publish successful IC4C production proof')
    );
    expect(workflow).not.toContain('echo "$PROBE_TOKEN"');
  });

  it('keeps recurring sync off and publishes only safe bounded evidence', () => {
    expect(workflow).toContain('.recurringIntelligentSyncChanged == false');
    expect(workflow).toContain('.privateIdentifiersExposed == false');
    expect(workflow).toContain('catalog-engine/ic4c-provider-governor');
    expect(probe).not.toContain('console.log');
    expect(probe).not.toContain('console.error');
  });
});
