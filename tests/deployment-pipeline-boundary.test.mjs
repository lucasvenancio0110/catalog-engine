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

  it('keeps immediate deploy and scheduled trusted staging from competing on the same push', async () => {
    const deployWorkflow = await readWorkflow('deploy-catalog-api.yml');
    const trustedWorkflow = await readWorkflow('cloudflare-trusted-fresh-tenant-provision.yml');

    expect(deployWorkflow).toMatch(/^\s*push:\s*$/m);
    expect(deployWorkflow).toContain('group: catalog-engine-production-d1');
    expect(deployWorkflow).toContain('cancel-in-progress: false');

    expect(trustedWorkflow).not.toMatch(/^\s*push:\s*$/m);
    expect(trustedWorkflow).not.toContain("github.event_name == 'push'");
    expect(trustedWorkflow).toContain("cron: '2-57/5 * * * *'");
    expect(trustedWorkflow).toContain('group: catalog-engine-production-d1');
    expect(trustedWorkflow).toContain('cancel-in-progress: false');
  });

  it('deploys exact main when trusted provisioning orchestration changes', async () => {
    const workflow = await readWorkflow('deploy-catalog-api.yml');
    for (const path of [
      '.github/workflows/cloudflare-trusted-fresh-tenant-provision.yml',
      'scripts/cloudflare-trusted-fresh-tenant-provision.mjs',
      'scripts/cloudflare-trusted-tenant-runtime-stage.mjs',
      'tests/trusted-fresh-tenant-provision.test.mjs',
      'tests/trusted-tenant-runtime-stage.test.mjs',
      'tests/tenant-runtime-runner.test.mjs'
    ]) {
      expect(workflow).toContain(`- '${path}'`);
    }
  });

  it('deploys exact main when IC2 production-proof orchestration changes', async () => {
    const workflow = await readWorkflow('deploy-catalog-api.yml');
    for (const path of [
      '.github/workflows/cloudflare-ic2-production-proof.yml',
      'tests/ic2-production-proof.test.mjs'
    ]) {
      expect(workflow).toContain(`- '${path}'`);
    }
  });

  it('deploys exact main when IC3 production-proof orchestration changes', async () => {
    const workflow = await readWorkflow('deploy-catalog-api.yml');
    for (const path of [
      '.github/workflows/cloudflare-ic3-listing-production-proof.yml',
      'scripts/cloudflare-ic3-listing-proof.mjs',
      'scripts/cloudflare-ic3-regression-seal.mjs',
      'tests/ic3-listing-production-proof.test.mjs',
      'tests/ic3-regression-seal.test.mjs',
      'tests/ic3-proof-provider-path.test.mjs',
      'tests/ic3-gallery-route.test.mjs',
      'tests/ic3-progressive-construction.test.mjs',
      'tests/tenant-import-scan.test.mjs'
    ]) {
      expect(workflow).toContain(`- '${path}'`);
    }
  });

  it('keeps privileged post-deploy canaries out of the direct-push production lock collision', async () => {
    const postDeployCanaries = [
      'cloudflare-tenant-data-plane-fleet-canary.yml',
      'cloudflare-auto-tenant-import-canary.yml',
      'cloudflare-m7d10-recovery-canary.yml',
      'cloudflare-ic2-production-proof.yml'
    ];

    for (const name of postDeployCanaries) {
      const workflow = await readWorkflow(name);
      expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
      expect(workflow).not.toMatch(/^\s*push:\s*$/m);
      expect(workflow).toContain('group: catalog-engine-production-d1');
      expect(workflow).toContain('cancel-in-progress: false');
    }
  });

  it('keeps IC2 proof transport bounded before it is allowed to measure production latency', async () => {
    const workflow = await readWorkflow('cloudflare-ic2-production-proof.yml');
    const readyIndex = workflow.indexOf('Wait for ephemeral proof route readiness');
    const measureIndex = workflow.indexOf('Measure fresh-tenant TTFI and TTFC in production');

    expect(workflow).toContain("'global_fetch_strictly_public'");
    expect(workflow).toContain('for attempt in $(seq 1 30)');
    expect(workflow).toContain('ic2_proof_worker_ready=true');
    expect(readyIndex).toBeGreaterThan(-1);
    expect(measureIndex).toBeGreaterThan(readyIndex);
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

  it('keeps a manual application redeploy entrypoint for trusted runtime-secret changes', async () => {
    const workflow = await readWorkflow('deploy-catalog-api.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('Checkout triggering main SHA');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('ADMIN_AUTH_ISSUER: ${{ secrets.ADMIN_AUTH_ISSUER }}');
    expect(workflow).toContain('ADMIN_AUTH_AUDIENCE: ${{ secrets.ADMIN_AUTH_AUDIENCE }}');
    expect(workflow).toContain('ADMIN_AUTH_JWKS_URL: ${{ secrets.ADMIN_AUTH_JWKS_URL }}');
    expect(workflow).toContain('PORTAL_AUTH_CLIENT_ID: ${{ secrets.PORTAL_AUTH_CLIENT_ID }}');
  });

  it('deploys and verifies runtime secrets without exposing their values', async () => {
    const workflow = await readWorkflow('deploy-catalog-api.yml');
    const deployIndex = workflow.indexOf('Deploy Worker and static application assets');
    const verifyIndex = workflow.indexOf(
      'Verify main Worker infrastructure and portal-auth secret bindings'
    );

    expect(workflow).toContain(
      'CLOUDFLARE_PLATFORM_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_PLATFORM_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID }}'
    );
    expect(workflow).toContain(
      'CLOUDFLARE_PLATFORM_API_TOKEN: ${{ secrets.CLOUDFLARE_PLATFORM_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}'
    );
    for (const name of [
      'ADMIN_AUTH_ISSUER',
      'ADMIN_AUTH_AUDIENCE',
      'ADMIN_AUTH_JWKS_URL',
      'PORTAL_AUTH_CLIENT_ID'
    ]) {
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(workflow).toContain('RUNTIME_SECRETS="$(mktemp)"');
    expect(workflow).toContain('node scripts/build-worker-runtime-secrets.mjs "$RUNTIME_SECRETS"');
    expect(workflow).toContain('--secrets-file "$RUNTIME_SECRETS"');
    expect(workflow).toContain('/workers/scripts/catalog-engine/settings');
    expect(workflow).toContain('--forbid-portal-auth');
    expect(workflow).toContain('--require-portal-auth');
    expect(workflow).toContain("'scripts/build-worker-runtime-secrets.mjs'");
    expect(workflow).toContain("'scripts/verify-worker-platform-bindings.mjs'");
    expect(workflow).not.toContain('wrangler secret put');
    expect(workflow).not.toContain('wrangler secret bulk');
    expect(workflow).not.toContain('wrangler secret list');
    expect(verifyIndex).toBeGreaterThan(deployIndex);
  });

  it('runs the PB6 merchant acceptance proof only after successful trusted-main evidence', async () => {
    const workflow = await readWorkflow('cloudflare-pb6-merchant-acceptance.yml');

    expect(workflow).toContain("- 'Deploy Catalog Engine application'");
    expect(workflow).toContain("- 'Cloudflare trusted fresh tenant provisioning'");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('catalog-engine/pb6-merchant-acceptance');
    expect(workflow).toContain('PB6 real merchant acceptance is still pending or invalid');
    expect(workflow).not.toContain('system_canary');
    expect(workflow).not.toContain('TENANT_SYNC_AUTOMATION_ENABLED=1');
  });
});
