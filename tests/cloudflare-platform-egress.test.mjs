import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');

describe('Cloudflare platform administrative egress', () => {
  it('keeps User Worker upload in trusted CI instead of platform-Worker global fetch', () => {
    expect(wrangler.compatibility_flags || []).not.toContain('global_fetch_strictly_public');
    expect(deployWorkflow).not.toContain('PLATFORM_API_PUBLIC_FETCH');
    expect(deployWorkflow).toContain(
      'Prepare eligible tenant migration command capabilities from trusted CI'
    );
    expect(deployWorkflow).toContain('cloudflare-tenant-data-plane-fleet-prepare.mjs');
  });
});
