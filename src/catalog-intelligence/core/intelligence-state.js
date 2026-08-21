import { z } from 'zod';

export const CEI_INTELLIGENCE_STATE_CONTRACT_VERSION = 1;

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9][a-z0-9:_-]*$/i);

const nullableEntityId = identifier.max(80).nullable();
const confidence = z.number().finite().min(0).max(1);
const classificationStatus = z.enum(['automatic', 'needs_review', 'unknown']);

const fieldConfidenceSchema = z
  .record(identifier.max(48), confidence)
  .refine((value) => Object.keys(value).length <= 24, {
    message: 'cei_intelligence_field_confidence_too_large'
  });

const seasonSchema = z
  .object({
    label: z.string().trim().min(4).max(16),
    startYear: z.number().int().min(1800).max(2200),
    endYear: z.number().int().min(1800).max(2201),
    confidence,
    evidenceSources: z.array(z.string().trim().min(1).max(64)).max(16)
  })
  .strict()
  .refine((value) => value.endYear === value.startYear + 1, {
    message: 'cei_intelligence_season_range_invalid'
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
    teamId: nullableEntityId,
    leagueId: nullableEntityId,
    facetIds: z.array(identifier.max(80)).max(32),
    fieldConfidence: fieldConfidenceSchema,
    season: seasonSchema.nullable(),
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
        confidence
      })
      .strict(),
    automatic: classificationViewSchema,
    effective: classificationViewSchema,
    overrideApplied: z.boolean()
  })
  .strict();

function uniqueIds(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function normalizeSeason(value) {
  if (!value) return null;
  return {
    label: value.label,
    startYear: Number(value.startYear),
    endYear: Number(value.endYear),
    confidence: Number(value.confidence),
    evidenceSources: uniqueIds(value.evidenceSources)
  };
}

function normalizeConflicts(values) {
  return (values || []).map((conflict) => ({
    code: conflict.code,
    field: conflict.field,
    candidateIds: uniqueIds(conflict.candidateIds)
  }));
}

function currentView(classified) {
  return {
    status: classified.classificationStatus,
    confidence: Number(classified.classificationConfidence),
    teamId: classified.team?.id || null,
    leagueId: classified.league?.id || null,
    facetIds: uniqueIds((classified.facets || []).map((facet) => facet.id)),
    fieldConfidence: { ...(classified.fieldConfidence || {}) },
    season: normalizeSeason(classified.season),
    conflicts: normalizeConflicts(classified.conflicts),
    reviewRequired: Boolean(classified.reviewRequired)
  };
}

function automaticView(classified) {
  if (classified.automaticState) {
    return {
      status: classified.automaticState.status,
      confidence: Number(classified.automaticState.confidence),
      teamId: classified.automaticState.teamId || null,
      leagueId: classified.automaticState.leagueId || null,
      facetIds: uniqueIds(classified.automaticState.facetIds),
      fieldConfidence: { ...(classified.automaticState.fieldConfidence || {}) },
      season: normalizeSeason(classified.automaticState.season),
      conflicts: normalizeConflicts(classified.automaticState.conflicts),
      reviewRequired: Boolean(classified.automaticState.reviewRequired)
    };
  }
  return currentView(classified);
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

  const state = parseCatalogIntelligenceState({
    contractVersion: CEI_INTELLIGENCE_STATE_CONTRACT_VERSION,
    evidenceSchemaVersion: Number(classified.evidenceSchemaVersion || 1),
    classifierVersion: Number(classified.classifierVersion),
    classifierKey: classified.classifierKey,
    knowledgePackKey: classified.domain?.knowledgePackKey || null,
    knowledgePackVersion: classified.domain?.knowledgePackVersion ?? null,
    domain: {
      id: classified.domain?.id || 'unknown',
      confidence: Number(classified.domain?.confidence || 0)
    },
    automatic: automaticView(classified),
    effective: currentView(classified),
    overrideApplied: Boolean(classified.overrideApplied)
  });

  return deepFreeze(state);
}

export function serializeCatalogIntelligenceState(classified) {
  const state = createCatalogIntelligenceState(classified);
  return Object.freeze({
    state,
    automaticJson: JSON.stringify(state.automatic),
    effectiveJson: JSON.stringify(state.effective),
    conflictCount: state.effective.conflicts.length
  });
}
