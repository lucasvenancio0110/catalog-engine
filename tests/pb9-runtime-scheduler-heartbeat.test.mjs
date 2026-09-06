import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  evaluateRuntimeSchedulerHeartbeat,
  safeRuntimeSchedulerHeartbeatEvidence
} from '../scripts/cloudflare-pb9-runtime-scheduler-heartbeat.mjs';

describe('PB9 runtime scheduler heartbeat', () => {
  it('projects only bounded aggregate scheduler state', () => {
    const evaluation = evaluateRuntimeSchedulerHeartbeat({
      stage: 'completed',
      discovered_count: 2,
      selected_count: 1,
      processed_count: 1,
      last_error_code: null,
      heartbeat_age_seconds: 18
    });
    expect(evaluation).toEqual({
      observed: true,
      stage: 'completed',
      discovered: 2,
      selected: 1,
      processed: 1,
      lastErrorCode: 'none',
      heartbeatAgeSeconds: 18
    });
    expect(safeRuntimeSchedulerHeartbeatEvidence(evaluation)).toEqual({
      pb9RuntimeSchedulerHeartbeat: 'observed',
      scheduler: evaluation
    });
  });

  it('fails safe for unknown stages and malformed error codes', () => {
    const evaluation = evaluateRuntimeSchedulerHeartbeat({
      stage: 'tenant-id:t_deadbeefdeadbeefdead',
      last_error_code: 'worker_script=private-locator'
    });
    expect(evaluation.stage).toBe('unknown');
    expect(evaluation.observed).toBe(false);
    expect(evaluation.lastErrorCode).toBe('none');
  });

  it('wires a best-effort heartbeat around runtime activation without changing tenant authority', async () => {
    const [entry, migration] = await Promise.all([
      readFile(new URL('../worker/entry.js', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/0027_tenant_runtime_scheduler_state.sql', import.meta.url), 'utf8')
    ]);
    const entered = entry.indexOf("stage: 'entered'");
    const runtime = entry.indexOf('const runtimeSummary = await runDueTenantRuntimes(env);');
    const completed = entry.indexOf("stage: runtimeSummary.enabled === false ? 'disabled' : 'completed'");
    const batch = entry.indexOf('const results = await Promise.allSettled([');

    expect(entered).toBeGreaterThan(-1);
    expect(runtime).toBeGreaterThan(entered);
    expect(completed).toBeGreaterThan(runtime);
    expect(batch).toBeGreaterThan(completed);
    expect(entry).toContain("stage: 'failed'");
    expect(entry).toContain('scheduler_heartbeat_write_failed');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS tenant_runtime_scheduler_state');
    expect(migration).toContain('CHECK (singleton_id = 1)');
    expect(migration).not.toMatch(/tenant_id|worker_script|d1_database_id|principal_id/i);
  });
});
