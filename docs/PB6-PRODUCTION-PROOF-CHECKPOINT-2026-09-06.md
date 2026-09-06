# PB6 — Production Proof Checkpoint — 2026-09-06

Status: **PRODUCTION PROVEN — merchant acceptance still pending**

## Scope

This checkpoint records the live proof level for PB6 — Source Scope / Import Decision without promoting the slice beyond evidence.

## Integrated implementation

- PB6 authority implementation merged through PR #212 at SHA `666258073f2f20e759e2cbe228c5588d2ac2a48b`.
- Migration `0026_tenant_import_decisions.sql` is part of the deployed runtime.
- Durable decision mode is `full_connected_source`.
- Supported decision authorities are `merchant`, `preexisting_import`, and `system_canary`.
- The decision is bound to the exact active source locator while private supplier locators remain server-side.
- Automatic initial-import discovery must honor the durable decision.
- Compatibility for already-running/completed pre-PB6 import state is preserved without destructive reset.

## Preflight repair

The first post-merge `Tenant import automation preflight` run failed because the ephemeral validation database did not materialize the new PB6 decision table in the enabled automation path.

PR #213 (`PB6: make tenant import preflight mode-aware`) repaired the preflight. Main then advanced to `457f69f7df6f6a1d5aa94d5d075100d393804543`, and the main preflight completed green.

This repair changes validation infrastructure, not the PB6 authority contract.

## Trusted production proof

Trusted application deploy run `34016789511` completed successfully on exact PB6 runtime SHA `666258073f2f20e759e2cbe228c5588d2ac2a48b`.

Automatic tenant-import canary run `34016832322` also completed successfully against that exact deployed SHA and proved:

- automatic initial tenant import enabled;
- decision authority `system_canary` accepted by the PB6 gate;
- scheduler-driven discovery occurred;
- no manual Queue messages were produced;
- one isolated import completed and published;
- CEI classification/intelligence/verification completed;
- no private-state leaks were observed in the canary projection;
- default catalog count remained unchanged;
- Queue backlogs were clean;
- source scope matched the expected bounded canary item count.

The canary published success status `catalog-engine/tenant-import-auto-canary` for the deployed SHA.

After PR #214 merged this checkpoint to main, Cloudflare Workers Build `7e740a4c-10a4-46ba-9dc2-28b3f7db66c8` completed successfully for main SHA `b23745add33bfc0103ffd7630d83daab7f8fc12b`, producing Worker version `91bc7842-c43b-460c-b5ab-c9262477bf11`. This is a documentation-only successor to the already-proven PB6 runtime and is now the latest deployed main SHA. It does not replace the merchant acceptance gate or require a new PB6 mechanism canary because the application authority implementation is unchanged from the runtime already proven by `34016832322`.

## Activation boundary

PB6 does **not** activate recurring tenant Intelligent Sync or M7E.

The intended boundary remains:

```text
INITIAL TENANT IMPORT: enabled
RECURRING TENANT INTELLIGENT SYNC: disabled
M7E: not activated
```

## Why PB6 is not Production Green yet

The canary proves the production mechanism and server-side authority using `system_canary`. It does not substitute for first-real-merchant acceptance.

The remaining PB6 acceptance gate is a real CROCCODILOS merchant decision through the authenticated production portal, with proof that the resulting durable authority is `merchant`, remains bound to the connected private source, survives reload/re-entry, and is the authority consumed by initial-import discovery.

No supplier URL, raw Yupoo identifier, source locator, tenant runtime locator, D1 identifier, Cloudflare identifier, token, secret, or private CEI evidence may be exposed while collecting that proof.

Until that evidence exists, PB6 remains **PRODUCTION PROVEN**, not **PRODUCTION GREEN**, and PB7 must not start.

## Next exact action

Exercise the deployed PB6 full-connected-source decision for CROCCODILOS through the authenticated merchant flow. Confirm safe persisted state after reload/re-entry and verify server-side that initial-import discovery consumed the `merchant` decision for the same active source. If all checks pass, create the PB6 closure and update living state/roadmap to **PRODUCTION GREEN**, then release PB7.
