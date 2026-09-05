# PB4 logo storage recovery — 2026-09-05

## Production evidence

The first real merchant branding proof reached the live PB4 profile boundary successfully, then returned `brand_asset_storage_failed` only while storing the logo. The request had already passed the Catalog Engine file-type guard, decoded-image inspection, dimension checks and WebP normalization.

The current PB4 implementation stores the normalized result with `env.IMAGES.hosted.upload()`. Cloudflare Images hosted storage requires an Images Paid storage plan. Catalog Engine must not make a merchant logo depend on an extra hosted-images subscription when private object storage already fits the workload.

## Recovery decision

- Keep the Images binding only for server-side decode/inspection and bounded WebP normalization.
- Store the normalized tenant logo in a private Cloudflare R2 binding named `BRAND_ASSETS`.
- Keep the bucket private; do not enable an `r2.dev` public endpoint.
- Continue exposing only the Catalog Engine opaque path `/brand-assets/bas_<opaque>.webp`.
- Keep the private object key in D1 and never expose it to the merchant profile or storefront contract.
- Preserve active/replaced/deleted lifecycle, tenant ownership, audit log and rollback cleanup.
- Preserve compatibility with any legacy `cloudflare_images` asset row.
- Keep recurring Intelligent Sync OFF and do not advance PB5 until live CROCCODILOS logo persistence is proven.

## Cost boundary

R2 Standard has a monthly included tier suitable for beta brand assets. The recovery uses private R2 only for normalized branding objects and does not make the bucket directly public.
