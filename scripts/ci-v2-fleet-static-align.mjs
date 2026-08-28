import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../tests/tenant-data-plane-fleet-canary.test.mjs', import.meta.url);
let source = await readFile(path, 'utf8');
const from = `    expect(workflow).toContain("format('catalog-engine-tenant-fleet-pr-{0}'");\n    expect(workflow).toContain("|| 'catalog-engine-production-d1'");\n    expect(workflow).toContain("cancel-in-progress: \${{ github.event_name == 'pull_request' }}");`;
const to = `    const prerequisiteStart = workflow.indexOf('  prerequisites:');\n    expect(prerequisiteStart).toBeGreaterThan(-1);\n    expect(canaryStart).toBeGreaterThan(prerequisiteStart);\n    expect(workflow.slice(prerequisiteStart, canaryStart)).not.toContain(\n      'group: catalog-engine-production-d1'\n    );\n    expect(workflow.slice(canaryStart)).toContain('group: catalog-engine-production-d1');\n    expect(workflow).toContain('application and Queue evidence outside mutation lock');\n    expect(workflow).toContain("needs.prerequisites.result == 'success'");\n    expect(workflow).toContain('ref: \${{ needs.prerequisites.outputs.sha }}');`;
const first = source.indexOf(from);
if (first < 0) throw new Error('fleet_static_old_concurrency_contract_missing');
if (source.indexOf(from, first + from.length) >= 0) throw new Error('fleet_static_old_concurrency_contract_ambiguous');
source = source.slice(0, first) + to + source.slice(first + from.length);
await writeFile(path, source, 'utf8');
console.log(JSON.stringify({ fleetStaticConcurrencyAligned: true }));
