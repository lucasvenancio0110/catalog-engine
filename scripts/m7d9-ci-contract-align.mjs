import { readFile, writeFile } from 'node:fs/promises';

const path = 'tests/tenant-data-plane-fleet-migration.test.mjs';
const url = new URL(`../${path}`, import.meta.url);
let source = await readFile(url, 'utf8');

const from = `it('keeps tenant schema CI aligned with the v7 fleet target and migration ownership', () => {\n    for (const workflow of [saasWorkflow, ingestionWorkflow]) {\n      expect(workflow).toContain('schema_version FROM data_plane_identity');\n      expect(workflow).toContain("= '7'");\n      expect(workflow).toContain("= '1,2,3,4,5,6,7'");\n      expect(workflow).toContain('catalog_product_intelligence_state');\n      expect(workflow).toContain('supplier_sync_stage_runs');\n      expect(workflow).toContain('supplier_sync_stage_observations');\n      expect(workflow).toContain('supplier_sync_stage_events');\n      expect(workflow).toContain('supplier_sync_stage_categories');\n      expect(workflow).toContain('supplier_sync_stage_product_details');\n      expect(workflow).toContain('supplier_sync_stage_intelligence_state');\n    }`;
const to = `it('keeps tenant schema CI aligned with the v8 fleet target and migration ownership', () => {\n    for (const workflow of [saasWorkflow, ingestionWorkflow]) {\n      expect(workflow).toContain('schema_version FROM data_plane_identity');\n      expect(workflow).toContain("= '8'");\n      expect(workflow).toContain("= '1,2,3,4,5,6,7,8'");\n      expect(workflow).toContain('catalog_product_intelligence_state');\n      expect(workflow).toContain('supplier_sync_stage_runs');\n      expect(workflow).toContain('supplier_sync_stage_observations');\n      expect(workflow).toContain('supplier_sync_stage_events');\n      expect(workflow).toContain('supplier_sync_stage_categories');\n      expect(workflow).toContain('supplier_sync_stage_product_details');\n      expect(workflow).toContain('supplier_sync_stage_intelligence_state');\n      expect(workflow).toContain('supplier_scope_memberships');\n      expect(workflow).toContain('supplier_sync_stage_removal_policy');\n      expect(workflow).toContain('catalog_product_classification_override_retention');\n      expect(workflow).toContain('catalog_product_effective_classification_overrides');\n    }`;

const first = source.indexOf(from);
if (first < 0) throw new Error('m7d9_ci_align_missing:fleet-static-ci-contract');
if (source.indexOf(from, first + from.length) >= 0) {
  throw new Error('m7d9_ci_align_ambiguous:fleet-static-ci-contract');
}
source = source.slice(0, first) + to + source.slice(first + from.length);
await writeFile(url, source, 'utf8');
console.log(JSON.stringify({ m7d9CiStaticContractAligned: true }));
