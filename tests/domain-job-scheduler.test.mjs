import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { runDueDomainJobs } from '../worker/domain-job-scheduler.js';
import workerEntry from '../worker/entry.js';

describe('custom-domain background runner', () => {
  it('does no provider/database work when the SaaS provider is not configured', async () => {
    const prepare = vi.fn(() => {
      throw new Error('should not query D1 when provider runtime is disabled');
    });
    const result = await runDueDomainJobs({ CATALOG_DB: { prepare } });

    expect(result).toEqual({
      enabled: false,
      reason: 'cloudflare_saas_unconfigured',
      processed: 0
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('fails closed when the database binding is absent', async () => {
    const result = await runDueDomainJobs({
      CLOUDFLARE_SAAS_ZONE_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_SAAS_API_TOKEN: 'token-that-is-long-enough-to-be-a-secret',
      CLOUDFLARE_SAAS_CNAME_TARGET: 'shops.catalogengine.com.br'
    });
    expect(result).toEqual({ enabled: false, reason: 'database_unbound', processed: 0 });
  });

  it('keeps the normal fetch handler and exposes a scheduled handler', () => {
    expect(typeof workerEntry.fetch).toBe('function');
    expect(typeof workerEntry.scheduled).toBe('function');
  });

  it('registers a five-minute cron through wrangler as the deployment source of truth', async () => {
    const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
    expect(config.main).toBe('./worker/entry.js');
    expect(config.triggers?.crons).toEqual(['*/5 * * * *']);
  });
});
