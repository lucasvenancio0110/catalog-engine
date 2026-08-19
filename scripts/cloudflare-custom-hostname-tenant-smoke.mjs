import { readFile } from 'node:fs/promises';
import {
  createD1Database,
  findD1DatabaseByName,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v3.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const TEST_HOSTNAME = String(
  process.env.CATALOG_ENGINE_TEST_HOSTNAME || 'teste.loja.catalogoengine.com'
)
  .trim()
  .toLowerCase();
const DEFAULT_URL = String(
  process.env.CATALOG_ENGINE_DEFAULT_URL || 'https://catalog-engine.lucassantanals0110.workers.dev'
).trim();

const TENANT_ID = 't_cccccccccccccccccccc';
const DOMAIN_ID = 'dom_cccccccccccccccccccc';
const PRODUCT_ID = 'p_cccccccccccccccccccc';
const CATEGORY_ID = 'c_cccccccccccccccccccc';
const DATABASE_NAME = 'ce-custom-host-smoke';
const SCRIPT_NAME = 'ce-custom-host-smoke';
const STORE_NAME = 'Loja Teste Isolada';

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('cloudflare_account_id_missing');
if (API_TOKEN.length < 20) throw new Error('cloudflare_api_token_missing');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('dispatch_namespace_invalid');
}
if (!/^[a-z0-9.-]+$/.test(TEST_HOSTNAME)) throw new Error('test_hostname_invalid');

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

async function controlDatabaseId() {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const binding = config.d1_databases?.find((item) => item?.binding === 'CATALOG_DB');
  const databaseId = String(binding?.database_id || '').trim();
  if (!/^[a-f0-9-]{32,40}$/i.test(databaseId)) throw new Error('control_database_id_missing');
  return databaseId;
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
    const code = payload?.errors?.[0]?.code ?? response.status;
    throw new Error(`cloudflare_request_${code}`);
  }
  return payload.result ?? null;
}

async function deleteWorkerIfPresent() {
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${encodeURIComponent(DISPATCH_NAMESPACE)}/scripts/${encodeURIComponent(SCRIPT_NAME)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function deleteDatabaseIfPresent() {
  const existing = await findD1DatabaseByName({
    ...platformConfig(),
    databaseName: DATABASE_NAME
  });
  if (!existing?.databaseId) return;
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(existing.databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

function tenantSeedBatch() {
  const source = {
    provider: 'yupoo',
    sourceKey: 'custom_hostname_smoke',
    sourceUrl: 'https://example.invalid/custom-hostname-smoke/albums/',
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  };

  return [
    ...tenantDataPlaneCurrentBatch({ tenantId: TENANT_ID, source }),
    {
      sql: `INSERT INTO catalog_categories
              (category_id, name, parent_id, depth, sort_order, product_count, updated_at)
            VALUES (?1, 'Teste de Isolamento', NULL, 0, 1, 1, CURRENT_TIMESTAMP)`,
      params: [CATEGORY_ID]
    },
    {
      sql: `INSERT INTO catalog_products
              (product_id, name, search_text, category_id, category_name, description,
               image_count, primary_media_id, sort_order, source_name, display_name,
               source_category_name, display_category_name, classification_status,
               classification_confidence, updated_at)
            VALUES (?1, ?2, ?3, ?4, 'Teste de Isolamento', ?5,
                    0, NULL, 1, ?2, ?2, 'Teste de Isolamento', 'Teste de Isolamento',
                    'classified', 1, CURRENT_TIMESTAMP)`,
      params: [
        PRODUCT_ID,
        'Produto Exclusivo da Loja Teste',
        'produto exclusivo loja teste isolada',
        CATEGORY_ID,
        'Se este produto aparece aqui, o domínio está lendo apenas o D1 deste tenant.'
      ]
    },
    {
      sql: 'INSERT INTO catalog_product_categories (product_id, category_id) VALUES (?1, ?2)',
      params: [PRODUCT_ID, CATEGORY_ID]
    },
    {
      sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
            VALUES ('store', ?1, CURRENT_TIMESTAMP)`,
      params: [JSON.stringify({ name: STORE_NAME })]
    },
    {
      sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
            VALUES ('stats', ?1, CURRENT_TIMESTAMP)`,
      params: [JSON.stringify({ products: 1, photos: 0 })]
    },
    {
      sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
            VALUES ('navigation', '[]', CURRENT_TIMESTAMP)`
    }
  ];
}

async function attachControlPlane({ databaseId }) {
  const controlDb = await controlDatabaseId();
  await queryD1Batch({
    ...platformConfig(),
    databaseId: controlDb,
    batch: [
      {
        sql: 'DELETE FROM tenant_domains WHERE hostname=?1 OR tenant_id=?2',
        params: [TEST_HOSTNAME, TENANT_ID]
      },
      {
        sql: 'DELETE FROM tenant_data_plane_provider_state WHERE tenant_id=?1',
        params: [TENANT_ID]
      },
      {
        sql: 'DELETE FROM tenant_catalog_instances WHERE tenant_id=?1',
        params: [TENANT_ID]
      },
      {
        sql: 'DELETE FROM tenant_store_profiles WHERE tenant_id=?1',
        params: [TENANT_ID]
      },
      {
        sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1',
        params: [TENANT_ID]
      },
      {
        sql: `INSERT INTO catalog_tenants
                (tenant_id, slug, display_name, status, created_at, updated_at)
              VALUES (?1, 'teste-isolado', ?2, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        params: [TENANT_ID, STORE_NAME]
      },
      {
        sql: `INSERT INTO tenant_store_profiles
                (tenant_id, store_name, currency, theme_key, setup_status, published_at, created_at, updated_at)
              VALUES (?1, ?2, 'BRL', 'premium-dark', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        params: [TENANT_ID, STORE_NAME]
      },
      {
        sql: `INSERT INTO tenant_catalog_instances
                (tenant_id, data_plane_key, status, schema_version, last_migration_at, created_at, updated_at)
              VALUES (?1, ?2, 'ready', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        params: [TENANT_ID, DATABASE_NAME]
      },
      {
        sql: `INSERT INTO tenant_domains
                (domain_id, tenant_id, hostname, domain_type, status, verified_at, created_at, updated_at)
              VALUES (?1, ?2, ?3, 'custom', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        params: [DOMAIN_ID, TENANT_ID, TEST_HOSTNAME]
      },
      {
        sql: `INSERT INTO tenant_data_plane_provider_state
                (tenant_id, provider, dispatch_namespace, worker_script_name, d1_database_name,
                 d1_database_id, worker_status, database_status, worker_version,
                 last_checked_at, runtime_kind, runtime_status, runtime_version,
                 runtime_verified_at, created_at, updated_at)
              VALUES (?1, 'cloudflare_wfp', ?2, ?3, ?4, ?5,
                      'active', 'active', 'smoke-v1', CURRENT_TIMESTAMP,
                      'catalog', 'verified', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        params: [TENANT_ID, DISPATCH_NAMESPACE, SCRIPT_NAME, DATABASE_NAME, databaseId]
      }
    ]
  });
}

async function setup() {
  await deleteWorkerIfPresent();
  await deleteDatabaseIfPresent();

  const database = await createD1Database({
    ...platformConfig(),
    databaseName: DATABASE_NAME
  });

  await queryD1Batch({
    ...platformConfig(),
    databaseId: database.databaseId,
    batch: tenantSeedBatch()
  });

  await uploadTenantCatalogWorker({
    ...platformConfig(),
    scriptName: SCRIPT_NAME,
    databaseId: database.databaseId,
    tenantId: TENANT_ID
  });

  await attachControlPlane({ databaseId: database.databaseId });

  console.log(
    JSON.stringify({
      setup: true,
      hostname: TEST_HOSTNAME,
      tenantId: TENANT_ID,
      databaseName: DATABASE_NAME,
      scriptName: SCRIPT_NAME,
      storeName: STORE_NAME
    })
  );
}

async function readJson(url) {
  const response = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json' }
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Assertions below report the meaningful failure.
  }
  return { response, json, text };
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function verify() {
  const customBase = `https://${TEST_HOSTNAME}`;
  const [customMeta, customProducts, customProduct, defaultMeta, defaultProducts] = await Promise.all([
    readJson(`${customBase}/api/catalog/meta`),
    readJson(`${customBase}/api/products?page=1&limit=15`),
    readJson(`${customBase}/api/products/${PRODUCT_ID}`),
    readJson(`${DEFAULT_URL}/api/catalog/meta`),
    readJson(`${DEFAULT_URL}/api/products?page=1&limit=1`)
  ]);

  assert(customMeta.response.status === 200, 'custom_meta_http_failed');
  assert(customMeta.json?.store?.name === STORE_NAME, 'custom_meta_wrong_store');
  assert(Number(customMeta.json?.stats?.products) === 1, 'custom_meta_wrong_product_count');
  assert(customProducts.response.status === 200, 'custom_products_http_failed');
  assert(customProducts.json?.total === 1, 'custom_products_wrong_total');
  assert(customProducts.json?.items?.[0]?.id === PRODUCT_ID, 'custom_product_not_isolated_fixture');
  assert(customProduct.response.status === 200, 'custom_product_detail_failed');
  assert(customProduct.json?.product?.id === PRODUCT_ID, 'custom_product_detail_wrong');

  const defaultCount = Number(defaultMeta.json?.stats?.products || 0);
  const defaultProductId = defaultProducts.json?.items?.[0]?.id || null;
  assert(defaultMeta.response.status === 200 && defaultCount > 1000, 'default_catalog_damaged');
  assert(defaultProductId && defaultProductId !== PRODUCT_ID, 'default_sample_invalid');

  const [customReadsDefault, defaultReadsCustom, storefrontHtml] = await Promise.all([
    readJson(`${customBase}/api/products/${encodeURIComponent(defaultProductId)}`),
    readJson(`${DEFAULT_URL}/api/products/${PRODUCT_ID}`),
    fetch(`${customBase}/`, { redirect: 'error' })
  ]);

  assert(customReadsDefault.response.status === 404, 'custom_tenant_can_read_default_product');
  assert(defaultReadsCustom.response.status === 404, 'default_catalog_can_read_custom_product');
  assert(storefrontHtml.status === 200, 'custom_storefront_html_failed');
  assert(
    String(storefrontHtml.headers.get('content-type') || '').includes('text/html'),
    'custom_storefront_not_html'
  );

  console.log(
    JSON.stringify(
      {
        customHostnameTenantPassed: true,
        hostname: TEST_HOSTNAME,
        tenant: {
          storeName: customMeta.json.store.name,
          products: customProducts.json.total,
          sampleProductId: customProducts.json.items[0].id,
          cannotReadDefaultProduct: customReadsDefault.response.status
        },
        defaultCatalog: {
          products: defaultCount,
          cannotReadTenantProduct: defaultReadsCustom.response.status
        },
        storefrontHtml: storefrontHtml.status
      },
      null,
      2
    )
  );
}

async function cleanup() {
  const controlDb = await controlDatabaseId();
  await queryD1Batch({
    ...platformConfig(),
    databaseId: controlDb,
    batch: [
      { sql: 'DELETE FROM tenant_domains WHERE tenant_id=?1', params: [TENANT_ID] },
      { sql: 'DELETE FROM tenant_data_plane_provider_state WHERE tenant_id=?1', params: [TENANT_ID] },
      { sql: 'DELETE FROM tenant_catalog_instances WHERE tenant_id=?1', params: [TENANT_ID] },
      { sql: 'DELETE FROM tenant_store_profiles WHERE tenant_id=?1', params: [TENANT_ID] },
      { sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1', params: [TENANT_ID] }
    ]
  });
  await deleteWorkerIfPresent();
  await deleteDatabaseIfPresent();
  console.log(JSON.stringify({ cleanup: true, hostname: TEST_HOSTNAME }));
}

const [command] = process.argv.slice(2);
if (command === 'setup') await setup();
else if (command === 'verify') await verify();
else if (command === 'cleanup') await cleanup();
else throw new Error('usage: cloudflare-custom-hostname-tenant-smoke.mjs <setup|verify|cleanup>');
