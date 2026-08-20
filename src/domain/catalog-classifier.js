import { z } from 'zod';
import {
  createCatalogEvidence,
  parseCatalogEvidence
} from '../catalog-intelligence/core/evidence.js';
import {
  FACETS,
  LEAGUES,
  TEAMS,
  normalizeCatalogProduct
} from './catalog-normalization.js';

export const CATALOG_CLASSIFIER_VERSION = 1;
export const CATALOG_CLASSIFIER_KEY = 'professional-v1';

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
  const override = parseCatalogClassificationOverride(overrideValue);
  if (!override) {
    return {
      ...base,
      classifierVersion: CATALOG_CLASSIFIER_VERSION,
      classifierKey: CATALOG_CLASSIFIER_KEY,
      overrideApplied: false
    };
  }

  const teamOverridden = Object.hasOwn(override, 'teamId');
  const leagueOverridden = Object.hasOwn(override, 'leagueId');
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

  return {
    ...base,
    displayName,
    displayCategoryName,
    searchText,
    team,
    league,
    facets,
    classificationStatus: override.classificationStatus || base.classificationStatus,
    classificationConfidence:
      override.classificationConfidence ?? base.classificationConfidence,
    classifierVersion: CATALOG_CLASSIFIER_VERSION,
    classifierKey: CATALOG_CLASSIFIER_KEY,
    overrideApplied: true
  };
}

export function classifyCatalogEvidence(evidenceValue, overrideValue = null) {
  const evidence = parseCatalogEvidence(evidenceValue);
  const base = normalizeCatalogProduct(
    {
      sourceName: evidence.title,
      name: evidence.title,
      description: evidence.description,
      sourceCategoryName: evidence.sourceCategoryName,
      category: evidence.sourceCategoryName,
      structuredAttributes: evidence.structuredAttributes
    },
    evidence.categoryPathNames
  );
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
