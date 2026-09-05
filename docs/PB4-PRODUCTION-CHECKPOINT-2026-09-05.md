# PB4 Production Checkpoint — Branding

Status: **IN PROGRESS — production infrastructure proven; real merchant persistence proof pending**  
Date: **2026-09-05**  
Repository: `lucasvenancio0110/catalog-engine`

## Scope

This checkpoint records the highest evidence level currently reached by PB4 — Branding. It does **not** close PB4 and does not authorize PB5.

PB4 remains governed by `PORTAL-BETA-EXECUTION.md`. Its Definition of Done requires the beta tenant branding to persist and be renderable by PB9 without private storage leakage.

## Integrated production revision

- main SHA: `dfff6204e42a862c42cc091b70fc06243016e155`;
- commit: `PB4: recover logo storage with private R2 (#205)`;
- recovery PR: #205;
- trusted application deploy: #127 / run `33952906777`;
- successful deploy job: `101273333572`.

## COMPROVADO EM PRODUÇÃO

The successful rerun of deployment #127 proved on the exact integrated SHA:

- repository quality gate green;
- 145 test files / 714 tests green;
- build and public artifact verification green;
- D1 migration `0025_allow_r2_tenant_brand_assets.sql` already applied;
- private R2 bucket `catalog-engine-brand-assets` provisioned by trusted deployment;
- Worker binding `BRAND_ASSETS` present;
- Images binding remains present for image inspection/normalization;
- all four portal-auth runtime bindings remain configured;
- application Worker deployed successfully;
- catalog smoke passed;
- initial tenant import automation remains enabled;
- recurring Intelligent Sync remains disabled;
- active recurring cohort remains empty;
- recurring sync per-tick cap remains `1`;
- enrolled recurring tenant sources remain `0`.

The platform binding verifier reported both `imagesPresent=true` and `brandAssetsR2Present=true` without exposing private bucket/provider identifiers to merchant-facing responses.

## Production failure that led to recovery

The first real CROCCODILOS branding attempt successfully reached the PB4 profile boundary and preserved/saved the non-logo branding values, but logo persistence failed after decoded-image validation and WebP normalization.

The original implementation attempted Cloudflare Images hosted storage. Production showed that this account did not have that separate hosted-storage capability enabled. PB4 was recovered without requiring Images Paid:

```text
merchant raster logo
-> authenticated tenant-owned branding boundary
-> MIME/byte validation
-> decoded image + dimension checks through Images
-> bounded WebP normalization
-> private R2 BRAND_ASSETS storage
-> opaque Catalog Engine /brand-assets/bas_<id>.webp public path
```

No R2 object key, Cloudflare provider ID, source URL or other private locator is part of the merchant profile contract.

## PENDENTE — final PB4 acceptance

PB4 is **not PRODUCTION GREEN yet**.

One real production acceptance proof remains on the already-created CROCCODILOS tenant:

1. merchant opens Appearance in `app.catalogoengine.com`;
2. uploads the same valid raster logo;
3. `Salvar identidade` succeeds;
4. portal is closed/reloaded;
5. Appearance is reopened;
6. saved branding values and logo are recovered from durable server-side state;
7. the logo loads through the opaque `/brand-assets/bas_<id>.webp` path;
8. no private R2/provider locator is exposed to the merchant-facing response/browser surface.

Only after that proof may PB4 be promoted to **PRODUCTION GREEN**, `CURRENT-STATE.md` updated again, and PB5 begin.

## Rollback / safety boundary

If the real logo proof fails:

- keep the previous valid tenant branding configuration;
- stop at PB4;
- do not begin PB5;
- do not activate recurring Intelligent Sync;
- diagnose the exact upload/storage/read boundary;
- preserve the private R2 bucket and evidence unless a focused cleanup decision explicitly requires otherwise.

## Next action

Run the single real CROCCODILOS logo persistence/reload proof. No new tenant, entitlement grant or source connection is required for this checkpoint.
