import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readWorkflow = (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

describe('production deployment pipeline boundary', () => {
  it('keeps catalog data replacement out of the application deployment workflow', async () => {
    const workflow = await readWorkflow('deploy-catalog-api.yml');

    expect(workflow).not.toContain('sync-public-catalog-d1.mjs');
    expect(workflow).not.toContain('PUBLIC_CATALOG_SQL_DIR');
    expect(workflow).not.toContain('Atomically replace public catalog');
    expect(workflow).not.toContain('Atomically update normalized public D1 catalog');

    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npm run build:verify');
    expect(workflow).toContain('wrangler@$WRANGLER_VERSION" deploy');
    expect(workflow).toContain('Checkout triggering main SHA');
    expect(workflow).toContain('ref: ${{ github.sha }}');

    const buildIndex = workflow.indexOf('npm run build');
    const migrationIndex = workflow.indexOf('d1 migrations apply CATALOG_DB --remote');
    const deployIndex = workflow.indexOf('wrangler@$WRANGLER_VERSION" deploy');

    expect(buildIndex).toBeGreaterThan(-1);
    expect(migrationIndex).toBeGreaterThan(buildIndex);
    expect(deployIndex).toBeGreaterThan(migrationIndex);
  });

  it('keeps default snapshot publication manual and separate from Worker deployment', async () => {
    const workflow = await readWorkflow('publish-default-catalog.yml');

    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('Type PUBLISH');
    expect(workflow).toContain('sync-public-catalog-d1.mjs');
    expect(workflow).toContain('d1 execute CATALOG_DB --remote');

    expect(workflow).not.toContain('wrangler@$WRANGLER_VERSION" deploy');
    expect(workflow).not.toContain('d1 migrations apply CATALOG_DB --remote');
  });

  it('deploys and verifies infrastructure-only migration secrets without exposing their values', async () => {
    const workflow = await readWorkflow('deploy-catalog-api.yml');
    const deployIndex = workflow.indexOf('Deploy Worker and static application assets');
    const verifyIndex = workflow.indexOf('Verify main Worker infrastructure secret bindings');

    expect(workflow).toContain(
      'CLOUDFLARE_PLATFORM_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_PLATFORM_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID }}'
    );
    expect(workflow).toContain(
      'CLOUDFLARE_PLATFORM_API_TOKEN: ${{ secrets.CLOUDFLARE_PLATFORM_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}'
    );
    expect(workflow).toContain('RUNTIME_SECRETS="$(mktemp)"');
    expect(workflow).toContain('trap \'rm -f "$RUNTIME_SECRETS"\' EXIT');
    expect(workflow).toContain('chmod 600 "$RUNTIME_SECRETS"');
    expect(workflow).toContain('--secrets-file "$RUNTIME_SECRETS"');
    expect(workflow).toContain(
      'secret list --name catalog-engine --config wrangler.jsonc --format json'
    );
    expect(workflow).toContain('.name == "CLOUDFLARE_PLATFORM_ACCOUNT_ID"');
    expect(workflow).toContain('.name == "CLOUDFLARE_PLATFORM_API_TOKEN"');
    expect(workflow).not.toContain('wrangler secret put');
    expect(workflow).not.toContain('wrangler secret bulk');
    expect(verifyIndex).toBeGreaterThan(deployIndex);
  });
});
