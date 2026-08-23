import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('Cloudflare platform administrative egress', () => {
  it('routes Workers for Platforms API upload through strict public fetch', () => {
    expect(wrangler.compatibility_flags).toContain('global_fetch_strictly_public');
    expect(deployWorkflow).toContain('PLATFORM_API_PUBLIC_FETCH');
    expect(deployWorkflow).toContain('GLOBAL_FETCH_STRICTLY_PUBLIC=$PLATFORM_API_PUBLIC_FETCH');
  });
});
