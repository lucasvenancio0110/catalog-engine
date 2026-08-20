import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('tenant import queue activation configuration', () => {
  it('keeps the production scheduler explicitly disabled before producer activation', async () => {
    const main = await readJson('wrangler.jsonc');
    expect(main.vars?.TENANT_IMPORT_AUTOMATION_ENABLED).toBe('0');
    expect(main.queues?.producers || []).toEqual([]);
  });

  it('defines a serialized scan consumer with a DLQ and bounded retries', async () => {
    const config = await readJson('wrangler.import-scan.jsonc');
    expect(config.name).toBe('catalog-engine-import-scan');
    expect(config.main).toBe('./worker/import-scan-entry.js');
    expect(config.workers_dev).toBe(false);
    expect(config.dispatch_namespaces).toEqual([
      { binding: 'TENANT_DISPATCH', namespace: 'catalog-engine-production' }
    ]);
    expect(config.queues?.producers).toEqual([
      { binding: 'TENANT_IMPORT_DETAIL_QUEUE', queue: 'catalog-engine-import-detail' }
    ]);
    expect(config.queues?.consumers).toEqual([
      {
        queue: 'catalog-engine-import-scan',
        max_batch_size: 1,
        max_batch_timeout: 5,
        max_retries: 3,
        dead_letter_queue: 'catalog-engine-import-scan-dlq',
        max_concurrency: 1,
        retry_delay: 60
      }
    ]);
  });

  it('defines a deliberately bounded detail consumer with a separate DLQ', async () => {
    const config = await readJson('wrangler.import-detail.jsonc');
    expect(config.name).toBe('catalog-engine-import-detail');
    expect(config.main).toBe('./worker/import-detail-entry.js');
    expect(config.workers_dev).toBe(false);
    expect(config.dispatch_namespaces).toEqual([
      { binding: 'TENANT_DISPATCH', namespace: 'catalog-engine-production' }
    ]);
    expect(config.queues?.producers || []).toEqual([]);
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

  it('keeps scan/detail workers private and bound only to the control D1 plus dispatch namespace', async () => {
    for (const path of ['wrangler.import-scan.jsonc', 'wrangler.import-detail.jsonc']) {
      const config = await readJson(path);
      expect(config.workers_dev).toBe(false);
      expect(config.d1_databases).toHaveLength(1);
      expect(config.d1_databases[0].binding).toBe('CATALOG_DB');
      expect(config.dispatch_namespaces[0].binding).toBe('TENANT_DISPATCH');
      expect(config.routes || []).toEqual([]);
      expect(config.triggers?.crons || []).toEqual([]);
    }
  });
});
