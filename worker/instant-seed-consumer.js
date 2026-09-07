import { resolveCatalogPreviewSeedProvider } from './ingestion/providers/index.js';
import { parseInstantSeedMessage } from './instant-seed-queue.js';

const DECISION_KIND = 'full_connected_source';

class InstantSeedError extends Error {
  constructor(code, { stale = false } = {}) {
    super(code);
    this.name = 'InstantSeedError';
    this.code = code;
    this.stale = stale;
  }
}

function safeCode(error) {
  const code = String(error?.code || error?.message || '').trim().toLowerCase();
  if (/^(instant_seed|supplier|catalog_provider|construction)_[a-z0-9_]{1,100}$/.test(code)) {
    return code;
  }
  return 'instant_seed_failed';
}

function constructionStub(env, tenantId) {
  const namespace = env?.TENANT_CONSTRUCTION_STATE;
  if (
    !namespace ||
    typeof namespace.idFromName !== 'function' ||
    typeof namespace.get !== 'function'
  ) {
    throw new InstantSeedError('instant_seed_construction_unavailable');
  }
  return namespace.get(namespace.idFromName(tenantId));
}

async function loadAuthority(db, { tenantId, sourceKey }) {
  if (!db) throw new InstantSeedError('instant_seed_database_unbound');
  const row = await db
    .prepare(
      `SELECT s.provider, s.source_url
         FROM supplier_sources s
         JOIN tenant_source_connections c
           ON c.tenant_id=s.tenant_id
          AND c.source_key=s.source_key
          AND c.provider=s.provider
          AND c.status='active'
         JOIN tenant_import_decisions d
           ON d.tenant_id=s.tenant_id
          AND d.source_key=s.source_key
          AND d.source_locator_ref=c.source_locator_ref
          AND d.status='confirmed'
          AND d.decision_kind=?3
        WHERE s.tenant_id=?1
          AND s.source_key=?2
          AND s.status='active'
        LIMIT 1`
    )
    .bind(tenantId, sourceKey, DECISION_KIND)
    .first();
  if (!row) throw new InstantSeedError('instant_seed_authority_stale', { stale: true });
  const provider = String(row.provider || '').trim().toLowerCase();
  const sourceUrl = String(row.source_url || '').trim();
  if (!provider || !sourceUrl) throw new InstantSeedError('instant_seed_authority_invalid');
  return { provider, sourceUrl };
}

async function currentProjection(stub) {
  const response = await stub.fetch('https://construction.internal/projection');
  if (!response.ok) throw new InstantSeedError('instant_seed_construction_unavailable');
  const payload = await response.json().catch(() => null);
  if (!payload || !['empty', 'indexed'].includes(payload.readiness)) {
    throw new InstantSeedError('instant_seed_construction_invalid');
  }
  return payload;
}

async function writeSeed(stub, seed) {
  const response = await stub.fetch('https://construction.internal/seed', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(seed)
  });
  if (!response.ok) throw new InstantSeedError('instant_seed_construction_write_failed');
  const payload = await response.json().catch(() => null);
  if (!payload?.ok || !Number.isInteger(payload?.revision)) {
    throw new InstantSeedError('instant_seed_construction_write_failed');
  }
  return payload;
}

export async function handleInstantSeedMessage(
  rawMessage,
  env,
  { resolveProvider = resolveCatalogPreviewSeedProvider } = {}
) {
  const message = parseInstantSeedMessage(rawMessage);
  try {
    const stub = constructionStub(env, message.tenantId);
    const projection = await currentProjection(stub);
    if (projection.readiness === 'indexed' && Number(projection.productCount || 0) > 0) {
      return { outcome: 'success', state: 'already_seeded', productCount: Number(projection.productCount) };
    }

    const authority = await loadAuthority(env.CATALOG_DB, message);
    const provider = resolveProvider(authority.provider);
    const seed = await provider.previewSeed(authority.sourceUrl, {
      maxItems: 24,
      deadlineMs: 4_500
    });
    await writeSeed(stub, seed);
    return { outcome: 'success', state: 'seeded', productCount: seed.items.length };
  } catch (error) {
    if (error?.stale) {
      return { outcome: 'stale', code: safeCode(error) };
    }
    return { outcome: 'retry', code: safeCode(error) };
  }
}

export const instantSeedConsumerContract = Object.freeze({
  maxItems: 24,
  deadlineMs: 4_500
});
