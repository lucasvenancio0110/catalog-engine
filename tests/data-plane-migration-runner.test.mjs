import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  migrationResumeStep,
  runDueDataPlaneMigrations
} from '../worker/data-plane-migration-runner.js';

const runnerSource = fs.readFileSync('worker/data-plane-migration-runner.js', 'utf8');

describe('tenant data-plane migration scheduler', () => {
  it('does not query control-plane D1 or Cloudflare when platform runtime is unconfigured', async () => {
    const prepare = vi.fn(() => {
      throw new Error('D1 should remain untouched while platform runtime is disabled');
    });
    const fetchImpl = vi.fn();

    const result = await runDueDataPlaneMigrations(
      { CATALOG_DB: { prepare } },
      { fetchImpl }
    );

    expect(result).toEqual({
      enabled: false,
      reason: 'cloudflare_platform_unconfigured',
      processed: 0
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before any work when the control-plane database binding is absent', async () => {
    const fetchImpl = vi.fn();
    const result = await runDueDataPlaneMigrations(
      {
        CLOUDFLARE_PLATFORM_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CLOUDFLARE_PLATFORM_API_TOKEN: 'platform-token-that-is-long-enough-for-tests',
        CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production'
      },
      { fetchImpl }
    );

    expect(result).toEqual({ enabled: false, reason: 'database_unbound', processed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('migrates in-flight classify/verify tenants and resumes them at classify instead of reimporting', () => {
    expect(migrationResumeStep('migrations')).toBe('import');
    expect(migrationResumeStep('classify')).toBe('classify');
    expect(migrationResumeStep('verify')).toBe('classify');
    expect(() => migrationResumeStep('publish')).toThrow(
      'tenant_data_plane_migration_resume_step_invalid'
    );

    expect(runnerSource).toContain("r.current_step IN ('migrations','classify','verify')");
    expect(runnerSource).toContain('r.current_step AS resume_step');
    expect(runnerSource).toContain('resumeStep: nextStep');
    expect(runnerSource).not.toContain("SET status='running', current_step='import'");
  });
});
