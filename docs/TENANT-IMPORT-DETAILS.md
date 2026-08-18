# Tenant detail import and finalize barrier

The initial tenant import now has two queue stages after the complete listing scan.

## Detail stage

The scan Worker writes the supplier listing index and raw source taxonomy only to the isolated tenant D1, then emits opaque detail messages to the private detail queue. A detail message contains only `importId`, `tenantId`, `sourceKey`, and `albumSourceId`.

The detail consumer resolves the private album URL and tenant D1 through control-plane state at runtime. Each album is claimed in `supplier_album_detail_state` with a short lease and an opaque claim token. Duplicate deliveries are safe: terminal albums are skipped and an active claim cannot be stolen until its lease expires.

Album HTML is fetched with manual redirect validation restricted to the original Yupoo host. Product images are accepted only from `photo.yupoo.com`. Public names/descriptions are sanitized before normalization. Source image URLs and album URLs are written only to private media/source tables; public catalog rows contain opaque product/category/media identifiers.

Transient failures remain retryable. After the bounded detail attempt limit, an incomplete album becomes `deferred` for this initial import instead of blocking an entire merchant catalog. Its source detail fingerprint remains incomplete so a later intelligent sync can retry it.

## Finalize stage

The platform cron periodically emits an opaque finalize message after the listing fan-out cursor reaches the discovered album count. Finalization is a barrier, not a timer: it succeeds only when every discovered album is terminal (`success`, `skipped`, or `deferred`).

Finalization recomputes category, league, team and facet counts from the isolated tenant D1, removes unreferenced private media, writes public catalog metadata, and runs a white-label check over public product text. Control-plane import counters are then written as absolute aggregates rather than incremented per queue message.

A successful initial import completes only the `import` provisioning checkpoint and advances onboarding to `classify`. It does not publish the tenant, activate a custom domain, or enable dynamic Workers for Platforms dispatch.

## Activation boundary

The repository contains separate scan and detail queue Worker entrypoints, but production queue bindings remain intentionally disabled until the full ingestion CI is green and an isolated two-tenant end-to-end test has proved D1 separation. Dedicated `CLOUDFLARE_PLATFORM_*` runtime credentials remain required and fail closed when absent.
