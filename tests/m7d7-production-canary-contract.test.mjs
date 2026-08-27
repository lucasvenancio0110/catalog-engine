import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const promotionCanary = await readFile('scripts/cloudflare-incremental-scan-stage-canary.mjs', 'utf8');
const promotionWorkflow = await readFile(
  '.github/workflows/cloudflare-incremental-scan-stage-canary.yml',
  'utf8'
);
const fleetCanary = await readFile('scripts/cloudflare-tenant-data-plane-fleet-canary.mjs', 'utf8');
const fleetWorkflow = await readFile(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml',
  'utf8'
);
const deployWorkflow = await readFile('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('M7D7 trusted-main production canary contracts', () => {
  it('keeps D4-D6 scheduler-owned and invokes the D7 primitive only after verified state', () => {
    expect(promotionCanary).toContain("import { processTenantIncrementalPromotion } from '../worker/ingestion/incremental-promotion.js';");
    const verifiedIndex = promotionCanary.indexOf('await waitForVerifiedCandidate(fixture)');
    const promotionIndex = promotionCanary.indexOf('await processTenantIncrementalPromotion(');
    expect(verifiedIndex).toBeGreaterThan(0);
    expect(promotionIndex).toBeGreaterThan(verifiedIndex);
    expect(promotionCanary).toContain('canonicalLkgUnchangedThroughVerification: true');
    expect(promotionCanary).toContain('incrementalPromotionAuthorityCanaryPassed: true');
    expect(promotionCanary).toContain('authorityAdvancedExactlyOnce');
    expect(promotionCanary).toContain('controlPlaneStillFinalizing');
    expect(promotionCanary).toContain('cursorAdvanced: false');
    expect(promotionCanary).toContain('removalActivated: false');
    expect(promotionCanary).toContain('manualQueueMessagesProduced: false');
    expect(promotionCanary).not.toContain('.send(');
  });

  it('publishes a dedicated exact-SHA M7D7 status without weakening historical M7D4-D6 evidence', () => {
    expect(promotionWorkflow).toContain(
      'M7D7_STATUS_CONTEXT: catalog-engine/tenant-incremental-promotion-authority-canary'
    );
    for (const context of [
      'M7D4_STATUS_CONTEXT',
      'M7D5_STATUS_CONTEXT',
      'M7D6_STATUS_CONTEXT',
      'M7D7_STATUS_CONTEXT'
    ]) {
      expect(promotionWorkflow).toContain(`publish_status \"$${context}\"`);
    }
    expect(promotionWorkflow).toContain('Wait for exact-SHA Queue consumer activation');
    expect(promotionWorkflow).toContain("'worker/tenant-data-plane-schema-v7.js'");
    expect(promotionWorkflow).toContain("'tests/tenant-incremental-promotion.test.mjs'");
    expect(deployWorkflow).toContain("'.github/workflows/cloudflare-incremental-scan-stage-canary.yml'");
    expect(deployWorkflow).toContain("'scripts/cloudflare-incremental-scan-stage-canary.mjs'");
    expect(deployWorkflow).toContain("'worker/**'");
  });

  it('proves the fleet transition is v6 to v7 before D7 production authority proof', () => {
    expect(fleetCanary).toContain("from '../worker/tenant-data-plane-schema-v6.js';");
    expect(fleetCanary).toContain("from '../worker/tenant-data-plane-schema-v7.js';");
    expect(fleetCanary).toContain('PREVIOUS_SCHEMA_VERSION !== 6 || CURRENT_SCHEMA_VERSION !== 7');
    expect(fleetCanary).toContain("? '1,2,3,4,5,6,7' : '1,2,3,4,5,6'");
    expect(fleetCanary).toContain("name IN ('catalog_serving_authority','supplier_sync_stage_authority')");
    expect(fleetWorkflow).toContain("'worker/tenant-data-plane-schema-v7.js'");
    expect(fleetWorkflow).toContain('scheduler-owned v6 to v7 fleet maintenance');
    expect(fleetWorkflow).toContain('Cron upgraded isolated v6 tenant to v7');
  });
});
