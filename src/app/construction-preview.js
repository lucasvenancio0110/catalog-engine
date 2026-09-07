import { z } from 'zod';

const PRODUCT_ID_PATTERN = /^p_[a-f0-9]{20}$/;
const MEDIA_ID_PATTERN = /^cm_[a-f0-9]{20}$/;
const SAFE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif'
]);

const productSchema = z.object({
  id: z.string().regex(PRODUCT_ID_PATTERN),
  title: z.string().trim().min(1).max(160),
  coverMediaId: z.string().regex(MEDIA_ID_PATTERN).nullable(),
  categories: z.array(z.string().trim().min(1).max(80)).max(4)
}).strict();

const constructionProjectionSchema = z.object({
  version: z.literal(1),
  readiness: z.enum(['empty', 'indexed']),
  ready: z.boolean(),
  complete: z.literal(false),
  productCount: z.number().int().min(0).max(48),
  products: z.array(productSchema).max(24),
  updatedAt: z.string().datetime({ offset: true }).nullable()
}).strict().superRefine((value, ctx) => {
  if (value.productCount < value.products.length) {
    ctx.addIssue({ code: 'custom', message: 'construction_product_count_invalid' });
  }
  if (value.readiness === 'empty' && (value.ready || value.productCount !== 0 || value.products.length !== 0)) {
    ctx.addIssue({ code: 'custom', message: 'construction_empty_state_invalid' });
  }
  if (value.ready && (value.readiness !== 'indexed' || value.productCount < 12 || value.products.length < 12)) {
    ctx.addIssue({ code: 'custom', message: 'construction_ready_state_invalid' });
  }
});

export class PortalConstructionPreviewError extends Error {
  constructor(code = 'construction_preview_unavailable', status = 0) {
    super(code);
    this.name = 'PortalConstructionPreviewError';
    this.code = code;
    this.status = Number(status) || 0;
  }
}

function fail(code, status) {
  throw new PortalConstructionPreviewError(code, status);
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function validateConstructionProjection(input) {
  const parsed = constructionProjectionSchema.safeParse(input);
  if (!parsed.success) fail('construction_preview_invalid_response', 502);
  return parsed.data;
}

export async function requestPortalConstructionPreview({
  tenantId,
  token,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(
    `/api/admin/stores/${encodeURIComponent(tenantId)}/construction-preview`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const payload = await responseJson(response);
  if (!response.ok) fail(payload?.error || 'construction_preview_unavailable', response.status);
  return validateConstructionProjection(payload);
}

export async function requestPortalConstructionMedia({
  tenantId,
  mediaId,
  token,
  fetchImpl = fetch
}) {
  if (!MEDIA_ID_PATTERN.test(String(mediaId || ''))) {
    fail('construction_media_invalid_id', 400);
  }
  const response = await fetchImpl(
    `/api/admin/stores/${encodeURIComponent(tenantId)}/construction-media/${encodeURIComponent(mediaId)}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}` }
    }
  );
  if (!response.ok) fail('construction_media_unavailable', response.status);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase().split(';')[0];
  if (!SAFE_IMAGE_TYPES.has(contentType)) fail('construction_media_invalid_response', 502);
  const blob = await response.blob();
  if (!blob.size || !SAFE_IMAGE_TYPES.has(String(blob.type || contentType).toLowerCase())) {
    fail('construction_media_invalid_response', 502);
  }
  return blob;
}

export function choosePreviewAuthority({ verifiedReady = false, construction = null } = {}) {
  if (verifiedReady === true) return 'verified';
  if (construction?.ready === true) return 'construction';
  return null;
}

export function realConstructionCount(construction) {
  const count = Number(construction?.productCount || 0);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export const constructionPreviewContract = Object.freeze({
  maxProducts: 24,
  usefulProductThreshold: 12,
  productIdPattern: PRODUCT_ID_PATTERN.source,
  mediaIdPattern: MEDIA_ID_PATTERN.source
});
