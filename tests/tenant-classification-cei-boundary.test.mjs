import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTenantCatalogEvidence } from '../src/catalog-intelligence/core/runtime-evidence.js';
import { classifyCatalogEvidence } from '../src/domain/catalog-classifier.js';

const runnerSource = fs.readFileSync('worker/tenant-classification-runner.js', 'utf8');

describe('tenant classification CEI boundary', () => {
  it('builds tenant-private provenance without leaking provider-shaped fields into the evidence root', () => {
    const evidence = createTenantCatalogEvidence(
      {
        product_id: 'p_123',
        album_source_id: 'album-456',
        source_name: 'Manchester City 26/27 Home Player Version Jersey',
        description: 'Home shirt',
        source_category_name: 'Manchester City'
      },
      {
        provider: 'yupoo',
        source_key: 'primary'
      },
      ['⚽ Premier League', 'Manchester City']
    );

    expect(evidence.recordId).toBe('p_123');
    expect(evidence.provenance).toEqual({
      providerKey: 'yupoo',
      sourceKey: 'primary',
      sourceLocalId: 'album-456'
    });
    expect(evidence).not.toHaveProperty('album_source_id');
    expect(evidence).not.toHaveProperty('source_url');

    const classified = classifyCatalogEvidence(evidence);
    expect(classified.team?.id).toBe('manchester-city');
    expect(classified.league?.id).toBe('premier-league');
  });

  it('fails closed with a stable runtime error when tenant evidence provenance is invalid', () => {
    expect(() =>
      createTenantCatalogEvidence(
        { product_id: 'p_123', source_name: 'Example product' },
        { provider: 'INVALID PROVIDER KEY', source_key: 'primary' },
        []
      )
    ).toThrow('cei_runtime_evidence_invalid');
  });

  it('makes the production tenant runner use the CEI evidence entry point directly', () => {
    expect(runnerSource).toContain("createTenantCatalogEvidence");
    expect(runnerSource).toContain('classifyCatalogEvidence(evidence, row.override_json || null)');
    expect(runnerSource).toContain('s.source_key, s.provider');
    expect(runnerSource).toContain('a.album_source_id, a.source_category_path_json');
    expect(runnerSource).not.toContain('classifyCatalogRecord(');
  });
});
