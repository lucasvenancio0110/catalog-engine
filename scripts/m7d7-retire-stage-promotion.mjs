import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, replacements) {
  let text = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (!text.includes(before)) {
      throw new Error(`m7d7_retire_patch_missing:${path}:${before.slice(0, 100)}`);
    }
    text = text.replace(before, after);
  }
  await writeFile(path, text, 'utf8');
}

const stagePath = 'worker/ingestion/incremental-stage.js';
const stage = await readFile(stagePath, 'utf8');
const marker = '\nfunction promotionGate() {';
const markerIndex = stage.indexOf(marker);
if (markerIndex < 0) throw new Error('m7d7_stage_promotion_marker_missing');
const retired = `${stage.slice(0, markerIndex)}\n\n// M7D7 owns the only serving-authority mutation path. This legacy export remains\n// fail-closed so older callers cannot accidentally bypass verified/stale-base CAS.\nexport function buildIncrementalStagePromotionBatch() {\n  throw new Error('tenant_sync_promotion_primitive_moved');\n}\n`;
await writeFile(stagePath, retired, 'utf8');

await patch('tests/tenant-incremental-stage.test.mjs', [
  [
`    executeBatch(database, buildIncrementalStagePromotionBatch({ context }));\n    expect(\n      database.prepare('SELECT source_category_id FROM supplier_album_index WHERE album_source_id=?1').get('100')\n        .source_category_id\n    ).toBe('10');\n    expect(\n      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state\n    ).toBe('planned');`,
`    expect(() => buildIncrementalStagePromotionBatch({ context })).toThrow(\n      'tenant_sync_promotion_primitive_moved'\n    );\n    expect(\n      database.prepare('SELECT source_category_id FROM supplier_album_index WHERE album_source_id=?1').get('100')\n        .source_category_id\n    ).toBe('10');\n    expect(\n      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state\n    ).toBe('planned');`
  ],
  [
`    const promotion = executeBatch(database, buildIncrementalStagePromotionBatch({ context }));\n    expect(promotion.at(-1).results[0].state).toBe('promoted');\n    expect(\n      database.prepare('SELECT source_category_id FROM supplier_album_index WHERE album_source_id=?1').get('100')\n        .source_category_id\n    ).toBe('20');\n    expect(\n      database.prepare('SELECT event_type FROM supplier_sync_events WHERE run_id=?1').get(context.importId)\n        .event_type\n    ).toBe('MOVED');\n    expect(\n      database.prepare('SELECT COUNT(*) AS total FROM catalog_products').get().total\n    ).toBe(0);`,
`    expect(verification.at(-1).results[0].state).toBe('verified');\n    expect(\n      database.prepare('SELECT source_category_id FROM supplier_album_index WHERE album_source_id=?1').get('100')\n        .source_category_id\n    ).toBe('10');\n    expect(\n      database.prepare('SELECT status FROM supplier_sync_runs WHERE run_id=?1').get(context.importId).status\n    ).toBe('running');`
  ],
  [
`    executeBatch(database, buildIncrementalStagePromotionBatch({ context }));\n    expect(\n      database.prepare('SELECT COUNT(*) AS total FROM supplier_album_index').get().total\n    ).toBe(0);`,
`    expect(() => buildIncrementalStagePromotionBatch({ context })).toThrow(\n      'tenant_sync_promotion_primitive_moved'\n    );\n    expect(\n      database.prepare('SELECT COUNT(*) AS total FROM supplier_album_index').get().total\n    ).toBe(0);`
  ]
]);

await patch('tests/tenant-incremental-stage-ledger.test.mjs', [
  [
`  buildIncrementalStagePromotionBatch,\n  buildIncrementalStageVerificationBatch,`,
`  buildIncrementalStageVerificationBatch,`
  ],
  [
`  it('persists opaque scope and closes the canonical run only after verified promotion', () => {`,
`  it('persists opaque scope and leaves canonical run open after stage-only verification', () => {`
  ],
  [
`    executeBatch(database, buildIncrementalStageVerificationBatch({ context }));\n    executeBatch(database, buildIncrementalStagePromotionBatch({ context }));\n\n    expect(\n      database.prepare('SELECT status, error_text FROM supplier_sync_runs WHERE run_id=?1').get(context.importId)\n    ).toMatchObject({ status: 'success', error_text: null });\n    expect(\n      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state\n    ).toBe('promoted');`,
`    executeBatch(database, buildIncrementalStageVerificationBatch({ context }));\n\n    expect(\n      database.prepare('SELECT status, error_text FROM supplier_sync_runs WHERE run_id=?1').get(context.importId)\n    ).toMatchObject({ status: 'running', error_text: null });\n    expect(\n      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state\n    ).toBe('verified');`
  ]
]);

console.log(JSON.stringify({ ok: true, boundary: 'm7d7-single-promotion-owner' }));
