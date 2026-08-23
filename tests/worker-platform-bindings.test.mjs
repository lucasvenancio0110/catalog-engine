import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectWorkerPlatformBindings } from '../scripts/verify-worker-platform-bindings.mjs';

const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');
const diagnosticWorkflow = fs.readFileSync(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-diagnostic.yml',
  'utf8'
);

describe('main Worker infrastructure binding verification', () => {
  it('accepts only both secret_text binding names and never returns secret values', () => {
    const token = 'must-never-be-returned';
    const evidence = inspectWorkerPlatformBindings({
      success: true,
      result: {
        bindings: [
          {
            name: 'CLOUDFLARE_PLATFORM_ACCOUNT_ID',
            type: 'secret_text',
            text: 'account-id'
          },
          {
            name: 'CLOUDFLARE_PLATFORM_API_TOKEN',
            type: 'secret_text',
            text: token
          },
          { name: 'CATALOG_DB', type: 'd1', database_id: 'private-id' }
        ]
      }
    });

    expect(evidence).toEqual({
      workerPlatformBindingsVerified: true,
      bindings: { accountIdPresent: true, apiTokenPresent: true },
      secretValuesExposed: false
    });
    expect(JSON.stringify(evidence)).not.toContain(token);
    expect(JSON.stringify(evidence)).not.toContain('private-id');
  });

  it('fails closed on an invalid API response and reports a missing binding safely', () => {
    expect(() => inspectWorkerPlatformBindings({ success: false })).toThrow(
      'worker_platform_settings_invalid'
    );
    expect(
      inspectWorkerPlatformBindings({
        success: true,
        result: {
          bindings: [
            { name: 'CLOUDFLARE_PLATFORM_ACCOUNT_ID', type: 'secret_text' },
            { name: 'CLOUDFLARE_PLATFORM_API_TOKEN', type: 'plain_text' }
          ]
        }
      })
    ).toEqual({
      workerPlatformBindingsVerified: false,
      bindings: { accountIdPresent: true, apiTokenPresent: false },
      secretValuesExposed: false
    });
  });

  it('uses the read-only Worker settings API in trusted workflows', () => {
    for (const workflow of [deployWorkflow, diagnosticWorkflow]) {
      expect(workflow).toContain('/workers/scripts/catalog-engine/settings');
      expect(workflow).toContain('verify-worker-platform-bindings.mjs');
      expect(workflow).not.toContain('wrangler secret list');
    }
    expect(deployWorkflow).toContain(
      'verify-worker-platform-bindings.mjs "$WORKER_SETTINGS" --require'
    );
    expect(diagnosticWorkflow).not.toContain(
      'verify-worker-platform-bindings.mjs "$WORKER_SETTINGS" --require'
    );
  });
});
