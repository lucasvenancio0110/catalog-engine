import { z } from 'zod';

export const CEI_INTELLIGENCE_STATE_CONTRACT_VERSION = 1;

export const CEI_KNOWLEDGE_STATE = Object.freeze({
  VERIFIED: 'VERIFIED',
  KNOWN: 'KNOWN',
  UNCERTAIN: 'UNCERTAIN',
  UNKNOWN: 'UNKNOWN',
  CONFLICT: 'CONFLICT',
  STALE: 'STALE'
});

export const CEI_KNOWLEDGE_THRESHOLDS = Object.freeze({
  verified: 0.95,
  known: 0.85,
  uncertain: 0.65
});

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9][a-z0-9:_-]*$/i);

const confidence = z.number().finite().min(0).max(1);
const classificationStatus = z.enum(['automatic', 'needs_review', 'unknown']);
const knowledgeState = z.enum(Object.values(CEI_KNOWLEDGE_STATE));
const claimPrimitive = z.union([
  z.string().trim().max(500),
  z.number().finite(),
  z.boolean(),
  z.null()
]);
const claimObject = z
  .record(identifier.max(48), claimPrimitive)
  .refine((value) => Object.keys(value).length <= 16, {
    message: 'cei_intelligence_claim_object_too_large'
  });
const claimValue = z.union([claimPrimitive, z.array(claimPrimitive).max(32), claimObject]);

const claimSchema = z
  .object({
    value: claimValue,
    confidence,
    knowledgeState,
    evidenceSources: z.array(z.string().trim().min(1).max(96)).max(24),
    source: z.enum(['inference', 'merchant_override'])
  })
  .strict();

const claimsSchema = z
  .record(identifier.max(48), claimSchema)
  .refine((value) => Object.keys(value).length <= 48, {
    message: 'cei_intelligence_claims_too_large'
  });

const conflictSchema = z
  .object({
    code: identifier.max(80),
    field: identifier.max(48),
    candidateIds: z.array(identifier.max(96)).max(16)
  })
  .strict();

const classificationViewSchema = z
  .object({
    status: classificationStatus,
    confidence,
    knowledgeState,
    claims: claimsSchema,
    conflicts: z.array(conflictSchema).max(24),
    reviewRequired: z.boolean()
  })
  .strict();

const intelligenceStateSchema = z
  .object({
    contractVersion: z.literal(CEI_INTELLIGENCE_STATE_CONTRACT_VERSION),
    evidenceSchemaVersion: z.number().int().min(1),
    classifierVersion: z.number().int().min(1),
    classifierKey: identifier.max(80),
    knowledgePackKey: identifier.max(80).nullable(),
    knowledgePackVersion: z.number().int().min(1).nullable(),
    domain: z
      .object({
        id: identifier.max(48),
        confidence,
        knowledgeState
      })
      .strict(),
    automatic: classificationViewSchema,
    effective: classificationViewSchema,
    overrideApplied: z.boolean(),
    research: z
      .object({
        required: z.boolean(),
        reasonCodes: z.array(identifier.max(80)).max(16),
        unknownConcepts: z.array(z.string().trim().min(1).max(160)).max(64)
      })
      .strict()
  })
  .strict();

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

export function deriveKnowledgeState(
  value,
  { conflict = false, stale = false, classificationStatus = null } = {}
) {
  if (conflict) return CEI_KNOWLEDGE_STATE.CONFLICT;
  if (stale) return CEI_KNOWLEDGE_STATE.STALE;
  if (classificationStatus === 'unknown') return CEI_KNOWLEDGE_STATE.UNKNOWN;

  const score = Math.max(0, Math.min(1, Number(value || 0)));
  if (score >= CEI_KNOWLEDGE_THRESHOLDS.verified) return CEI_KNOWLEDGE_STATE.VERIFIED;
  if (score >= CEI_KNOWLEDGE_THRESHOLDS.known) return CEI_KNOWLEDGE_STATE.KNOWN;
  if (score >= CEI_KNOWLEDGE_THRESHOLDS.uncertain) return CEI_KNOWLEDGE_STATE.UNCERTAIN;
  return CEI_KNOWLEDGE_STATE.UNKNOWN;
}

function normalizeConflicts(values) {
  return (values || []).map((conflict) => ({
    code: conflict.code,
    field: conflict.field,
    candidateIds: uniqueStrings(conflict.candidateIds)
  }));
}

function normalizedClaim(field, claim, conflicts, source = 'inference') {
  const score = Number(claim?.confidence || 0);
  const hasConflict = conflicts.some((entry) => entry.field === field);
  return {
    value: claim?.value ?? null,
    confidence: score,
    knowledgeState:
      claim?.knowledgeState || deriveKnowledgeState(score, { conflict: hasConflict }),
    evidenceSources: uniqueStrings(claim?.evidenceSources),
    source: claim?.source || source
  };
}

function claimsFromClassification(classified, conflicts, overrideFields = new Set()) {
  if (classified?.claims && typeof classified.claims === 'object' && !Array.isArray(classified.claims)) {
    return Object.fromEntries(
      Object.entries(classified.claims).map(([field, claim]) => [
        field,
        normalizedClaim(
          field,
          claim,
          conflicts,
          overrideFields.has(field) ? 'merchant_override' : 'inference'
        )
      ])
    );
  }

  const confidenceByField = classified?.fieldConfidence || {};
  return Object.fromEntries(
    Object.entries(confidenceByField).map(([field, score]) => [
      field,
      normalizedClaim(
        field,
        {
          value: null,
          confidence: Number(score || 0),
          evidenceSources: []
        },
        conflicts,
        overrideFields.has(field) ? 'merchant_override' : 'inference'
      )
    ])
  );
}

function classificationView(classified, { overrideFields = [] } = {}) {
  const conflicts = normalizeConflicts(classified?.conflicts);
  const status = classified?.status || classified?.classificationStatus || 'unknown';
  const score = Number(classified?.confidence ?? classified?.classificationConfidence ?? 0);
  return {
    status,
    confidence: score,
    knowledgeState: deriveKnowledgeState(score, {
      conflict: conflicts.length > 0,
      classificationStatus: status
    }),
    claims: claimsFromClassification(classified, conflicts, new Set(overrideFields)),
    conflicts,
    reviewRequired: Boolean(classified?.reviewRequired)
  };
}

function automaticClassification(classified) {
  if (classified?.automaticState) return classified.automaticState;
  return classified;
}

function researchState(automatic) {
  const reasons = new Set();
  if (automatic.knowledgeState === CEI_KNOWLEDGE_STATE.UNKNOWN) reasons.add('knowledge_unknown');
  if (automatic.knowledgeState === CEI_KNOWLEDGE_STATE.UNCERTAIN) reasons.add('knowledge_uncertain');
  if (automatic.knowledgeState === CEI_KNOWLEDGE_STATE.CONFLICT) reasons.add('knowledge_conflict');
  if (automatic.knowledgeState === CEI_KNOWLEDGE_STATE.STALE) reasons.add('knowledge_stale');
  for (const claim of Object.values(automatic.claims)) {
    if (claim.knowledgeState === CEI_KNOWLEDGE_STATE.UNKNOWN) reasons.add('field_unknown');
    if (claim.knowledgeState === CEI_KNOWLEDGE_STATE.UNCERTAIN) reasons.add('field_uncertain');
    if (claim.knowledgeState === CEI_KNOWLEDGE_STATE.CONFLICT) reasons.add('field_conflict');
    if (claim.knowledgeState === CEI_KNOWLEDGE_STATE.STALE) reasons.add('field_stale');
  }
  return {
    required: reasons.size > 0,
    reasonCodes: [...reasons].sort(),
    unknownConcepts: []
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function parseCatalogIntelligenceState(value) {
  const candidate = typeof value === 'string' ? JSON.parse(value) : value;
  return intelligenceStateSchema.parse(candidate);
}

export function createCatalogIntelligenceState(classified) {
  if (!classified || typeof classified !== 'object') {
    throw new Error('cei_intelligence_classification_required');
  }

  const automatic = classificationView(automaticClassification(classified));
  const effective = classificationView(classified, {
    overrideFields: classified.overrideFields || []
  });
  const domainConfidence = Number(classified.domain?.confidence || 0);

  const state = parseCatalogIntelligenceState({
    contractVersion: CEI_INTELLIGENCE_STATE_CONTRACT_VERSION,
    evidenceSchemaVersion: Number(classified.evidenceSchemaVersion || 1),
    classifierVersion: Number(classified.classifierVersion),
    classifierKey: classified.classifierKey,
    knowledgePackKey: classified.domain?.knowledgePackKey || null,
    knowledgePackVersion: classified.domain?.knowledgePackVersion ?? null,
    domain: {
      id: classified.domain?.id || 'unknown',
      confidence: domainConfidence,
      knowledgeState: deriveKnowledgeState(domainConfidence, {
        classificationStatus: classified.domain?.id === 'unknown' ? 'unknown' : null
      })
    },
    automatic,
    effective,
    overrideApplied: Boolean(classified.overrideApplied),
    research: researchState(automatic)
  });

  return deepFreeze(state);
}

export function serializeCatalogIntelligenceState(classified) {
  const state = createCatalogIntelligenceState(classified);
  return Object.freeze({
    state,
    stateJson: JSON.stringify(state),
    knowledgeState: state.effective.knowledgeState,
    conflictCount: state.effective.conflicts.length,
    reviewRequired: state.effective.reviewRequired,
    researchRequired: state.research.required
  });
}
