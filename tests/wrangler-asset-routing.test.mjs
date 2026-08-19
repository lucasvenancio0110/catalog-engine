import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrangler = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

describe('Wrangler static-asset routing', () => {
  it('runs the platform Worker before navigation and non-hashed asset paths', () => {
    expect(wrangler.assets?.run_worker_first).toEqual(['/*', '!/assets/*']);
  });

  it('keeps hashed frontend bundles on the direct static-asset fast path', () => {
    expect(wrangler.assets?.run_worker_first).toContain('!/assets/*');
  });
});
