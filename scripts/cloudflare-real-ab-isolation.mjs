import { readFile, writeFile } from 'node:fs/promises';
import { appendFileSync, existsSync } from 'node:fs';
import {
  createD1Database,
  findD1DatabaseByName,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v3.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const STATE_PATH = process.env.ISOLATION_STATE_PATH || '/tmp/catalog-engine-isolation-state.json';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('cloudflare_account_id_missing');
if (API_TOKEN.length < 20) throw new Error('cloudflare_api_token_missing');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('dispatch_namespace_invalid');
}

function suffixForRun() {
  const raw = `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(-18);
}

function fixtureDefinitions() {
  const suffix = suffixForRun();
  return [
    {
      label: 'A',
      key: 'a',
      tenantId: 't_aaaaaaaaaaaaaaaaaaaa',
      productId: 'p_aaaaaaaaaaaaaaaaaaaa',
      mediaId: 'm_aaaaaaaaaaaaaaaaaaaa',
      categoryId: 'c_aaaaaaaaaaaaaaaaaaaa',
      databaseName: `ceiso-a-${suffix}`,
      scriptName: `ceiso-a-${suffix}`,
      displayName: 'Isolation Product A'
    },
    {
      label: 'B',
      key: 'b',
      tenantId: 't_bbbbbbbbbbbbbbbbbbbb',
      productId: 'p_bbbbbbbbbbbbbbbbbbbb',
      mediaId: 'm_bbbbbbbbbbbbbbbbbbbb',
      categoryId: 'c_bbbbbbbbbbbbbbbbbbbb',
      databaseName: `ceiso-b-${suffix}`,
      scriptName: `ceiso-b-${suffix}`,
      displayName: 'Isolation Product B'
    }
  ];
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

async function persist(state) {
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadState() {
  if (!existsSync(STATE_PATH)) {
    return {
      namespace: DISPATCH_NAMESPACE,
      fixtures: fixtureDefinitions()
    };
  }
  return JSON.parse(await readFile(STATE_PATH, 'utf8'));
}

async function cloudflareRequest(path, { method = 'GET', allowNotFound = false } = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      accept: 'application/json'
    }
  });
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = payload?.errors?.[0]?.code ?? response.status;
    throw new Error(`cloudflare_cleanup_${providerCode}`);
  }
  return payload.result ?? null;
}

function schemaAndSeedBatch(fixture) {
  const source = {
    provider: 'yupoo',
    sourceKey: `isolation_${fixture.key}`,
    sourceUrl: `https://example.invalid/${fixture.key}/albums/`,
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  };
  return [
    ...tenantDataPlaneCurrentBatch({ tenantId: fixture.tenantId, source }),
    {
      sql: `INSERT INTO catalog_categories
              (category_id, name, parent_id, depth, sort_order, product_count, updated_at)
            VALUES (?1, ?2, NULL, 0, 1, 1, CURRENT_TIMESTAMP)`,
      params: [fixture.categoryId, `Isolation Category ${fixture.label}`]
    },
    {
      sql: `INSERT INTO catalog_products
              (product_id, name, search_text, category_id, category_name, description,
               image_count, primary_media_id, sort_order, source_name, display_name,
               source_category_name, display_category_name, classification_status,
               classification_confidence, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, 1, ?2, ?2, ?5, ?5, 'classified', 1, CURRENT_TIMESTAMP)`,
      params: [
        fixture.productId,
        fixture.displayName,
        fixture.displayName.toLowerCase(),
        fixture.categoryId,
        `Isolation Category ${fixture.label}`,
        `Disposable Cloudflare isolation fixture ${fixture.label}`,
        fixture.mediaId
      ]
    },
    {
      sql: `INSERT INTO catalog_product_categories (product_id, category_id) VALUES (?1, ?2)`,
      params: [fixture.productId, fixture.categoryId]
    },
    {
      sql: `INSERT INTO media_sources
              (media_id, provider, source_url, display_source_url, thumbnail_source_url,
               referer_url, active, updated_at)
            VALUES (?1, 'yupoo', ?2, ?2, ?2, ?3, 1, CURRENT_TIMESTAMP)`,
      params: [
        fixture.mediaId,
        `https://example.invalid/${fixture.key}/fixture.jpg`,
        `https://example.invalid/${fixture.key}/`
      ]
    },
    {
      sql: `INSERT INTO product_media (product_id, media_id, position, updated_at)
            VALUES (?1, ?2, 0, CURRENT_TIMESTAMP)`,
      params: [fixture.productId, fixture.mediaId]
    },
    {
      sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
            VALUES ('store', ?1, CURRENT_TIMESTAMP)`,
      params: [JSON.stringify({ name: `Isolation Store ${fixture.label}` })]
    },
    {
      sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
            VALUES ('stats', ?1, CURRENT_TIMESTAMP)`,
      params: [JSON.stringify({ products: 1 })]
    }
  ];
}

async function setup() {
  const state = {
    runKey: suffixForRun(),
    namespace: DISPATCH_NAMESPACE,
    fixtures: fixtureDefinitions().map((fixture) => ({ ...fixture, databaseId: null, workerUploaded: false }))
  };
  await persist(state);

  for (const fixture of state.fixtures) {
    const created = await createD1Database({
      ...platformConfig(),
      databaseName: fixture.databaseName
    });
    fixture.databaseId = created.databaseId;
    await persist(state);

    await queryD1Batch({
      ...platformConfig(),
      databaseId: fixture.databaseId,
      batch: schemaAndSeedBatch(fixture)
    });

    await uploadTenantCatalogWorker({
      ...platformConfig(),
      scriptName: fixture.scriptName,
      databaseId: fixture.databaseId,
      tenantId: fixture.tenantId
    });
    fixture.workerUploaded = true;
    await persist(state);
  }

  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `CEISO_SCRIPT_A=${state.fixtures[0].scriptName}\n`);
    appendFileSync(process.env.GITHUB_ENV, `CEISO_SCRIPT_B=${state.fixtures[1].scriptName}\n`);
  }

  console.log(
    JSON.stringify({
      setup: true,
      namespace: state.namespace,
      fixtures: state.fixtures.map((fixture) => ({
        label: fixture.label,
        scriptName: fixture.scriptName,
        databaseCreated: Boolean(fixture.databaseId),
        workerUploaded: fixture.workerUploaded
      }))
    })
  );
}

async function requestThroughProbe(baseUrl, scriptName, pathname) {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set('__script', scriptName);
  const response = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json' }
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Some media/error paths are intentionally text responses.
  }
  return { status: response.status, json, text };
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function verify(baseUrl) {
  const state = await loadState();
  assert(state.fixtures?.length === 2, 'isolation_state_incomplete');
  const [a, b] = state.fixtures;

  const aHealth = await requestThroughProbe(baseUrl, a.scriptName, '/api/health');
  const bHealth = await requestThroughProbe(baseUrl, b.scriptName, '/api/health');
  assert(aHealth.status === 200 && aHealth.json?.ok === true, 'tenant_a_health_failed');
  assert(bHealth.status === 200 && bHealth.json?.ok === true, 'tenant_b_health_failed');

  const aOwn = await requestThroughProbe(baseUrl, a.scriptName, `/api/products/${a.productId}`);
  const aCross = await requestThroughProbe(baseUrl, a.scriptName, `/api/products/${b.productId}`);
  const bOwn = await requestThroughProbe(baseUrl, b.scriptName, `/api/products/${b.productId}`);
  const bCross = await requestThroughProbe(baseUrl, b.scriptName, `/api/products/${a.productId}`);

  assert(aOwn.status === 200 && aOwn.json?.product?.id === a.productId, 'tenant_a_own_product_missing');
  assert(bOwn.status === 200 && bOwn.json?.product?.id === b.productId, 'tenant_b_own_product_missing');
  assert(aOwn.json?.product?.media?.[0]?.id === a.mediaId, 'tenant_a_own_media_descriptor_missing');
  assert(bOwn.json?.product?.media?.[0]?.id === b.mediaId, 'tenant_b_own_media_descriptor_missing');
  assert(aCross.status === 404, 'tenant_a_can_read_tenant_b_product');
  assert(bCross.status === 404, 'tenant_b_can_read_tenant_a_product');

  const aCrossMedia = await requestThroughProbe(baseUrl, a.scriptName, `/media/${b.mediaId}/view`);
  const bCrossMedia = await requestThroughProbe(baseUrl, b.scriptName, `/media/${a.mediaId}/view`);
  assert(aCrossMedia.status === 404, 'tenant_a_can_read_tenant_b_media');
  assert(bCrossMedia.status === 404, 'tenant_b_can_read_tenant_a_media');

  console.log(
    JSON.stringify(
      {
        isolationPassed: true,
        namespace: state.namespace,
        tenantA: {
          ownProduct: aOwn.status,
          otherProduct: aCross.status,
          otherMedia: aCrossMedia.status
        },
        tenantB: {
          ownProduct: bOwn.status,
          otherProduct: bCross.status,
          otherMedia: bCrossMedia.status
        }
      },
      null,
      2
    )
  );
}

async function deleteWorker(scriptName) {
  if (!scriptName) return;
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${encodeURIComponent(DISPATCH_NAMESPACE)}/scripts/${encodeURIComponent(scriptName)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function deleteDatabase(fixture) {
  let databaseId = fixture.databaseId || null;
  if (!databaseId) {
    const found = await findD1DatabaseByName({
      ...platformConfig(),
      databaseName: fixture.databaseName
    }).catch(() => null);
    databaseId = found?.databaseId || null;
  }
  if (!databaseId) return;
  await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`, {
    method: 'DELETE',
    allowNotFound: true
  });
}

async function cleanup() {
  const state = await loadState();
  const failures = [];
  for (const fixture of state.fixtures || fixtureDefinitions()) {
    try {
      await deleteWorker(fixture.scriptName);
    } catch (error) {
      failures.push(`${fixture.label || fixture.key}:worker:${error.message}`);
    }
    try {
      await deleteDatabase(fixture);
    } catch (error) {
      failures.push(`${fixture.label || fixture.key}:d1:${error.message}`);
    }
  }
  console.log(JSON.stringify({ cleanupComplete: failures.length === 0, failures }));
  if (failures.length) process.exitCode = 1;
}

const [command, arg] = process.argv.slice(2);
if (command === 'setup') await setup();
else if (command === 'verify') await verify(arg || 'http://127.0.0.1:8787');
else if (command === 'cleanup') await cleanup();
else throw new Error('usage: cloudflare-real-ab-isolation.mjs <setup|verify|cleanup> [baseUrl]');
