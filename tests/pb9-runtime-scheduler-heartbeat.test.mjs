import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  evaluateOldestCandidatePreclaim,
  evaluateRuntimeSchedulerHeartbeat,
  safeRuntimeSchedulerHeartbeatEvidence
} from '../scripts/cloudflare-pb9-runtime-scheduler-heartbeat.mjs';

describe('PB9 runtime scheduler heartbeat', () => {
  it('projects only bounded aggregate scheduler state and boolean preclaim gates', () => {
    const evaluation = evaluateRuntimeSchedulerHeartbeat({
      stage: 'completed',
      discovered_count: 2,
      selected_count: 1,
      processed_count: 1,
      last_error_code: null,
      heartbeat_age_seconds: 18
    });
    const preclaim = evaluateOldestCandidatePreclaim({
      data_plane_active: 1,
      data_plane_locator_present: 1,
      worker_locator_present: 1,
      dispatch_namespace_matches: 1,
      schema_ready: 1,
      store_profile_present: 1
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
    expect(preclaim).toEqual({
      ready: true,
      gates: {
        dataPlaneActive: true,
        dataPlaneLocatorPresent: true,
        workerLocatorPresent: true,
        dispatchNamespaceMatches: true,
        schemaReady: true,
        storeProfilePresent: true
      }
    });
    expect(safeRuntimeSchedulerHeartbeatEvidence(evaluation, preclaim)).toEqual({
      pb9RuntimeSchedulerHeartbeat: 'observed',
      scheduler: evaluation,
      oldestCandidatePreclaim: preclaim
    });
  });

  it('fails safe for unknown stages, malformed error codes and incomplete preclaim state', () => {
    const evaluation = evaluateRuntimeSchedulerHeartbeat({
      stage: 'tenant-id:t_deadbeefdeadbeefdead',
      last_error_code: 'worker_script=private-locator'
    });
    const preclaim = evaluateOldestCandidatePreclaim({
      data_plane_active: 1,
      data_plane_locator_present: 1,
      worker_locator_present: 1,
      dispatch_namespace_matches: 1,
      schema_ready: 1,
      store_profile_present: 0
    });
    expect(evaluation.stage).toBe('unknown');
    expect(evaluation.observed).toBe(false);
    expect(evaluation.lastErrorCode).toBe('none');
    expect(preclaim.ready).toBe(false);
    expect(preclaim.gates.storeProfilePresent).toBe(false);
  });

  it('wires a best-effort heartbeat around runtime activation without changing tenant authority', async () => {
    const [entry, migration, diagnostic, workflow] = await Promise.all([
      readFile(new URL('../worker/entry.js', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/0027_tenant_runtime_scheduler_state.sql', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/cloudflare-pb9-runtime-scheduler-heartbeat.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/cloudflare-pb9-runtime-scheduler-heartbeat.yml', import.meta.url), 'utf8')
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
    expect(diagnostic).toContain("p.dispatch_namespace='catalog-engine-production'");
    expect(diagnostic).toContain('p.worker_script_name IS NOT NULL');
    expect(diagnostic).toContain('p.d1_database_id IS NOT NULL');
    expect(diagnostic).toContain('LEFT JOIN tenant_store_profiles s ON s.tenant_id=o.tenant_id');
    expect(diagnostic).toContain('AS store_profile_present');
    expect(workflow).toContain('push:');
    expect(workflow).toContain("github.event_name == 'push'");
  });
});
