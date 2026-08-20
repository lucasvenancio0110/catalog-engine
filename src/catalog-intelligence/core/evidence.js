import { z } from 'zod';

export const CEI_NORMALIZED_EVIDENCE_VERSION = 1;

const providerKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
  .nullable();

const privateIdSchema = z.string().trim().min(1).max(240).nullable();
const labelSchema = z.string().trim().max(500);
const attributeValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

const structuredAttributesSchema = z
  .record(z.string().trim().min(1).max(120), attributeValueSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 64) {
      context.addIssue({
        code: 'custom',
        message: 'cei_evidence_attributes_too_many'
      });
    }
  });

export const catalogEvidenceSchema = z
  .object({
    schemaVersion: z.literal(CEI_NORMALIZED_EVIDENCE_VERSION),
    recordId: privateIdSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(12_000),
    sourceCategoryName: labelSchema,
    categoryPathNames: z.array(z.string().trim().min(1).max(500)).max(32),
    structuredAttributes: structuredAttributesSchema,
    provenance: z
      .object({
        providerKey: providerKeySchema,
        sourceKey: privateIdSchema,
        sourceLocalId: privateIdSchema
      })
      .strict()
  })
  .strict();

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nullableText(value) {
  const normalized = cleanText(value);
  return normalized || null;
}

export function parseCatalogEvidence(value) {
  return catalogEvidenceSchema.parse(value);
}

export function createCatalogEvidence({
  recordId = null,
  title,
  description = '',
  sourceCategoryName = '',
  categoryPathNames = [],
  structuredAttributes = {},
  provenance = {}
} = {}) {
  return parseCatalogEvidence({
    schemaVersion: CEI_NORMALIZED_EVIDENCE_VERSION,
    recordId: nullableText(recordId),
    title: cleanText(title),
    description: cleanText(description),
    sourceCategoryName: cleanText(sourceCategoryName),
    categoryPathNames: Array.isArray(categoryPathNames)
      ? categoryPathNames.map(cleanText).filter(Boolean)
      : categoryPathNames,
    structuredAttributes,
    provenance: {
      providerKey: nullableText(provenance?.providerKey)?.toLowerCase() || null,
      sourceKey: nullableText(provenance?.sourceKey),
      sourceLocalId: nullableText(provenance?.sourceLocalId)
    }
  });
}
