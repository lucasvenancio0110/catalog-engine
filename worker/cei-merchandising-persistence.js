import {
  CEI_MERCHANDISING_CONTRACT_VERSION,
  materializeMerchandisingNavigation
} from '../src/catalog-intelligence/core/merchandising.js';
import { SPORTS_KNOWLEDGE_PACK } from '../src/catalog-intelligence/domains/sports/knowledge-pack.js';
import { queryD1Batch } from './cloudflare-platform.js';

async function tenantD1Batch(platform, tenantId, databaseId, batch, fetchImpl) {
  const dispatchNative = platform.tenantDispatch && typeof platform.tenantDispatch.get === 'function';
  const effectiveBatch = dispatchNative
    ? [{ sql: 'SELECT ?1 AS tenant_id', params: [tenantId] }, ...batch]
    : batch;
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId,
      batch: effectiveBatch
    },
    { fetchImpl }
  );
  return dispatchNative ? result.slice(1) : result;
}

function countMaps(results) {
  const entityTypes = new Map(
    (results[0]?.results || []).map((row) => [
      String(row.entity_type || ''),
      Math.max(0, Number(row.total || 0))
    ])
  );
  const facets = new Map(
    (results[1]?.results || []).map((row) => [
      String(row.facet_id || ''),
      Math.max(0, Number(row.product_count || 0))
    ])
  );
  return { entityTypes, facets };
}

export function sportsMerchandisingCount(item, counts) {
  if (item.entityType) return counts.entityTypes.get(item.entityType) || 0;
  if (item.facetId) return counts.facets.get(item.facetId) || 0;
  return null;
}

export function buildSportsMerchandisingState(counts) {
  let navigation = materializeMerchandisingNavigation(
    SPORTS_KNOWLEDGE_PACK,
    (item) => sportsMerchandisingCount(item, counts)
  );
  let fallbackUsed = false;
  if (!navigation.length) {
    fallbackUsed = true;
    navigation = materializeMerchandisingNavigation(
      SPORTS_KNOWLEDGE_PACK,
      (item) => sportsMerchandisingCount(item, counts),
      { includeZero: true }
    );
  }
  return Object.freeze({
    contractVersion: CEI_MERCHANDISING_CONTRACT_VERSION,
    knowledgePackKey: SPORTS_KNOWLEDGE_PACK.key,
    knowledgePackVersion: SPORTS_KNOWLEDGE_PACK.version,
    domain: SPORTS_KNOWLEDGE_PACK.domain,
    fallbackUsed,
    navigation
  });
}

export async function persistCatalogMerchandising(
  platform,
  context,
  { fetchImpl = fetch } = {}
) {
  const countsResult = await tenantD1Batch(
    platform,
    context.tenant_id,
    context.d1_database_id,
    [
      {
        sql: `SELECT entity_type, SUM(product_count) AS total
                FROM catalog_teams
               GROUP BY entity_type`,
        params: []
      },
      {
        sql: `SELECT facet_id, product_count
                FROM catalog_facets`,
        params: []
      }
    ],
    fetchImpl
  );
  const state = buildSportsMerchandisingState(countMaps(countsResult));
  const navigationJson = JSON.stringify(state.navigation);
  const merchandisingJson = JSON.stringify({
    contractVersion: state.contractVersion,
    knowledgePackKey: state.knowledgePackKey,
    knowledgePackVersion: state.knowledgePackVersion,
    domain: state.domain,
    fallbackUsed: state.fallbackUsed,
    navigationItems: state.navigation.length
  });

  await tenantD1Batch(
    platform,
    context.tenant_id,
    context.d1_database_id,
    [
      {
        sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
              VALUES ('navigation', ?1, CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
        params: [navigationJson]
      },
      {
        sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
              VALUES ('merchandising', ?1, CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
        params: [merchandisingJson]
      }
    ],
    fetchImpl
  );

  return {
    navigationItems: state.navigation.length,
    fallbackUsed: state.fallbackUsed,
    knowledgePackKey: state.knowledgePackKey,
    knowledgePackVersion: state.knowledgePackVersion,
    merchandisingContractVersion: state.contractVersion
  };
}
