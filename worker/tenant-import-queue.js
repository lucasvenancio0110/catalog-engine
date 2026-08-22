import { z } from 'zod';
import { stableOpaqueId } from './runtime-identity.js';

export const TENANT_IMPORT_MESSAGE_VERSION = 1;

const tenantIdSchema = z.string().regex(/^t_[a-f0-9]{20}$/);
const sourceKeySchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const importIdSchema = z.string().regex(/^imp_[a-f0-9]{20}$/);
const scheduledForSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

const scanMessageSchema = z.object({
  version: z.literal(TENANT_IMPORT_MESSAGE_VERSION),
  type: z.literal('scan'),
  importId: importIdSchema,
  tenantId: tenantIdSchema,
  sourceKey: sourceKeySchema
});

const detailMessageSchema = z.object({
  version: z.literal(TENANT_IMPORT_MESSAGE_VERSION),
  type: z.literal('detail'),
  importId: importIdSchema,
  tenantId: tenantIdSchema,
  sourceKey: sourceKeySchema,
  albumSourceId: z.string().trim().min(1).max(160)
});

const finalizeMessageSchema = z.object({
  version: z.literal(TENANT_IMPORT_MESSAGE_VERSION),
  type: z.literal('finalize'),
  importId: importIdSchema,
  tenantId: tenantIdSchema,
  sourceKey: sourceKeySchema
});

export const tenantImportMessageSchema = z.discriminatedUnion('type', [
  scanMessageSchema,
  detailMessageSchema,
  finalizeMessageSchema
]);

export async function initialTenantImportId({ tenantId, sourceKey = 'primary' }) {
  const parsedTenantId = tenantIdSchema.parse(tenantId);
  const parsedSourceKey = sourceKeySchema.parse(sourceKey);
  return stableOpaqueId('imp', `${parsedTenantId}:${parsedSourceKey}:initial:v1`);
}

export async function incrementalTenantImportId({
  tenantId,
  sourceKey = 'primary',
  scheduledFor
}) {
  const parsedTenantId = tenantIdSchema.parse(tenantId);
  const parsedSourceKey = sourceKeySchema.parse(sourceKey);
  const parsedScheduledFor = scheduledForSchema.parse(scheduledFor);
  return stableOpaqueId(
    'imp',
    `${parsedTenantId}:${parsedSourceKey}:incremental:${parsedScheduledFor}:v1`
  );
}

export function buildTenantImportScanMessageForJob({ importId, tenantId, sourceKey = 'primary' }) {
  return tenantImportMessageSchema.parse({
    version: TENANT_IMPORT_MESSAGE_VERSION,
    type: 'scan',
    importId,
    tenantId,
    sourceKey
  });
}

export async function buildTenantImportScanMessage({ tenantId, sourceKey = 'primary' }) {
  const importId = await initialTenantImportId({ tenantId, sourceKey });
  return buildTenantImportScanMessageForJob({ importId, tenantId, sourceKey });
}

export function buildTenantImportDetailMessage({ importId, tenantId, sourceKey, albumSourceId }) {
  return tenantImportMessageSchema.parse({
    version: TENANT_IMPORT_MESSAGE_VERSION,
    type: 'detail',
    importId,
    tenantId,
    sourceKey,
    albumSourceId: String(albumSourceId)
  });
}

export function buildTenantImportFinalizeMessage({ importId, tenantId, sourceKey }) {
  return tenantImportMessageSchema.parse({
    version: TENANT_IMPORT_MESSAGE_VERSION,
    type: 'finalize',
    importId,
    tenantId,
    sourceKey
  });
}

export function parseTenantImportMessage(value) {
  return tenantImportMessageSchema.parse(value);
}

export function assertPublicSafeImportMessage(message) {
  const serialized = JSON.stringify(message);
  if (/https?:\/\/|yupoo|sourceUrl|databaseId|workerScript|credential|password|secret|token/i.test(serialized)) {
    throw new Error('tenant_import_message_contains_private_state');
  }
  return message;
}
