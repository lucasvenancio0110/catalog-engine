import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createD1Database, queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const PRODUCT_COUNT = 20_000;
const MEDIA_PER_PRODUCT = 2;
const CONCURRENT_READ_ATTEMPTS = 5;
const CONCURRENT_READ_DELAY_MS = 25;

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('m7d7_probe_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('m7d7_probe_token_unconfigured');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('m7d7_probe_recurring_sync_must_remain_off');
}
if (String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || '') !== '') {
  throw new Error('m7d7_probe_active_cohort_must_remain_empty');
}

const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
const suffix = createHash('sha256').update(`m7d7-d1-probe:${seed}`).digest('hex').slice(0, 16);
const databaseName = `cem7d7probe-${suffix}`;
let databaseId = null;
let cleanupSucceeded = false;

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digitCte(limitParam = '?1') {
  return `WITH digit(n) AS (
    VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
  ), nums(n) AS (
    SELECT a.n + 10*b.n + 100*c.n + 1000*d.n + 10000*e.n
      FROM digit a
      CROSS JOIN digit b
      CROSS JOIN digit c
      CROSS JOIN digit d
      CROSS JOIN digit e
     WHERE (a.n + 10*b.n + 100*c.n + 1000*d.n + 10000*e.n) < CAST(${limitParam} AS INTEGER)
  )`;
}

async function batch(batchQueries) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch: batchQueries });
}

function internalDurationMs(results) {
  return Number(
    (results || []).reduce((sum, row) => sum + Number(row?.meta?.duration || 0), 0).toFixed(3)
  );
}

async function timedBatch(batchQueries) {
  const started = performance.now();
  const result = await batch(batchQueries);
  return {
    wallMs: Number((performance.now() - started).toFixed(1)),
    internalMs: internalDurationMs(result),
    result
  };
}

async function deleteProbeDatabase() {
  if (!databaseId) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await fetch(
      `${API_ORIGIN}/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`,
      {
        method: 'DELETE',
        redirect: 'error',
        signal: controller.signal,
        headers: { authorization: `Bearer ${API_TOKEN}`, accept: 'application/json' }
      }
    );
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error('m7d7_probe_cleanup_failed');
  cleanupSucceeded = true;
}

async function setupSchema() {
  await batch([
    {
      sql: `CREATE TABLE authority_state (
        authority_id INTEGER PRIMARY KEY CHECK(authority_id=1),
        state TEXT NOT NULL,
        revision INTEGER NOT NULL
      )`,
      params: []
    },
    {
      sql: `CREATE TABLE canonical_products (
        product_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        revision INTEGER NOT NULL
      )`,
      params: []
    },
    {
      sql: `CREATE TABLE canonical_media (
        product_id TEXT NOT NULL,
        slot INTEGER NOT NULL,
        media_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY(product_id, slot)
      )`,
      params: []
    },
    {
      sql: `CREATE TABLE canonical_classification (
        product_id TEXT PRIMARY KEY,
        classifier_version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        revision INTEGER NOT NULL
      )`,
      params: []
    },
    {
      sql: `CREATE TABLE canonical_intelligence (
        product_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        revision INTEGER NOT NULL
      )`,
      params: []
    },
    { sql: `CREATE TABLE candidate_products AS SELECT * FROM canonical_products WHERE 0`, params: [] },
    { sql: `CREATE UNIQUE INDEX candidate_products_id ON candidate_products(product_id)`, params: [] },
    { sql: `CREATE TABLE candidate_media AS SELECT * FROM canonical_media WHERE 0`, params: [] },
    { sql: `CREATE UNIQUE INDEX candidate_media_id ON candidate_media(product_id, slot)`, params: [] },
    {
      sql: `CREATE TABLE candidate_classification AS SELECT * FROM canonical_classification WHERE 0`,
      params: []
    },
    {
      sql: `CREATE UNIQUE INDEX candidate_classification_id ON candidate_classification(product_id)`,
      params: []
    },
    {
      sql: `CREATE TABLE candidate_intelligence AS SELECT * FROM canonical_intelligence WHERE 0`,
      params: []
    },
    {
      sql: `CREATE UNIQUE INDEX candidate_intelligence_id ON candidate_intelligence(product_id)`,
      params: []
    },
    {
      sql: `CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`,
      params: []
    },
    {
      sql: `CREATE TABLE generation_authority (
        authority_id INTEGER PRIMARY KEY CHECK(authority_id=1),
        active_generation TEXT NOT NULL,
        previous_generation TEXT
      )`,
      params: []
    },
    {
      sql: `CREATE TABLE generation_products (
        generation TEXT NOT NULL,
        product_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(generation, product_id)
      )`,
      params: []
    },
    {
      sql: `CREATE TABLE generation_media (
        generation TEXT NOT NULL,
        product_id TEXT NOT NULL,
        slot INTEGER NOT NULL,
        media_id TEXT NOT NULL,
        PRIMARY KEY(generation, product_id, slot)
      )`,
      params: []
    },
    { sql: `INSERT INTO authority_state(authority_id,state,revision) VALUES(1,'verified',1)`, params: [] },
    { sql: `INSERT INTO rollback_probe(id,value) VALUES(1,1)`, params: [] },
    {
      sql: `INSERT INTO generation_authority(authority_id,active_generation,previous_generation)
            VALUES(1,'g1',NULL)`,
      params: []
    }
  ]);
}

async function seedSetBasedScenario() {
  const cte = digitCte();
  const queries = [
    {
      sql: `${cte}
        INSERT INTO canonical_products(product_id,name,payload,revision)
        SELECT printf('p%05d',n), printf('old-%05d',n), hex(zeroblob(128)), 1 FROM nums`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO candidate_products(product_id,name,payload,revision)
        SELECT printf('p%05d',n), printf('new-%05d',n), hex(zeroblob(128)), 2 FROM nums`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO canonical_media(product_id,slot,media_id,payload,revision)
        SELECT printf('p%05d',n), slot,
               printf('old-m-%05d-%d',n,slot), hex(zeroblob(64)), 1
          FROM nums CROSS JOIN (SELECT 0 AS slot UNION ALL SELECT 1)`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO candidate_media(product_id,slot,media_id,payload,revision)
        SELECT printf('p%05d',n), slot,
               printf('new-m-%05d-%d',n,slot), hex(zeroblob(64)), 2
          FROM nums CROSS JOIN (SELECT 0 AS slot UNION ALL SELECT 1)`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO canonical_classification(product_id,classifier_version,payload,revision)
        SELECT printf('p%05d',n), 3, hex(zeroblob(96)), 1 FROM nums`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO candidate_classification(product_id,classifier_version,payload,revision)
        SELECT printf('p%05d',n), 3, hex(zeroblob(96)), 2 FROM nums`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO canonical_intelligence(product_id,payload,revision)
        SELECT printf('p%05d',n), hex(zeroblob(160)), 1 FROM nums`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO candidate_intelligence(product_id,payload,revision)
        SELECT printf('p%05d',n), hex(zeroblob(160)), 2 FROM nums`,
      params: [PRODUCT_COUNT]
    }
  ];
  return timedBatch(queries);
}

function setBasedPromotionBatch() {
  const gate = `EXISTS (SELECT 1 FROM authority_state a WHERE a.authority_id=1 AND a.state='promoting' AND a.revision=1)`;
  return [
    {
      sql: `UPDATE authority_state SET state='promoting'
             WHERE authority_id=1 AND state='verified' AND revision=1`,
      params: []
    },
    {
      sql: `INSERT INTO canonical_products(product_id,name,payload,revision)
            SELECT product_id,name,payload,revision FROM candidate_products
             WHERE ${gate}
            ON CONFLICT(product_id) DO UPDATE SET
              name=excluded.name,payload=excluded.payload,revision=excluded.revision`,
      params: []
    },
    {
      sql: `INSERT INTO canonical_classification(product_id,classifier_version,payload,revision)
            SELECT product_id,classifier_version,payload,revision FROM candidate_classification
             WHERE ${gate}
            ON CONFLICT(product_id) DO UPDATE SET
              classifier_version=excluded.classifier_version,
              payload=excluded.payload,
              revision=excluded.revision`,
      params: []
    },
    {
      sql: `INSERT INTO canonical_intelligence(product_id,payload,revision)
            SELECT product_id,payload,revision FROM candidate_intelligence
             WHERE ${gate}
            ON CONFLICT(product_id) DO UPDATE SET
              payload=excluded.payload,revision=excluded.revision`,
      params: []
    },
    {
      sql: `DELETE FROM canonical_media
             WHERE ${gate}
               AND EXISTS (
                 SELECT 1 FROM candidate_products p WHERE p.product_id=canonical_media.product_id
               )`,
      params: []
    },
    {
      sql: `INSERT INTO canonical_media(product_id,slot,media_id,payload,revision)
            SELECT product_id,slot,media_id,payload,revision FROM candidate_media
             WHERE ${gate}`,
      params: []
    },
    {
      sql: `UPDATE authority_state
               SET state='promoted', revision=2
             WHERE authority_id=1 AND state='promoting' AND revision=1`,
      params: []
    },
    {
      sql: `SELECT
              (SELECT state FROM authority_state WHERE authority_id=1) AS state,
              (SELECT revision FROM authority_state WHERE authority_id=1) AS revision,
              (SELECT COUNT(*) FROM canonical_products WHERE revision=2) AS products_new,
              (SELECT COUNT(*) FROM canonical_media WHERE revision=2) AS media_new,
              (SELECT COUNT(*) FROM canonical_classification WHERE revision=2) AS classifications_new,
              (SELECT COUNT(*) FROM canonical_intelligence WHERE revision=2) AS intelligence_new`,
      params: []
    }
  ];
}

async function readSetBasedSnapshot() {
  const started = performance.now();
  const result = await batch([
    {
      sql: `SELECT
              (SELECT state FROM authority_state WHERE authority_id=1) AS state,
              (SELECT revision FROM authority_state WHERE authority_id=1) AS revision,
              (SELECT COUNT(*) FROM canonical_products WHERE revision=2) AS products_new,
              (SELECT COUNT(*) FROM canonical_media WHERE revision=2) AS media_new,
              (SELECT COUNT(*) FROM canonical_classification WHERE revision=2) AS classifications_new,
              (SELECT COUNT(*) FROM canonical_intelligence WHERE revision=2) AS intelligence_new`,
      params: []
    }
  ]);
  return {
    wallMs: Number((performance.now() - started).toFixed(1)),
    row: result?.[0]?.results?.[0] || null
  };
}

async function proveRollback() {
  let failureCode = null;
  try {
    await batch([
      { sql: `UPDATE rollback_probe SET value=2 WHERE id=1`, params: [] },
      { sql: `INSERT INTO deliberately_missing_table(id) VALUES(1)`, params: [] },
      { sql: `UPDATE rollback_probe SET value=3 WHERE id=1`, params: [] }
    ]);
  } catch (error) {
    failureCode = String(error?.code || error?.message || 'unknown');
  }
  const result = await batch([{ sql: `SELECT value FROM rollback_probe WHERE id=1`, params: [] }]);
  const value = Number(result?.[0]?.results?.[0]?.value);
  return { failureObserved: Boolean(failureCode), failureCode, rolledBack: value === 1, value };
}

async function proveSetBasedPromotion() {
  const promotionPromise = timedBatch(setBasedPromotionBatch());
  const readPromises = [];
  for (let index = 0; index < CONCURRENT_READ_ATTEMPTS; index += 1) {
    await sleep(CONCURRENT_READ_DELAY_MS);
    readPromises.push(readSetBasedSnapshot());
  }
  const [promotion, reads] = await Promise.all([promotionPromise, Promise.all(readPromises)]);
  const finalSnapshot = await readSetBasedSnapshot();
  const expectedMedia = PRODUCT_COUNT * MEDIA_PER_PRODUCT;
  const final = finalSnapshot.row || {};
  const complete =
    String(final.state) === 'promoted' &&
    Number(final.revision) === 2 &&
    Number(final.products_new) === PRODUCT_COUNT &&
    Number(final.media_new) === expectedMedia &&
    Number(final.classifications_new) === PRODUCT_COUNT &&
    Number(final.intelligence_new) === PRODUCT_COUNT;
  const readStatesValid = reads.every((entry) => {
    const row = entry.row || {};
    const revision = Number(row.revision);
    if (revision === 1) {
      return (
        Number(row.products_new) === 0 &&
        Number(row.media_new) === 0 &&
        Number(row.classifications_new) === 0 &&
        Number(row.intelligence_new) === 0
      );
    }
    return (
      revision === 2 &&
      Number(row.products_new) === PRODUCT_COUNT &&
      Number(row.media_new) === expectedMedia &&
      Number(row.classifications_new) === PRODUCT_COUNT &&
      Number(row.intelligence_new) === PRODUCT_COUNT
    );
  });
  return {
    productCount: PRODUCT_COUNT,
    mediaCount: expectedMedia,
    estimatedCanonicalRowWrites: PRODUCT_COUNT * 5 + expectedMedia * 2,
    wallMs: promotion.wallMs,
    internalMs: promotion.internalMs,
    complete,
    concurrentReadStatesValid: readStatesValid,
    concurrentReads: reads.map((entry) => ({ wallMs: entry.wallMs, revision: Number(entry.row?.revision) })),
    finalSnapshot: final
  };
}

async function seedGenerationScenario() {
  const cte = digitCte();
  return timedBatch([
    {
      sql: `${cte}
        INSERT INTO generation_products(generation,product_id,payload)
        SELECT 'g1',printf('p%05d',n),hex(zeroblob(128)) FROM nums`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO generation_products(generation,product_id,payload)
        SELECT 'g2',printf('p%05d',n),hex(zeroblob(128)) FROM nums`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO generation_media(generation,product_id,slot,media_id)
        SELECT 'g1',printf('p%05d',n),slot,printf('g1-m-%05d-%d',n,slot)
          FROM nums CROSS JOIN (SELECT 0 AS slot UNION ALL SELECT 1)`,
      params: [PRODUCT_COUNT]
    },
    {
      sql: `${cte}
        INSERT INTO generation_media(generation,product_id,slot,media_id)
        SELECT 'g2',printf('p%05d',n),slot,printf('g2-m-%05d-%d',n,slot)
          FROM nums CROSS JOIN (SELECT 0 AS slot UNION ALL SELECT 1)`,
      params: [PRODUCT_COUNT]
    }
  ]);
}

async function proveGenerationFlip() {
  const started = performance.now();
  const result = await batch([
    {
      sql: `UPDATE generation_authority
               SET previous_generation=active_generation, active_generation='g2'
             WHERE authority_id=1 AND active_generation='g1'`,
      params: []
    },
    {
      sql: `SELECT active_generation,previous_generation
              FROM generation_authority WHERE authority_id=1`,
      params: []
    }
  ]);
  const wallMs = Number((performance.now() - started).toFixed(1));
  const snapshot = await batch([
    {
      sql: `SELECT a.active_generation,
                   (SELECT COUNT(*) FROM generation_products p WHERE p.generation=a.active_generation) AS products,
                   (SELECT COUNT(*) FROM generation_media m WHERE m.generation=a.active_generation) AS media
              FROM generation_authority a WHERE a.authority_id=1`,
      params: []
    }
  ]);
  const row = snapshot?.[0]?.results?.[0] || {};
  return {
    wallMs,
    internalMs: internalDurationMs(result),
    activeGeneration: String(row.active_generation || ''),
    products: Number(row.products || 0),
    media: Number(row.media || 0),
    complete:
      String(row.active_generation) === 'g2' &&
      Number(row.products) === PRODUCT_COUNT &&
      Number(row.media) === PRODUCT_COUNT * MEDIA_PER_PRODUCT
  };
}

let evidence;
try {
  const database = await createD1Database({ ...platformConfig(), databaseName });
  databaseId = database.databaseId;
  await setupSchema();
  const rollback = await proveRollback();
  const setBasedSeed = await seedSetBasedScenario();
  const setBased = await proveSetBasedPromotion();
  const generationSeed = await seedGenerationScenario();
  const generationFlip = await proveGenerationFlip();

  evidence = {
    m7d7D1ArchitectureProbePassed:
      rollback.failureObserved &&
      rollback.rolledBack &&
      setBased.complete &&
      setBased.concurrentReadStatesValid &&
      generationFlip.complete,
    productionCatalogMutation: false,
    recurringSyncEnabled: false,
    isolatedEphemeralD1: true,
    targetEnvelope: {
      products: PRODUCT_COUNT,
      mediaPerProduct: MEDIA_PER_PRODUCT
    },
    d1BatchRollback: rollback,
    setBasedSeed: { wallMs: setBasedSeed.wallMs, internalMs: setBasedSeed.internalMs },
    setBasedPromotion: setBased,
    generationSeed: { wallMs: generationSeed.wallMs, internalMs: generationSeed.internalMs },
    generationPointerFlip: generationFlip
  };
} finally {
  await deleteProbeDatabase();
}

evidence.cleanupSucceeded = cleanupSucceeded;
if (!evidence.m7d7D1ArchitectureProbePassed || !cleanupSucceeded) {
  console.log(JSON.stringify(evidence));
  throw new Error('m7d7_d1_architecture_probe_failed');
}

console.log(JSON.stringify(evidence));
