import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const entry = await readFile('worker/import-detail-entry.js', 'utf8');
const config = JSON.parse(await readFile('wrangler.import-detail.jsonc', 'utf8'));

describe('IC4D tenant D1 write-pressure activation boundary', () => {
  it('binds the per-tenant write governor beside, not instead of, the IC4C provider governor', () => {
    expect(config.durable_objects?.bindings).toEqual(
      expect.arrayContaining([
        { name: 'PROVIDER_DETAIL_GOVERNOR', class_name: 'ProviderDetailGovernor' },
        { name: 'TENANT_D1_WRITE_GOVERNOR', class_name: 'TenantD1WriteGovernor' }
      ])
    );
    expect(config.migrations).toEqual(
      expect.arrayContaining([
        {
          tag: 'ic4d-tenant-d1-write-governor-v1',
          new_sqlite_classes: ['TenantD1WriteGovernor']
        }
      ])
    );
  });

  it('routes both initial and incremental detail persistence through the governed dispatch env', () => {
    expect(entry).toContain('createTenantD1WriteGovernedEnv');
    expect(entry).toContain('const governedEnv = createTenantD1WriteGovernedEnv(env)');
    expect(entry).toContain('handleDetail(parsed, governedEnv)');
    expect(entry).toContain('recoverExhaustedInitialDetailLeases(parsed, governedEnv)');
    expect(entry).toContain('handleTenantImportFinalizeMessage(parsed, governedEnv)');
  });

  it('keeps recurring sync disabled and preserves the existing Queue rollback template', () => {
    expect(config.queues?.consumers).toEqual([
      {
        queue: 'catalog-engine-import-detail',
        max_batch_size: 4,
        max_batch_timeout: 5,
        max_retries: 5,
        dead_letter_queue: 'catalog-engine-import-detail-dlq',
        max_concurrency: 2,
        retry_delay: 120
      }
    ]);
  });
});
