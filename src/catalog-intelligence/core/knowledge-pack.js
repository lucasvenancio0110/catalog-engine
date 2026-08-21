import {
  CEI_MERCHANDISING_CONTRACT_VERSION,
  defineMerchandising
} from './merchandising.js';

const PACK_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DOMAIN_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const CEI_KNOWLEDGE_PACK_CONTRACT_VERSION = 1;

function normalizedKey(value, pattern, code) {
  const key = String(value || '').trim().toLowerCase();
  if (!pattern.test(key)) throw new Error(code);
  return key;
}

function freezeEntries(entries, code) {
  if (!Array.isArray(entries)) throw new Error(code);
  const ids = new Set();
  const frozen = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(code);
    const id = String(entry.id || '').trim();
    if (!id || ids.has(id)) throw new Error(code);
    ids.add(id);
    return Object.freeze({ ...entry });
  });
  return Object.freeze(frozen);
}

function normalizedMerchandising(value) {
  if (
    value?.contractVersion === CEI_MERCHANDISING_CONTRACT_VERSION &&
    Array.isArray(value?.navigation)
  ) {
    return defineMerchandising({ navigation: value.navigation });
  }
  return defineMerchandising(value || {});
}

export function defineKnowledgePack({
  key,
  domain,
  version,
  competitions = [],
  entities = [],
  facets = [],
  reviewThresholds = {},
  merchandising = {}
} = {}) {
  const normalizedVersion = Number(version);
  if (!Number.isInteger(normalizedVersion) || normalizedVersion < 1) {
    throw new Error('cei_knowledge_pack_version_invalid');
  }

  const normalizedThresholds = Object.freeze(
    Object.fromEntries(
      Object.entries(reviewThresholds || {}).map(([name, value]) => {
        const threshold = Number(value);
        if (!name || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
          throw new Error('cei_knowledge_pack_review_threshold_invalid');
        }
        return [name, threshold];
      })
    )
  );

  return Object.freeze({
    contractVersion: CEI_KNOWLEDGE_PACK_CONTRACT_VERSION,
    key: normalizedKey(key, PACK_KEY_PATTERN, 'cei_knowledge_pack_key_invalid'),
    domain: normalizedKey(domain, DOMAIN_KEY_PATTERN, 'cei_knowledge_pack_domain_invalid'),
    version: normalizedVersion,
    competitions: freezeEntries(competitions, 'cei_knowledge_pack_competitions_invalid'),
    entities: freezeEntries(entities, 'cei_knowledge_pack_entities_invalid'),
    facets: freezeEntries(facets, 'cei_knowledge_pack_facets_invalid'),
    reviewThresholds: normalizedThresholds,
    merchandising: normalizedMerchandising(merchandising)
  });
}
