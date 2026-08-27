import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, replacements) {
  let text = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (!text.includes(before)) throw new Error(`m7d7_docs_patch_missing:${path}:${before.slice(0,120)}`);
    text = text.replace(before, after);
  }
  await writeFile(path, text, 'utf8');
}

await patch('docs/TENANT-DATA-PLANES.md', [
  [
    'while an existing v5 tenant receives only the idempotent v6 delta instead of replaying the cumulative v1-v6 schema in one remote request.',
    'while an existing tenant receives only the missing idempotent version deltas instead of replaying the cumulative schema in one remote request.'
  ],
  [
`v5 -> private staged incremental-sync state
v6 -> private relational candidate detail/media/CEI/merchandising state`,
`v5 -> private staged incremental-sync state
v6 -> private relational candidate detail/media/CEI/merchandising state
v7 -> serving-authority revision + run-scoped stale-base snapshot for atomic promotion CAS`
  ],
  [
`The active code migration target is schema v6:

\`TENANT_DATA_PLANE_SCHEMA_VERSION = 6\`

New/in-flight tenants are migrated to v6 through the normal provisioning migration path. Already-ready tenants below v6 are discovered as bounded maintenance work instead of being sent back through onboarding.

Schema v6 activation does **not** itself enable recurring incremental sync or populate candidate rows. The candidate tables become available fleet-wide first; the recurring scheduler remains independently gated until the later M7 consumer/detail/verification/promotion slices are proven.`,
`The active code migration target is schema v7:

\`TENANT_DATA_PLANE_SCHEMA_VERSION = 7\`

New/in-flight tenants are migrated to v7 through the normal provisioning migration path. Already-ready tenants below v7 are discovered as bounded maintenance work instead of being sent back through onboarding.

Schema v7 activation does **not** itself enable recurring incremental sync, promote a candidate or advance cursor/schedule authority. It adds only the minimum serving-authority CAS state required by M7D7. The recurring scheduler remains independently gated until all remaining M7 safety slices and deliberate M7E activation are proven.`
  ],
  [
`- run-owned candidate products, media, taxonomy/entities/facets, CEI state and catalog metadata used only before verified promotion.`,
`- run-owned candidate products, media, taxonomy/entities/facets, CEI state and catalog metadata used only before verified promotion;
- the tenant serving-authority revision plus each staged run's immutable base-authority revision used for stale-base compare-and-set.`
  ],
  [
`The migration-command capability marker advances to v2 because a v5-capable User Worker does not contain the immutable v6 statement map. Trusted CI must upload the v6-capable Worker before promoting marker v2; maintenance discovery requires that marker and therefore cannot hand target 6 to stale runtime code.`,
`The migration-command capability marker is v3 for the schema-v7 runtime. A v6-capable User Worker does not contain the immutable v7 statement map, so trusted CI must upload the v7-capable Worker before promoting marker v3; maintenance discovery requires that marker and therefore cannot hand target 7 to stale runtime code.`
  ],
  [
`## Private source handling`,
`## M7D7 serving-authority CAS state in v7

Schema v7 is additive and introduces only the minimum durable authority state required for one atomic promotion transaction:

- \`catalog_serving_authority\` stores one tenant-scoped monotonic revision and the exact last promoted run/source;
- \`supplier_sync_stage_authority\` stores the immutable authority revision from which each staged run was planned;
- staging snapshots that base revision with insert-or-ignore semantics, so a retry cannot silently rebase an older candidate;
- a promotion may win only when the staged base revision still equals the current tenant authority revision;
- successful promotion increments authority exactly once in the same D1 transaction that moves the exact stage \`verified -> promoting -> promoted\` and applies the canonical set-based mutations;
- replay of the already-promoted run is a read-back/no-op success; a competing candidate from the old base fails stale-base CAS;
- schema migration itself creates no candidate, changes no catalog row and performs no authority switch.

M7D7 deliberately does not activate repeated-miss removal. A verified run containing \`MISSING\` or \`REMOVED\` remains fail-closed at promotion with \`sync_promotion_removal_not_ready\` until M7D9 owns the retention/removal contract. This prevents schema/promotion work from deleting durable merchant override truth before safe removal semantics exist.

The migration-command capability marker for v7 is v3. Fleet activation must prove v6 -> v7 on ready isolated tenants while preserving LKG, merchant overrides and existing private candidate/stage evidence.

## Private source handling`
  ],
  [
`Production activation of a new fleet schema target requires a dedicated trusted-main maintenance canary, not only a fresh-tenant provisioning canary. The current fleet canary starts from isolated ready v5 fixtures, prepares only the eligible success fixture through the same trusted-CI helper, and then lets the deployed cron discover the work without inserting migration jobs or Queue messages. The controlled namespace-mismatch fixture already carries command capability v2 so it reaches the intended safe failure, while the active-import fixture remains unprepared and undiscovered. The proof covers trusted capability promotion, successful binding-native v5→v6 upgrade, controlled failure with LKG preservation, active-import exclusion, unchanged historical onboarding and v5 stage evidence, exact schema ledger/candidate tables, zero candidate rows created by migration, merchant override preservation and unrelated-tenant isolation. Unexpected failure retains opaque fixture evidence plus the bounded migration job code/attempt count for diagnosis; cleanup happens only after the complete proof passes. Runtime or preparation changes require the normal successful-deploy trigger.`,
`Production activation of a new fleet schema target requires a dedicated trusted-main maintenance canary, not only a fresh-tenant provisioning canary. For v7 the fleet canary starts from isolated ready v6 fixtures, prepares only the eligible success fixture through the same trusted-CI helper, and then lets the deployed cron discover the work without inserting migration jobs or Queue messages. The controlled failure fixture carries command capability v3 so it reaches the intended safe failure, while active-import work remains excluded. The proof must cover trusted capability promotion, successful binding-native v6→v7 upgrade, controlled failure with LKG preservation, active-import exclusion, unchanged historical onboarding/stage/candidate evidence, exact schema ledger/authority tables, zero catalog/candidate mutation caused by migration, merchant override preservation and unrelated-tenant isolation. Unexpected failure retains opaque fixture evidence plus the bounded migration job code/attempt count for diagnosis; cleanup happens only after the complete proof passes. Runtime or preparation changes require the normal successful-deploy trigger.`
  ]
]);

await patch('docs/TENANT-SYNC.md', [
  [
`- no browser/client-selected identity can choose promotion authority.

Measured V1 admission envelope:`,
`- no browser/client-selected identity can choose promotion authority;
- M7D7 does not activate repeated-miss removal: any candidate containing MISSING/REMOVED fails promotion closed with \`sync_promotion_removal_not_ready\` until M7D9 owns the removal/retention contract, so durable merchant overrides cannot be erased as a side effect of this slice.

Measured V1 admission envelope:`
  ],
  [
`M7D7 implementation remains a separate claim. The accepted architecture does not itself make M7D7 Production Green. The implementation must add production-shaped regression/canary proof for verified-only entry, stale-base/competing-run CAS, rollback, old-or-new reader consistency, over-envelope rejection, idempotent replay, tenant isolation, privacy and unchanged cursor/removal/activation state.`,
`M7D7 implementation remains a separate claim. The accepted architecture does not itself make M7D7 Production Green. The implementation has one dedicated promotion primitive and the legacy stage promotion path fails closed; Production Green still requires trusted-main production-shaped regression/canary proof for verified-only entry, stale-base/competing-run CAS, rollback/atomic authority switch, over-envelope rejection, idempotent replay, tenant isolation, privacy, merchant-override preservation and unchanged cursor/removal/activation state.`
  ]
]);

console.log(JSON.stringify({ ok: true, boundary: 'm7d7-doc-contract' }));
