import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-cleanup-retained-canary.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-cleanup-retained-canary.mjs', 'utf8');

describe('retained automatic import canary cleanup', () => {
  it('keeps pull-request validation secret-free and mutation on trusted main only', () => {
    const validateStart = workflow.indexOf('  validate:');
    const cleanupStart = workflow.indexOf('  cleanup:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(cleanupStart).toBeGreaterThan(validateStart);
    expect(workflow.slice(validateStart, cleanupStart)).not.toContain('secrets.CLOUDFLARE');
    expect(workflow).toContain("if: github.event_name == 'push'");
    expect(workflow).toContain('catalog-engine/retained-canary-cleanup');
  });

  it('fails closed unless automation is OFF, queues are empty and identity is the retained canary', () => {
    expect(script).toContain("TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0'");
    expect(script).toContain('cleanup_canary_queue_not_empty');
    expect(script).toContain("display_name || '') !== 'Automatic Import Canary'");
    expect(script).toContain("source.source_key || '') !== 'auto-canary'");
    expect(script).toContain('`ce-auto-${expectedSuffix}`');
  });

  it('only deletes the targeted canary resources and never sends or purges Queue messages', () => {
    expect(script).toContain("DELETE FROM catalog_tenants WHERE tenant_id=?1");
    expect(script).toContain('/workers/dispatch/namespaces/');
    expect(script).toContain('/d1/database/');
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('/purge');
    expect(script).not.toMatch(/DELETE FROM catalog_tenants(?! WHERE tenant_id=\?1)/);
  });
});
