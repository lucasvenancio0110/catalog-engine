import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, from, to, errorCode) {
  const current = await readFile(path, 'utf8');
  const first = current.indexOf(from);
  if (first < 0 || current.indexOf(from, first + from.length) >= 0) throw new Error(errorCode);
  const next = current.slice(0, first) + to + current.slice(first + from.length);
  await writeFile(path, next, 'utf8');
}

const canaryPath = 'scripts/cloudflare-m7d9-removal-canary.mjs';
await replaceOnce(
  canaryPath,
  "import { createD1Database, queryD1Batch } from '../worker/cloudflare-platform.js';\n",
  "import { createD1Database, queryD1Batch } from '../worker/cloudflare-platform.js';\nimport { splitD1Batch } from './d1-batch-chunks.mjs';\n",
  'm7d9_hotfix_import_anchor_invalid'
);

const oldBootstrap = `  await d1Batch(
    fixture.databaseId,
    tenantDataPlaneCurrentBatch({
      tenantId: fixture.tenantId,
      source: {
        provider: 'yupoo',
        sourceKey: SOURCE_KEY,
        sourceUrl: fixture.sourceUrl,
        syncStrategy: 'incremental',
        removalMissThreshold: 3
      }
    })
  );`;
const newBootstrap = `  const schemaBootstrap = tenantDataPlaneCurrentBatch({
    tenantId: fixture.tenantId,
    source: {
      provider: 'yupoo',
      sourceKey: SOURCE_KEY,
      sourceUrl: fixture.sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    }
  });
  for (const chunk of splitD1Batch(schemaBootstrap)) {
    await d1Batch(fixture.databaseId, chunk);
  }`;
await replaceOnce(canaryPath, oldBootstrap, newBootstrap, 'm7d9_hotfix_bootstrap_anchor_invalid');

const testPath = 'tests/tenant-m7d9-removal-canary.test.mjs';
await replaceOnce(
  testPath,
  "    expect(script).toContain('createEphemeralDatabase');\n",
  "    expect(script).toContain('createEphemeralDatabase');\n    expect(script).toContain(\"from './d1-batch-chunks.mjs'\");\n    expect(script).toContain('for (const chunk of splitD1Batch(schemaBootstrap))');\n    expect(script).toContain('await d1Batch(fixture.databaseId, chunk)');\n",
  'm7d9_hotfix_test_anchor_invalid'
);

console.log(JSON.stringify({ m7d9CanarySchemaBatchHotfixApplied: true }));
