# PB4 — Branding Asset Decision

Status: **Implementation decision for PB4**  
Date: **2026-09-05**

## Decision

PB4 uses the **Cloudflare Images Worker binding + hosted Images storage** for merchant logos.

The browser never receives a Cloudflare account token, Images provider asset ID, Images delivery locator, D1 identifier, runtime locator or Workers for Platforms identifier.

The public branding contract is:

```text
merchant raster file
-> authenticated tenant-scoped branding endpoint
-> byte/MIME/decode/dimension checks
-> Cloudflare Images binding decode + normalization to WebP
-> hosted Images upload
-> private provider asset ID in control-plane D1
-> Catalog Engine opaque public asset ID/path
-> tenant_store_profiles.logo_path = /brand-assets/<opaque>.webp
```

Public storefront/portal surfaces resolve that opaque Catalog Engine path through the platform Worker. The Worker looks up only an `active` asset row, reads the corresponding private provider object and streams the normalized WebP bytes with immutable caching.

## Why Cloudflare Images for PB4

The current production Worker has no tenant-writable R2/KV asset binding. Adding a new generic object store only for one controlled logo type would create a second media lifecycle without providing image-specific validation.

The Images binding provides the capabilities PB4 needs at the Worker boundary:

- raw byte input;
- decoded image inspection (`format`, file size, width, height);
- bounded resize/normalization;
- WebP output;
- hosted upload/read/delete through the Worker binding;
- no browser/API-token exposure.

This keeps logo validation, storage and rendering in one provider-neutral Catalog Engine contract while Cloudflare remains a private implementation detail.

## Sharp decision

`sharp` remains approved and installed for Node-side media/build pipelines. PB4 does **not** execute Sharp inside the production Worker because the merchant upload is validated and normalized at the Worker runtime boundary, where the Cloudflare Images binding is the deployment-native image decoder/encoder.

This is an explicit implementation choice, not a silent replacement of the PB4 validation requirement. The security property remains the same: the system validates the decoded image rather than trusting filename or browser-declared MIME alone.

## Beta upload boundary

PB4 accepts only:

- `image/png`;
- `image/jpeg`;
- `image/webp`.

PB4 rejects SVG and any other active/document format. SVG remains disabled until a separate sanitization/security contract exists.

Additional boundaries:

- source upload maximum: **2 MiB**;
- decoded width/height: **32–4096 px** per side;
- decoded pixel count: bounded;
- output: still WebP, maximum 1024 × 1024 using scale-down semantics;
- provider locator: private D1 state only;
- public path: opaque Catalog Engine asset identity;
- previous valid logo remains authoritative if provider upload or D1 mutation fails;
- replacement revokes the previous public asset before best-effort provider deletion.

## Tenant isolation

Branding profile read/write and logo create/delete require the authenticated principal to hold an active membership for the exact tenant. Mutations require an owner/admin role.

A merchant cannot use another tenant ID to read private branding configuration or mutate that tenant's logo. Public `/brand-assets/<opaque>.webp` content is intentionally public merchant branding, but provider IDs and inactive/replaced assets are never publicly addressable through Catalog Engine.

## Controlled branding configuration

PB4 stores only validated fields already supported by `tenant_store_profiles`:

- store name;
- supported active theme preset;
- primary/secondary `#RRGGBB` colors;
- optional WhatsApp;
- optional Instagram;
- safe opaque `logo_path`.

No arbitrary merchant HTML, JavaScript or CSS is accepted.

For each semantic brand color, Catalog Engine derives either black or white foreground text by WCAG contrast ratio and deterministically chooses the higher-contrast option. This allows later preview/storefront surfaces to render customer-selected accent colors without guessing foreground readability.

## Operational boundary

PB4 does not activate recurring tenant sync and does not change the M7E decision gate.

Required invariants remain:

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

## Rollback

The schema change is additive. Runtime rollback can stop using the PB4 branding endpoints/binding while existing nullable profile values remain compatible. Uploaded provider objects are managed through the private asset registry; the public profile never depends on a raw provider locator.
