import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('M7D8 trusted production evidence boundary', () => {
  it('runs the finalization canary only after trusted-main deploy and preserves M7D7 evidence', async () => {
    const workflow = await readFile(
      '.github/workflows/cloudflare-m7d8-finalization-canary.yml',
      'utf8'
    );

    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('catalog-engine/application-deploy');
    expect(workflow).toContain('catalog-engine/tenant-incremental-promotion-authority-canary');
    expect(workflow).toContain('catalog-engine/tenant-incremental-finalization-canary');
    expect(workflow).toContain('node scripts/cloudflare-m7d8-finalization-canary.mjs');
    expect(workflow).toContain('retain isolated evidence');
  });

  it('keeps canary-only changes owned by the trusted application deploy trigger', async () => {
    const deploy = await readFile('.github/workflows/deploy-catalog-api.yml', 'utf8');

    expect(deploy).toContain("'.github/workflows/cloudflare-m7d8-finalization-canary.yml'");
    expect(deploy).toContain("'scripts/cloudflare-m7d8-finalization-canary.mjs'");
  });

  it('uses only isolated mutable databases and leaves recurring production activation off', async () => {
    const [script, configText] = await Promise.all([
      readFile('scripts/cloudflare-m7d8-finalization-canary.mjs', 'utf8'),
      readFile('wrangler.jsonc', 'utf8')
    ]);
    const config = JSON.parse(configText);

    expect(script).toContain('productionControlMutated: false');
    expect(script).toContain('ephemeralControlPlane: true');
    expect(script).toContain('manualQueueMessagesProduced: false');
    expect(script).toContain('crashGapPromotedBeforeControlCommit: true');
    expect(script).toContain('replayObservedAlreadyPromoted: true');
    expect(script).toContain('authorityAdvancedAgainOnReplay: false');
    expect(script).not.toMatch(/TENANT_IMPORT_QUEUE|TENANT_IMPORT_DETAIL_QUEUE|\.sendBatch?\s*\(/);
    expect(config.vars?.TENANT_SYNC_AUTOMATION_ENABLED).toBe('0');
    expect(config.vars?.TENANT_SYNC_ACTIVE_COHORT).toBe('');
    expect(config.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK).toBe('1');
  });
});
