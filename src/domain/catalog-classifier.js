import { z } from 'zod';
import {
  CEI_NORMALIZED_EVIDENCE_VERSION,
  createCatalogEvidence,
  parseCatalogEvidence
} from '../catalog-intelligence/core/evidence.js';
import { classifyCatalogEvidenceAutomatically } from '../catalog-intelligence/runtime.js';
import { FACETS, LEAGUES, TEAMS } from './catalog-normalization.js';

export const CATALOG_CLASSIFIER_VERSION = 3;
export const CATALOG_CLASSIFIER_KEY = 'professional-v3';

function safePublicLabel(maxLength) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !/https?:\/\/|x\.yupoo\.com|photo\.yupoo\.com/i.test(value), {
      message: 'classification_override_public_label_unsafe'
    });
}

const overrideSchema = z
  .object({
    displayName: safePublicLabel(240).optional(),
    displayCategoryName: safePublicLabel(160).optional(),
    teamId: z.string().trim().min(1).max(80).nullable().optional(),
    leagueId: z.string().trim().min(1).max(80).nullable().optional(),
    facetIds: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
    classificationStatus: z.enum(['automatic', 'needs_review', 'unknown']).optional(),
    classificationConfidence: z.number().min(0).max(1).optional()
  })
  .strict();

const teamById = new Map(TEAMS.map((entry) => [entry.id, entry]));
const leagueById = new Map(LEAGUES.map((entry) => [entry.id, entry]));
const facetById = new Map(FACETS.map((entry) => [entry.id, entry]));

function normalizedSearchText(parts) {
  return [...new Set(parts.flatMap((value) => (Array.isArray(value) ? value : [value])))]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function freezeClaimValue(value) {
  if (Array.isArray(value)) return Object.freeze([...value]);
  if (value && typeof value === 'object') return Object.freeze({ ...value });
  return value;
}

function frozenClaims(claims = {}) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(claims).map(([field, claim]) => [
        field,
        Object.freeze({
          ...claim,
          value: freezeClaimValue(claim?.value),
          evidenceSources: Object.freeze([...(claim?.evidenceSources || [])])
        })
      ])
    )
  );
}

function automaticStateSnapshot(value) {
  return Object.freeze({
    status: value.classificationStatus,
    confidence: Number(value.classificationConfidence),
    team: value.team || null,
    league: value.league || null,
    facets: Object.freeze([...(value.facets || [])]),
    fieldConfidence: Object.freeze({ ...(value.fieldConfidence || {}) }),
    claims: frozenClaims(value.claims),
    season: value.season ? Object.freeze({ ...value.season }) : null,
    conflicts: Object.freeze([...(value.conflicts || [])]),
    reviewRequired: Boolean(value.reviewRequired)
  });
}

function merchantOverrideClaim(claim, value) {
  return Object.freeze({
    ...(claim || {}),
    value: freezeClaimValue(value),
    confidence: 1,
    evidenceSources: Object.freeze([]),
    source: 'merchant_override'
  });
}

export function parseCatalogClassificationOverride(value) {
  if (value === null || value === undefined || value === '') return null;
  const candidate = typeof value === 'string' ? JSON.parse(value) : value;
  const parsed = overrideSchema.parse(candidate);
  if (parsed.teamId && !teamById.has(parsed.teamId)) {
    throw new Error('classification_override_unknown_team');
  }
  if (parsed.leagueId && !leagueById.has(parsed.leagueId)) {
    throw new Error('classification_override_unknown_league');
  }
  if (parsed.facetIds?.some((id) => !facetById.has(id))) {
    throw new Error('classification_override_unknown_facet');
  }
  return parsed;
}

function applyClassificationOverride(base, overrideValue) {
  const automaticState = automaticStateSnapshot(base);
  const override = parseCatalogClassificationOverride(overrideValue);
  if (!override) {
    return {
      ...base,
      evidenceSchemaVersion: CEI_NORMALIZED_EVIDENCE_VERSION,
      automaticState,
      overrideFields: Object.freeze([]),
      classifierVersion: CATALOG_CLASSIFIER_VERSION,
      classifierKey: CATALOG_CLASSIFIER_KEY,
      overrideApplied: false
    };
  }

  const teamOverridden = Object.hasOwn(override, 'teamId');
  const leagueOverridden = Object.hasOwn(override, 'leagueId');
  const facetsOverridden = Object.hasOwn(override, 'facetIds');
  const team = teamOverridden
    ? override.teamId
      ? teamById.get(override.teamId)
      : null
    : base.team;
  const league = leagueOverridden
    ? override.leagueId
      ? leagueById.get(override.leagueId)
      : null
    : teamOverridden && team?.leagueId
      ? leagueById.get(team.leagueId) || base.league
      : base.league;
  const facets = override.facetIds
    ? override.facetIds.map((id) => facetById.get(id))
    : base.facets;
  const displayName = override.displayName || base.displayName;
  const displayCategoryName = override.displayCategoryName || base.displayCategoryName;
  const searchText = normalizedSearchText([
    base.searchText,
    displayName,
    displayCategoryName,
    team?.name,
    team?.shortName,
    team?.aliases || [],
    league?.name,
    facets.map((facet) => facet.name)
  ]);

  const resolvedConflictFields = new Set();
  if (teamOverridden) resolvedConflictFields.add('team');
  if (leagueOverridden || (teamOverridden && team?.leagueId)) resolvedConflictFields.add('league');
  if (facetsOverridden) {
    resolvedConflictFields.add('facets');
    resolvedConflictFields.add('version');
  }
  const conflicts = (base.conflicts || []).filter(
    (item) => !resolvedConflictFields.has(item.field)
  );

  const fieldConfidence = {
    ...(base.fieldConfidence || {})
  };
  if (teamOverridden) fieldConfidence.team = 1;
  if (leagueOverridden || (teamOverridden && team?.leagueId)) fieldConfidence.league = 1;
  if (facetsOverridden) fieldConfidence.facets = 1;

  const claims = { ...(base.claims || {}) };
  if (teamOverridden) claims.team = merchantOverrideClaim(claims.team, team?.id || null);
  if (leagueOverridden || (teamOverridden && team?.leagueId)) {
    claims.league = merchantOverrideClaim(claims.league, league?.id || null);
  }
  if (facetsOverridden) {
    claims.facets = merchantOverrideClaim(
      claims.facets,
      [...new Set(facets.map((facet) => facet.id).filter(Boolean))]
    );
  }

  const automaticStatus = base.automaticClassificationStatus || base.classificationStatus;
  const automaticConfidence =
    base.automaticClassificationConfidence ?? base.classificationConfidence;
  const conflictFreeStatus = conflicts.length ? 'needs_review' : automaticStatus;
  const conflictFreeConfidence = conflicts.length
    ? Math.min(automaticConfidence, 0.5)
    : automaticConfidence;
  const overrideFields = [];
  if (teamOverridden) overrideFields.push('team');
  if (leagueOverridden || (teamOverridden && team?.leagueId)) overrideFields.push('league');
  if (facetsOverridden) overrideFields.push('facets');

  return {
    ...base,
    displayName,
    displayCategoryName,
    searchText,
    team,
    league,
    facets,
    claims: frozenClaims(claims),
    conflicts,
    reviewRequired: conflicts.length > 0,
    fieldConfidence,
    classificationStatus: override.classificationStatus || conflictFreeStatus,
    classificationConfidence:
      override.classificationConfidence ?? conflictFreeConfidence,
    evidenceSchemaVersion: CEI_NORMALIZED_EVIDENCE_VERSION,
    automaticState,
    overrideFields: Object.freeze(overrideFields),
    classifierVersion: CATALOG_CLASSIFIER_VERSION,
    classifierKey: CATALOG_CLASSIFIER_KEY,
    overrideApplied: true
  };
}

export function classifyCatalogEvidence(evidenceValue, overrideValue = null) {
  const evidence = parseCatalogEvidence(evidenceValue);
  const base = classifyCatalogEvidenceAutomatically(evidence);
  return applyClassificationOverride(base, overrideValue);
}

export function classifyCatalogRecord(product, categoryPathNames = [], overrideValue = null) {
  const evidence = createCatalogEvidence({
    recordId: product?.productId || product?.recordId || null,
    title: product?.sourceName || product?.name || '',
    description: product?.description || '',
    sourceCategoryName: product?.sourceCategoryName || product?.category || '',
    categoryPathNames,
    structuredAttributes: product?.structuredAttributes || {},
    provenance: product?.provenance || {}
  });
  return classifyCatalogEvidence(evidence, overrideValue);
}
