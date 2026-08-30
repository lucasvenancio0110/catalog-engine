import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, value) {
  fs.writeFileSync(path, value);
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${path}: anchor not found:\n${before.slice(0, 180)}`);
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(`${path}: anchor is not unique`);
  write(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function replaceRegexOnce(path, regex, replacement) {
  const source = read(path);
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`${path}: expected 1 regex match, found ${matches.length}: ${regex}`);
  write(path, source.replace(regex, replacement));
}

// CURRENT-STATE
replaceOnce(
  'docs/CURRENT-STATE.md',
  'Snapshot: **2026-08-27 after M7D8 trusted-main production proof**',
  'Snapshot: **2026-08-30 after M7D9 trusted-main production proof**',
);
replaceOnce(
  'docs/CURRENT-STATE.md',
  '- M7D8 production closure evidence lives in `docs/M7D8-CLOSURE-2026-08-27.md`.',
  '- M7D8 production closure evidence lives in `docs/M7D8-CLOSURE-2026-08-27.md`.\n- M7D9 production closure evidence lives in `docs/M7D9-CLOSURE-2026-08-30.md`.',
);
replaceOnce(
  'docs/CURRENT-STATE.md',
  '- **M7 Intelligent Sync v2: current execution milestone; safety/scheduling/delta/staging/schema-fleet/candidate-state foundations plus controlled enrollment, live incremental dispatch/scan, affected-detail completion, affected-only CEI candidate processing, complete private candidate verification and atomic promotion authority plus post-promotion cursor/schedule/control finalization through M7D8 are production-proven**.',
  '- **M7 Intelligent Sync v2: current execution milestone; safety/scheduling/delta/staging/schema-fleet/candidate-state foundations plus controlled enrollment, live incremental dispatch/scan, affected-detail completion, affected-only CEI candidate processing, complete private candidate verification, atomic promotion authority, post-promotion cursor/schedule/control finalization and repeated-miss scoped removal/restoration through M7D9 are production-proven**.',
);
replaceOnce(
  'docs/CURRENT-STATE.md',
  '## M7 state — M7A through M7D8 production-proven',
  '## M7 state — M7A through M7D9 production-proven',
);
replaceOnce(
  'docs/CURRENT-STATE.md',
  'M7 remains the active milestone. Safety, scheduler, provider-neutral listing delta, private listing stage, additive schema fleet, candidate-state schema, controlled enrollment, live incremental dispatcher-to-private-stage, affected-detail candidate completion, affected-only CEI candidate processing, complete private candidate verification and atomic canonical promotion authority are now production-proven through M7D8.',
  'M7 remains the active milestone. Safety, scheduler, provider-neutral listing delta, private listing stage, additive schema fleet, candidate-state schema, controlled enrollment, live incremental dispatcher-to-private-stage, affected-detail candidate completion, affected-only CEI candidate processing, complete private candidate verification, atomic canonical promotion authority, post-promotion finalization and repeated-miss scoped removal/restoration are now production-proven through M7D9.',
);
replaceOnce(
  'docs/CURRENT-STATE.md',
  '→ M7A–M7D6 safety, delta/staging, schema fleet, candidate-state, enrollment, live scan, affected-detail, affected-only CEI and complete private candidate verification ✅ production-proven',
  '→ M7A–M7D9 safety, delta/staging, schema fleet, candidate-state, enrollment, live scan, affected-detail, affected-only CEI, verification, atomic promotion/finalization and safe scoped removal/restoration ✅ production-proven',
);
replaceOnce(
  'docs/CURRENT-STATE.md',
  '**M7D9 — Repeated Miss and Safe Removal**\n\nM7D9 must add authoritative repeated-miss/removal/restoration semantics only from independent complete, healthy, plausible and safety-authorized promoted runs. Duplicate delivery must not increment miss state twice; incomplete scopes, outages and implausible scans must not reduce healthy membership; scope identity and thresholds must remain explicit; RESTORED must recover deterministically.\n\nThe complete approved M7 slice ledger lives in `DEVELOPMENT-ROADMAP.md`, with detailed contracts in `TENANT-SYNC.md`. M7D8 is **PRODUCTION GREEN**; M7D9 is the **next approved** slice; M7D10–M7D11 remain planned in order; M7E remains an explicit activation decision. Recurring Intelligent Sync stays disabled.',
  '**M7D10 — Recovery, Replay and Operational Observability**\n\nM7D10 must close ordinary recovery across duplicate Queue delivery, expired/reclaimed leases, crashes before and after verification/promotion/finalization, bounded retries, poison/DLQ/replay ownership and safe phase-aware diagnostics while preserving LKG and unrelated-tenant continuity. It must not absorb the M7D11 review-feed boundary or M7E activation.\n\nThe complete approved M7 slice ledger lives in `DEVELOPMENT-ROADMAP.md`, with detailed contracts in `TENANT-SYNC.md`. M7D9 is **PRODUCTION GREEN**; M7D10 is the **next approved** slice; M7D11 remains planned in order; M7E remains an explicit activation decision. Recurring Intelligent Sync stays disabled.',
);
replaceOnce(
  'docs/CURRENT-STATE.md',
  'Future macro milestones such as M8 and M9 do not yet have approved A/B subdivisions.',
  '### M7D9 repeated-miss and safe removal — production-proven\n\nFinal trusted-main implementation/proof SHA: `9214094197b010f46f7bf5144e7dbb445afa90ef`. Application deploy `33262375277`, Queue activation `33262420873`, fleet v7→v8 `33262420846`, cumulative M7D4→M7D7 authority regression `33262420886`, M7D8 finalization regression `33262420896`, dedicated M7D9 safe-removal canary `33262420879` / job `99126532113`, and automatic initial-import/CEI regression `33262420865` / job `99127336932` all completed **SUCCESS** on that exact SHA. Schema v8 now owns explicit scope membership/miss state, immutable removal policy and merchant-override retention. A canonical product is deleted only after its last valid scope detaches at threshold, replay does not double-increment, and `RESTORED` reapplies retained merchant truth. Tenant recurring Intelligent Sync remains off with an empty cohort and cap `1`. Full evidence lives in `M7D9-CLOSURE-2026-08-30.md`.\n\nThe later `f03a30ca896c8039ec7be9fc80358f3b04b84f73` commit was emitted by the distinct transitional default-catalog sync and changed only the sanitized compatibility snapshot `data/catalog.json`; it does not replace the M7D9 production implementation identity.\n\nFuture macro milestones such as M8 and M9 do not yet have approved A/B subdivisions.',
);

// DEVELOPMENT-ROADMAP
replaceOnce(
  'docs/DEVELOPMENT-ROADMAP.md',
  '| M7D9 — Repeated Miss and Safe Removal                  | **PLANNED — NEXT APPROVED**                                                        | Apply authoritative repeated-miss, multi-scope membership, removal and restoration semantics.         |\n| M7D10 — Recovery, Replay and Operational Observability | **PLANNED**',
  '| M7D9 — Repeated Miss and Safe Removal                  | **PRODUCTION GREEN**                                               | Apply authoritative repeated-miss, multi-scope membership, removal and restoration semantics.         |\n| M7D10 — Recovery, Replay and Operational Observability | **PLANNED — NEXT APPROVED**',
);
replaceOnce(
  'docs/DEVELOPMENT-ROADMAP.md',
  'M7D9 is therefore the next approved slice. Its repeated-miss/removal/restoration contract must remain separate from M7D10 recovery/replay and from M7E activation.',
  'M7D9 production closure is recorded in `M7D9-CLOSURE-2026-08-30.md`. Trusted-main implementation/proof SHA `9214094197b010f46f7bf5144e7dbb445afa90ef` passed application deploy `33262375277`, Queue activation `33262420873`, fleet v7→v8 `33262420846`, cumulative M7D4→M7D7 authority regression `33262420886`, M7D8 finalization regression `33262420896`, dedicated safe-removal canary `33262420879` / job `99126532113` and automatic initial-import/CEI regression `33262420865` / job `99127336932`. Schema v8 now advances misses only from authoritative promoted runs, detaches scopes independently, deletes canonical state only after the last valid scope is gone, preserves merchant overrides through deletion and restores them on `RESTORED`. Recurring tenant Intelligent Sync remains disabled with an empty active cohort and cap `1`.\n\nM7D10 is therefore the next approved slice. Its recovery/replay/observability contract must remain separate from M7D11 review-feed scope and from M7E activation.',
);

// TENANT-SYNC
replaceOnce(
  'docs/TENANT-SYNC.md',
  'Recurring Intelligent Sync remains disabled, the active cohort remains empty and M7D9 is the next approved slice. M7D8 does not activate repeated-miss/removal semantics or broad recovery/DLQ behavior.',
  'M7D8 historically leaves recurring Intelligent Sync disabled and does not itself activate repeated-miss/removal semantics or broad recovery/DLQ behavior. M7D9 is now **PRODUCTION GREEN**; the active tenant sync cohort remains empty and M7D10 is the next approved slice.',
);
replaceOnce(
  'docs/TENANT-SYNC.md',
  '- outage, 429/5xx, malformed HTML, pagination failure, zero and catastrophic drop never progress removal.\n\n### M7D10 — Recovery, Replay and Operational Observability',
  '- outage, 429/5xx, malformed HTML, pagination failure, zero and catastrophic drop never progress removal.\n\nM7D9 is **PRODUCTION GREEN** at trusted-main implementation/proof SHA `9214094197b010f46f7bf5144e7dbb445afa90ef`. Tenant data-plane schema v8 freezes versioned scope/threshold policy per run, tracks scoped membership misses, detaches one scope without deleting a product still owned by another valid scope, retains merchant classification overrides before final canonical deletion and reapplies them on `RESTORED`. Duplicate/replayed promoted runs are idempotent and cannot increment the miss ledger twice. Exact-SHA deploy, Queue, fleet v7→v8, M7D7/D8 regressions, dedicated safe-removal proof and automatic initial-import/CEI regression all passed. The historical D7 `sync_promotion_removal_not_ready` boundary is therefore closed only for valid schema-v8 removal candidates; recurring tenant Intelligent Sync remains disabled. Full evidence lives in `M7D9-CLOSURE-2026-08-30.md`.\n\nM7D10 is the next approved slice and owns crash/lease/retry/DLQ/replay/operational-observability closure; M7D9 does not claim those paths.\n\n### M7D10 — Recovery, Replay and Operational Observability',
);

// TENANT-DATA-PLANES
replaceOnce(
  'docs/TENANT-DATA-PLANES.md',
  'v7 -> serving-authority revision + run-scoped stale-base snapshot for atomic promotion CAS\n```',
  'v7 -> serving-authority revision + run-scoped stale-base snapshot for atomic promotion CAS\nv8 -> scoped supplier membership/miss ledger + immutable removal policy + merchant-override retention\n```',
);
replaceOnce(
  'docs/TENANT-DATA-PLANES.md',
  'The active code migration target is schema v7:\n\n`TENANT_DATA_PLANE_SCHEMA_VERSION = 7`\n\nNew/in-flight tenants are migrated to v7 through the normal provisioning migration path. Already-ready tenants below v7 are discovered as bounded maintenance work instead of being sent back through onboarding.\n\nSchema v7 activation does **not** itself enable recurring incremental sync, promote a candidate or advance cursor/schedule authority. It adds only the minimum serving-authority CAS state required by M7D7. The recurring scheduler remains independently gated until all remaining M7 safety slices and deliberate M7E activation are proven.',
  'The active code migration target is schema v8:\n\n`TENANT_DATA_PLANE_SCHEMA_VERSION = 8`\n\nNew/in-flight tenants are migrated to v8 through the normal provisioning migration path. Already-ready tenants below v8 are discovered as bounded maintenance work instead of being sent back through onboarding. Current migration-command capability is v4 for target schema v8; the historical v3 → schema7 command remains accepted for backward-compatible safe maintenance/rollback behavior.\n\nSchema v8 activation does **not** itself enable recurring tenant Intelligent Sync or create an active cohort. It adds the scoped removal authority required by M7D9 on top of the v7 serving-authority CAS state. The recurring scheduler remains independently gated until M7D10, M7D11 and deliberate M7E activation are proven.',
);
replaceOnce(
  'docs/TENANT-DATA-PLANES.md',
  'The migration-command capability marker for v7 is v3. Fleet activation must prove v6 -> v7 on ready isolated tenants while preserving LKG, merchant overrides and existing private candidate/stage evidence.\n\n## Private source handling',
  'The migration-command capability marker for v7 is v3. Fleet activation must prove v6 -> v7 on ready isolated tenants while preserving LKG, merchant overrides and existing private candidate/stage evidence.\n\n## M7D9 scoped removal authority in v8\n\nSchema v8 is additive and introduces the minimum durable state for safe repeated-miss removal and restoration:\n\n- `supplier_scope_memberships` stores tenant/source/scope/product membership, scoped state, miss count, policy/contract versions and last observed/progress run;\n- `supplier_sync_stage_removal_policy` freezes the exact tenant/source/scope, policy version and threshold for one staged run;\n- `catalog_product_classification_override_retention` preserves merchant override truth independently of the canonical product foreign-key lifecycle;\n- `catalog_product_effective_classification_overrides` provides the effective live/retained override projection used during restoration.\n\nOnly complete, healthy, plausible and safety-authorized promoted runs may progress a scope miss. Replay of the same promoted run is idempotent. Detaching one scope cannot delete a canonical product while another valid scope still owns it; final canonical deletion occurs only after the last valid scope detaches at threshold. Before that deletion, merchant override truth is retained. A later verified/promoted `RESTORED` candidate returns the product, reapplies retained override truth and resets scoped absence state.\n\nThis closes the historical M7D7 `sync_promotion_removal_not_ready` gate only for valid schema-v8 candidates. It does not activate recurring tenant sync. Trusted-main fleet run `33262420846` proved scheduler-owned v7 → v8 maintenance while preserving LKG/merchant truth and keeping `TENANT_SYNC_AUTOMATION_ENABLED=0`. Dedicated M7D9 production proof is recorded in `M7D9-CLOSURE-2026-08-30.md`.\n\n## Private source handling',
);

// DEPLOYMENT-PIPELINES
replaceRegexOnce(
  'docs/DEPLOYMENT-PIPELINES.md',
  /After a trusted-main deploy that changes the tenant fleet schema target,[\s\S]*?the fleet workflow must not start a competing direct-push run in the shared production-D1 concurrency group\./,
  'After a trusted-main deploy that changes the tenant fleet schema target, preparation boundary or fleet-proof implementation, `.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml` owns the production maintenance proof. The current target is schema v8: isolated v7 fixtures are prepared with migration-command capability v4 and upgraded through scheduler-owned binding-native v7→v8 maintenance while LKG, merchant overrides, existing stage evidence and unrelated-tenant isolation remain safe. Recurring tenant Intelligent Sync remains disabled throughout the fleet proof. The canary does not enqueue tenant import work manually or replace catalog data. On unexpected failure it reports only bounded migration evidence and retains isolated fixtures. Changes to the fleet-canary workflow, script or tests are owned by the application-deploy path filter and reach the proof only through the successful deploy\'s `workflow_run`; the fleet workflow must not start a competing direct-push run in the shared production-D1 concurrency group.',
);
replaceOnce(
  'docs/DEPLOYMENT-PIPELINES.md',
  'This workflow is transitional. Long-term tenant sync moves to durable tenant jobs/Queues according to the roadmap.',
  'This workflow is transitional. It is a distinct default-catalog automation and is **not** the M7 tenant Intelligent Sync scheduler governed by `TENANT_SYNC_AUTOMATION_ENABLED` / active-cohort controls. It may still advance the sanitized compatibility snapshot `data/catalog.json` through its catalog bot while tenant recurring sync remains off. Long-term tenant sync moves to durable tenant jobs/Queues according to the roadmap.',
);
replaceOnce(
  'docs/DEPLOYMENT-PIPELINES.md',
  'This prevents application migrations, Worker/Queue deployments, catalog publication, default sync/recovery and trusted production canaries from racing each other.\n\nAs tenant-isolated Queue processing becomes primary, per-tenant concurrency/locking must replace unnecessary global serialization for tenant data planes.',
  'This prevents application migrations, Worker/Queue deployments, catalog publication, default sync/recovery and trusted production canaries from racing each other. M7D9 hardened the exact-SHA proof graph so application deploy completes before Queue activation; fleet and automatic-import prerequisite waiters observe required exact-SHA statuses outside the mutation lock and only their actual privileged canary jobs enter `catalog-engine-production-d1`. This avoids pending-job cancellation/deadlock without weakening exact-SHA gates for D7/D8/D9.\n\nAs tenant-isolated Queue processing becomes primary, per-tenant concurrency/locking must replace unnecessary global serialization for tenant data planes.',
);

// START-HERE
replaceRegexOnce(
  'START-HERE-AI.md',
  /Captured against live GitHub on \*\*2026-08-27 \(America\/Sao_Paulo\)\*\*[\s\S]*?This is a last-known checkpoint only\. Requery statuses\/runs before using it as current truth\./,
  `Captured against live GitHub on **2026-08-30 (America/Sao_Paulo)**.\n\n## Repository / capture semantics\n\n\`\`\`text\nrepository = lucasvenancio0110/catalog-engine\nbranch = main\nproduction implementation checkpoint = 9214094197b010f46f7bf5144e7dbb445afa90ef\npre-closure live repository capture point = f03a30ca896c8039ec7be9fc80358f3b04b84f73\n\`\`\`\n\nThe two SHAs intentionally mean different things:\n\n- \`92140941...\` is the final **M7D9 trusted-main production implementation/proof SHA**;\n- \`f03a30ca...\` is the later live-main capture point produced by the distinct transitional default-catalog sync and modifies only the sanitized compatibility snapshot \`data/catalog.json\` relative to the M7D9 proof SHA. It is preserved by the documentation closure and does not replace the production implementation identity.\n\nNeither value is permission to skip live GitHub revalidation.\n\nM7D9 primary feature implementation entered through PR \`#157 — m7d9: remove repeatedly missing products safely\`; production-proof fixes continued through PRs \`#158–#164\`, with final proof SHA \`9214094197b010f46f7bf5144e7dbb445afa90ef\`.\n\n## Exact known trusted-main status on the M7D9 production implementation SHA\n\nThe exact SHA \`9214094197b010f46f7bf5144e7dbb445afa90ef\` completed **SUCCESS** for:\n\n\`\`\`text\ncatalog-engine/application-deploy\n  run 33262375277\n\ncatalog-engine/queue-consumer-activation\n  run 33262420873\n\ncatalog-engine/tenant-data-plane-fleet-canary\n  run 33262420846 / job 99126693083\n\ncatalog-engine/tenant-incremental-affected-detail-canary\ncatalog-engine/tenant-incremental-cei-candidate-canary\ncatalog-engine/tenant-incremental-candidate-verification-canary\ncatalog-engine/tenant-incremental-promotion-authority-canary\n  cumulative run 33262420886 / job 99126532164\n\ncatalog-engine/tenant-incremental-finalization-canary\n  run 33262420896 / job 99126532227\n\ncatalog-engine/tenant-incremental-safe-removal-canary\n  run 33262420879 / job 99126532113\n\nautomatic initial-import + CEI regression\n  run 33262420865 / job 99127336932\n\`\`\`\n\nThis is a last-known checkpoint only. Requery statuses/runs before using it as current truth.`,
);
replaceOnce(
  'START-HERE-AI.md',
  'M7D8 = PRODUCTION GREEN\nM7D9 = PLANNED — NEXT APPROVED\nM7D10 = PLANNED',
  'M7D8 = PRODUCTION GREEN\nM7D9 = PRODUCTION GREEN\nM7D10 = PLANNED — NEXT APPROVED',
);
replaceOnce(
  'START-HERE-AI.md',
  'TENANT_DATA_PLANE_SCHEMA_VERSION = 7\nmigration command capability = v3\n```\n\nSchema v7 provides serving-authority revision + immutable run base-authority snapshot for stale-base CAS.',
  'TENANT_DATA_PLANE_SCHEMA_VERSION = 8\nmigration command capability = v4\nhistorical compatibility = v3 -> schema7 remains accepted\n```\n\nSchema v8 adds scoped membership/miss authority, immutable removal policy and merchant-override retention on top of the v7 serving-authority CAS state.',
);
replaceRegexOnce(
  'START-HERE-AI.md',
  /# 11\. NEXT APPROVED SUBMILESTONE[\s\S]*?---\n\n# 12\. M7 REMAINING ORDER — DO NOT SKIP/,
  `# 11. NEXT APPROVED SUBMILESTONE\n\nSubject to live revalidation, the next roadmap slice is:\n\n## M7D10 — Recovery, Replay and Operational Observability\n\nCommercial outcome:\n\n> Ordinary failures recover without daily owner intervention while exceptions remain diagnosable.\n\nNormative owner:\n\n- \`docs/TENANT-SYNC.md\`\n\nRequired proof covers duplicate Queue delivery, expired lease/reclaim, crash between listing chunks, affected-detail failure, crash before/after verify, crash before/during/after authority switch, post-promotion redelivery, partial-item error, bounded retry exhaustion, DLQ/replay ownership and unrelated-tenant continuity. Errors must be phase-aware and safe, unresolved failed work must block conflicts, and LKG/evidence must remain preserved until exact audited cleanup.\n\nM7D10 must not absorb M7D11 customer change/review feed scope or M7E activation. Recurring tenant Intelligent Sync remains disabled and no real activation cohort is created in M7D10.\n\n---\n\n# 12. M7 REMAINING ORDER — DO NOT SKIP`,
);
replaceOnce(
  'START-HERE-AI.md',
  'M7D9 — Repeated Miss and Safe Removal\n↓\nM7D10 — Recovery, Replay and Operational Observability',
  'M7D10 — Recovery, Replay and Operational Observability',
);
replaceOnce(
  'START-HERE-AI.md',
  'Do not enable recurring sync in M7D8, M7D9, M7D10 or M7D11.',
  'Do not enable recurring sync in M7D10 or M7D11; M7D8/M7D9 are already closed with the scheduler still disabled.',
);
replaceOnce(
  'START-HERE-AI.md',
  'Do not create a real cohort merely to make a canary easier.\n\n---',
  'Do not create a real cohort merely to make a canary easier.\n\nThe scheduled legacy/default-catalog `sync-yupoo-incremental.yml` workflow is a distinct transitional automation and may advance the sanitized `data/catalog.json` snapshot even while tenant Intelligent Sync remains disabled. Preserve and audit those bot commits separately; do not misclassify them as M7 tenant-cohort activation.\n\n---',
);

console.log('M7D9 documentation reconciliation applied successfully.');
