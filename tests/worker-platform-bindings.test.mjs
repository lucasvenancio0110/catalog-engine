import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectWorkerPlatformBindings } from '../scripts/verify-worker-platform-bindings.mjs';

const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');
const diagnosticWorkflow = fs.readFileSync(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-diagnostic.yml',
  'utf8'
);

const platformBindings = [
  { name: 'CLOUDFLARE_PLATFORM_ACCOUNT_ID', type: 'secret_text', text: 'account-id' },
  { name: 'CLOUDFLARE_PLATFORM_API_TOKEN', type: 'secret_text', text: 'must-never-be-returned' }
];
const portalAuthBindings = [
  { name: 'ADMIN_AUTH_ISSUER', type: 'secret_text', text: 'issuer' },
  { name: 'ADMIN_AUTH_AUDIENCE', type: 'secret_text', text: 'audience' },
  { name: 'ADMIN_AUTH_JWKS_URL', type: 'secret_text', text: 'jwks' },
  { name: 'PORTAL_AUTH_CLIENT_ID', type: 'secret_text', text: 'client-id' }
];

describe('main Worker infrastructure binding verification', () => {
  it('accepts infrastructure-only secret names and reports optional bindings safely', () => {
    const evidence = inspectWorkerPlatformBindings({
      success: true,
      result: {
        bindings: [...platformBindings, { name: 'CATALOG_DB', type: 'd1', database_id: 'private-id' }]
      }
    });

    expect(evidence).toEqual({
      workerPlatformBindingsVerified: true,
      bindings: { accountIdPresent: true, apiTokenPresent: true, imagesPresent: false },
      portalAuth: {
        configured: false,
        bindingCount: 0,
        bindings: {
          ADMIN_AUTH_ISSUER: false,
          ADMIN_AUTH_AUDIENCE: false,
          ADMIN_AUTH_JWKS_URL: false,
          PORTAL_AUTH_CLIENT_ID: false
        }
      },
      secretValuesExposed: false
    });
    expect(JSON.stringify(evidence)).not.toContain('must-never-be-returned');
    expect(JSON.stringify(evidence)).not.toContain('private-id');
  });

  it('recognizes the complete portal-auth and Images binding set without reading private values', () => {
    const evidence = inspectWorkerPlatformBindings({
      success: true,
      result: {
        bindings: [...platformBindings, ...portalAuthBindings, { name: 'IMAGES', type: 'images' }]
      }
    });
    expect(evidence.portalAuth).toEqual({
      configured: true,
      bindingCount: 4,
      bindings: {
        ADMIN_AUTH_ISSUER: true,
        ADMIN_AUTH_AUDIENCE: true,
        ADMIN_AUTH_JWKS_URL: true,
        PORTAL_AUTH_CLIENT_ID: true
      }
    });
    expect(evidence.bindings.imagesPresent).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/issuer|audience|jwks|client-id/);
  });

  it('fails closed on an invalid API response and reports a missing platform binding safely', () => {
    expect(() => inspectWorkerPlatformBindings({ success: false })).toThrow(
      'worker_platform_settings_invalid'
    );
    const evidence = inspectWorkerPlatformBindings({
      success: true,
      result: {
        bindings: [
          { name: 'CLOUDFLARE_PLATFORM_ACCOUNT_ID', type: 'secret_text' },
          { name: 'CLOUDFLARE_PLATFORM_API_TOKEN', type: 'plain_text' }
        ]
      }
    });
    expect(evidence.workerPlatformBindingsVerified).toBe(false);
    expect(evidence.bindings).toEqual({
      accountIdPresent: true,
      apiTokenPresent: false,
      imagesPresent: false
    });
    expect(evidence.portalAuth.configured).toBe(false);
    expect(evidence.secretValuesExposed).toBe(false);
  });

  it('uses the read-only Worker settings API in trusted workflows', () => {
    for (const workflow of [deployWorkflow, diagnosticWorkflow]) {
      expect(workflow).toContain('/workers/scripts/catalog-engine/settings');
      expect(workflow).toContain('verify-worker-platform-bindings.mjs');
      expect(workflow).not.toContain('wrangler secret list');
    }
    expect(deployWorkflow).toContain('--forbid-portal-auth');
    expect(deployWorkflow).toContain('--require-portal-auth');
    expect(diagnosticWorkflow).not.toContain('--require-portal-auth');
  });
});