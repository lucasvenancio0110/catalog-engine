import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPrivateSourceUrl, writeGitHubSourceEnv } from '../scripts/load-private-source-config.mjs';

describe('private supplier source config', () => {
  it('extracts and canonicalizes a Wrangler D1 source row', () => {
    const payload = [
      {
        results: [
          { source_url: 'https://supplier.x.yupoo.com/?page=5' }
        ]
      }
    ];
    expect(extractPrivateSourceUrl(payload)).toBe('https://supplier.x.yupoo.com/albums/');
  });

  it('fails when the tenant has no configured active source row', () => {
    expect(() => extractPrivateSourceUrl([{ results: [] }])).toThrow(/No active supplier source/);
  });

  it('writes the source only to GitHub environment state and emits a masking command', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-source-'));
    const envFile = path.join(dir, 'github-env');
    const chunks = [];
    writeGitHubSourceEnv('https://supplier.x.yupoo.com/albums/', {
      envFile,
      stdout: { write: (chunk) => chunks.push(chunk) }
    });

    expect(fs.readFileSync(envFile, 'utf8')).toBe('SOURCE_URL=https://supplier.x.yupoo.com/albums/\n');
    expect(chunks.join('')).toContain('::add-mask::https://supplier.x.yupoo.com/albums/');
    expect(chunks.join('')).not.toContain('SOURCE_URL=');
  });
});
