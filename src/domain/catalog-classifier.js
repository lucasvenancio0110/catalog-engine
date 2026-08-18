import { z } from 'zod';
import {
  FACETS,
  LEAGUES,
  TEAMS,
  normalizeCatalogProduct
} from './catalog-normalization.js';

export const CATALOG_CLASSIFIER_VERSION = 1;
export const CATALOG_CLASSIFIER_KEY = 'professional-v1';

const overrideSchema = z
  .object({
    displayName: z.string().trim().min(1).max(240).optional(),
    displayCategoryName: z.string().trim().min(1).max(160).optional(),
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

export function parseCatalogClassificationOverride(value) {
  if (value === null || value === undefined || value === '') return null;
  const candidate = typeof value === 'string' ? JSON.parse(value) : value;
  const parsed = overrideSchema.parse(candidate);
  if (parsed.teamId && !teamById.has(parsed.teamId)) throw new Error('classification_override_unknown_team');
  if (parsed.leagueId && !leagueById.has(parsed.leagueId)) {
    throw new Error('classification_override_unknown_league');
  }
  if (parsed.facetIds?.some((id) => !facetById.has(id))) {
    throw new Error('classification_override_unknown_facet');
  }
  return parsed;
}

export function classifyCatalogRecord(product, categoryPathNames = [], overrideValue = null) {
  const base = normalizeCatalogProduct(product, categoryPathNames);
  const override = parseCatalogClassificationOverride(overrideValue);
  if (!override) {
    return {
      ...base,
      classifierVersion: CATALOG_CLASSIFIER_VERSION,
      classifierKey: CATALOG_CLASSIFIER_KEY,
      overrideApplied: false
    };
  }

  const team = Object.hasOwn(override, 'teamId')
    ? override.teamId
      ? teamById.get(override.teamId)
      : null
    : base.team;
  const league = Object.hasOwn(override, 'leagueId')
    ? override.leagueId
      ? leagueById.get(override.leagueId)
      : null
    : base.league;
  const facets = override.facetIds
    ? override.facetIds.map((id) => facetById.get(id))
    : base.facets;

  return {
    ...base,
    displayName: override.displayName || base.displayName,
    displayCategoryName: override.displayCategoryName || base.displayCategoryName,
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
