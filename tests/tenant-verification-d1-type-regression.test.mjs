import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('tenant verification D1 type coercion regression', () => {
  it('accepts a string-bound merchandising contract version like the tenant dispatch boundary sends', async () => {
    const source = await readFile(
      new URL('../worker/tenant-verification-runner.js', import.meta.url),
      'utf8'
    );
    expect(source).toContain('END=CAST(?1 AS INTEGER)');

    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE catalog_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      )`);
      db.prepare('INSERT INTO catalog_meta (key, value_json) VALUES (?1, ?2)').run(
        'merchandising',
        JSON.stringify({ contractVersion: 1, navigationItems: 4 })
      );

      const row = db
        .prepare(`SELECT COUNT(*) AS total
                    FROM catalog_meta
                   WHERE key='merchandising'
                     AND json_valid(value_json)=1
                     AND CASE WHEN json_valid(value_json)=1
                              THEN CAST(json_extract(value_json,'$.contractVersion') AS INTEGER)
                              ELSE 0 END=CAST(?1 AS INTEGER)
                     AND CASE WHEN json_valid(value_json)=1
                              THEN CAST(json_extract(value_json,'$.navigationItems') AS INTEGER)
                              ELSE 0 END>0`)
        .get('1');

      expect(Number(row.total)).toBe(1);
    } finally {
      db.close();
    }
  });
});
