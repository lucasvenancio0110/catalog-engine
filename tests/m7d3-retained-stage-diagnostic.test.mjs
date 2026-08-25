import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(
  new URL('../scripts/cloudflare-m7d3-retained-stage-diagnostic.mjs', import.meta.url),
  'utf8'
);

describe('M7D3 retained stage diagnostic', () => {
  it('is read-only and reports bounded stage count evidence', () => {
    expect(source).toContain('m7d3RetainedStageDiagnostic: true');
    expect(source).toContain("mismatches.push('categories')");
    expect(source).toContain('supplier_sync_stage_observations');
    expect(source).toContain('supplier_sync_stage_events');
    expect(source).toContain('supplier_sync_stage_categories');
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b\s+(?:INTO\s+)?(?:tenant_|supplier_|catalog_)/i);
    expect(source).not.toContain('/messages');
    expect(source).not.toContain('/purge');
  });

  it('does not print private source URLs or provider payloads', () => {
    expect(source).not.toContain('source_url');
    expect(source).not.toContain('sourceUrl');
    expect(source).not.toContain('rawHtml');
  });
});
