import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizePortalProvisioningProgress,
  requestPortalProvisioningProgress
} from '../src/app/provisioning-progress.js';
import { buildMerchantProvisioningProgress } from '../worker/portal-provisioning-progress.js';

const tenantId = 't_0123456789abcdefabcd';

describe('PB7/IC1 merchant-safe provisioning progress', () => {
  it('maps durable initial import detail counters without inventing a percentage', () => {
    const progress = buildMerchantProvisioningProgress({
      provisioning: { status: 'running', current_step: 'import', updated_at: '2026-09-06T14:00:00Z' },
      importJob: {
        status: 'details',
        phase: 'details',
        discovered_count: 320,
        queued_detail_count: 320,
        completed_detail_count: 117,
        failed_detail_count: 0,
        deferred_detail_count: 2,
        published_product_count: 0,
        updated_at: '2026-09-06T14:02:00Z'
      }
    });

    expect(progress).toMatchObject({
      version: 1,
      stage: 'importing',
      status: 'running',
      counters: {
        discovered: 320,
        queued: 320,
        completed: 117,
        failed: 0,
        deferred: 2,
        published: 0
      }
    });
    expect(progress.timing).toBeNull();
    expect(progress).not.toHaveProperty('percent');
    expect(progress).not.toHaveProperty('eta');
    expect(JSON.stringify(progress)).not.toMatch(/provisioningId|importId|source_locator|yupoo\.com|https?:\/\//i);
  });

  it('maps classification and verification to merchant-readable stages', () => {
    const organizing = buildMerchantProvisioningProgress({
      classificationJob: {
        status: 'running',
        product_count: 200,
        automatic_count: 90,
        review_count: 4,
        unknown_count: 6,
        updated_at: '2026-09-06T14:03:00Z'
      }
    });
    expect(organizing.stage).toBe('organizing');
    expect(organizing.counters.processed).toBe(100);

    const ready = buildMerchantProvisioningProgress({
      verificationJob: {
        status: 'success',
        product_count: 200,
        finding_count: 0,
        updated_at: '2026-09-06T14:04:00Z'
      }
    });
    expect(ready).toMatchObject({ stage: 'ready', status: 'complete', counters: { checked: 200, findings: 0 } });
  });

  it('exposes only automatic retry when the durable backend actually scheduled one', () => {
    const progress = buildMerchantProvisioningProgress({
      importJob: {
        status: 'failed',
        phase: 'details',
        discovered_count: 10,
        completed_detail_count: 4,
        next_attempt_at: '2026-09-06T14:10:00Z',
        updated_at: '2026-09-06T14:05:00Z'
      }
    });
    expect(progress.status).toBe('attention');
    expect(progress.retry).toEqual({ kind: 'automatic', scheduledAt: '2026-09-06T14:10:00Z' });
  });

  it('derives a safe baseline from the real import decision and durable phase timestamps', () => {
    const progress = buildMerchantProvisioningProgress({
      decision: { confirmed_at: '2026-09-06T14:00:00Z' },
      importJob: {
        status: 'success',
        phase: 'finalize',
        discovered_count: 100,
        started_at: '2026-09-06T14:00:03Z',
        scan_completed_at: '2026-09-06T14:00:12Z',
        finished_at: '2026-09-06T14:00:42Z',
        updated_at: '2026-09-06T14:00:42Z'
      },
      classificationJob: {
        status: 'success',
        product_count: 100,
        automatic_count: 100,
        review_count: 0,
        unknown_count: 0,
        finished_at: '2026-09-06T14:00:51Z'
      },
      verificationJob: {
        status: 'success',
        product_count: 100,
        finding_count: 0,
        finished_at: '2026-09-06T14:00:57Z',
        updated_at: '2026-09-06T14:00:57Z'
      },
      observedAt: '2026-09-06T14:01:00Z'
    });

    expect(progress.timing).toEqual({
      contract: 'instant-catalog-baseline-v1',
      elapsedMs: 57000,
      milestones: {
        importStartedMs: 3000,
        listingScannedMs: 12000,
        importCompletedMs: 42000,
        classificationCompletedMs: 51000,
        verificationCompletedMs: 57000
      }
    });
    expect(JSON.stringify(progress.timing)).not.toMatch(/tenant|source|provider|url|worker|database/i);
  });
});

describe('PB7/IC1 portal progress client', () => {
  it('accepts only the bounded merchant projection and safe latency baseline', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tenantId,
          provisioning: { provisioningId: 'pv_private', currentStep: 'import' },
          progress: {
            version: 1,
            stage: 'importing',
            status: 'running',
            title: 'Importando os produtos',
            message: 'O Catalog Engine está processando os itens encontrados na fonte conectada.',
            counters: { discovered: 50, completed: 20 },
            retry: null,
            timing: {
              contract: 'instant-catalog-baseline-v1',
              elapsedMs: 9000,
              milestones: { importStartedMs: 2000, listingScannedMs: 8000 },
              sourceLocatorRef: 'loc_private'
            },
            updatedAt: '2026-09-06T14:05:00Z',
            pollAfterMs: 8000,
            sourceLocatorRef: 'loc_private'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const progress = await requestPortalProvisioningProgress({
      tenantId,
      token: 'access-token',
      fetchImpl
    });
    expect(progress).toEqual({
      version: 1,
      stage: 'importing',
      status: 'running',
      title: 'Importando os produtos',
      message: 'O Catalog Engine está processando os itens encontrados na fonte conectada.',
      counters: { discovered: 50, completed: 20 },
      retry: null,
      timing: {
        contract: 'instant-catalog-baseline-v1',
        elapsedMs: 9000,
        milestones: { importStartedMs: 2000, listingScannedMs: 8000 }
      },
      updatedAt: '2026-09-06T14:05:00Z',
      pollAfterMs: 8000
    });
    expect(JSON.stringify(progress)).not.toMatch(/pv_private|loc_private|sourceLocator/i);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });

  it('rejects fake percentages, unknown counters, unsafe timings and unsafe polling values', () => {
    expect(() =>
      normalizePortalProvisioningProgress({
        version: 1,
        stage: 'importing',
        status: 'running',
        title: 'Importando',
        message: 'Processando itens.',
        counters: { percent: 37 },
        pollAfterMs: 8000
      })
    ).toThrow('progress_state_invalid');

    expect(() =>
      normalizePortalProvisioningProgress({
        version: 1,
        stage: 'importing',
        status: 'running',
        title: 'Importando',
        message: 'Processando itens.',
        counters: null,
        timing: { contract: 'instant-catalog-baseline-v1', elapsedMs: 1, milestones: { sourceUrl: 1 } },
        pollAfterMs: 8000
      })
    ).toThrow('progress_state_invalid');

    expect(() =>
      normalizePortalProvisioningProgress({
        version: 1,
        stage: 'importing',
        status: 'running',
        title: 'Importando',
        message: 'Processando itens.',
        counters: null,
        pollAfterMs: 1000
      })
    ).toThrow('progress_state_invalid');
  });

  it('routes a confirmed decision straight into the branded resumable creation experience', async () => {
    const bootstrap = await readFile(
      new URL('../src/app/source-connection-bootstrap.js', import.meta.url),
      'utf8'
    );
    const decisionExperience = await readFile(
      new URL('../src/app/import-decision-experience.js', import.meta.url),
      'utf8'
    );
    const experience = await readFile(
      new URL('../src/app/provisioning-progress-experience.js', import.meta.url),
      'utf8'
    );
    const styles = await readFile(
      new URL('../src/app/provisioning-progress-styles.css', import.meta.url),
      'utf8'
    );

    expect(bootstrap).toContain("card.dataset.catalogAction = 'progress'");
    expect(bootstrap).toContain('openProvisioningProgressExperience');
    expect(bootstrap).toContain('Ver criação da loja');
    expect(bootstrap).toContain('onConfirmed: async () => openProgress(store)');
    expect(decisionExperience).toContain('continueToCreation');
    expect(decisionExperience).toContain('Acompanhar criação da loja');
    expect(experience).toContain("requestBranding({ tenantId: store.tenantId, token })");
    expect(experience).toContain('Estamos montando sua loja.');
    expect(experience).toContain('produtos encontrados');
    expect(experience).toContain('requestPortalPrivatePreviewStatus');
    expect(experience).toContain('Ver minha loja');
    expect(experience).toContain("document.addEventListener('visibilitychange'");
    expect(experience).toContain('lastProgress');
    expect(styles).toContain("data-creation-theme='stadium'");
    expect(styles).toContain('.progress-overlay--light');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(experience).not.toMatch(/\bpercent\b|estimad[oa]|\bETA\b/i);
  });
});
