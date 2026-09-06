import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const DEFAULT_MERCHANT = 'CROCCODILOS';
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const APP_ORIGIN = 'https://app.catalogoengine.com';
const DEFAULT_ORIGIN = 'https://catalogoengine.com';
const PREVIEW_TTL_MS = 10 * 60 * 1000;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function firstRow(result, index) {
  return result?.[index]?.results?.[0] || null;
}

async function loadRuntimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb9_control_database_missing');
  return {
    controlDatabaseId: String(database.database_id),
    recurringSyncEnabled: String(config.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') === '1'
  };
}

function platformConfig(accountId, apiToken, databaseId) {
  return {
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId
  };
}

async function readControlState({ accountId, apiToken, databaseId, merchant }) {
  const result = await queryD1Batch({
    ...platformConfig(accountId, apiToken, databaseId),
    batch: [
      {
        sql: `WITH target AS (
                SELECT tenant_id, display_name
                  FROM catalog_tenants
                 WHERE UPPER(display_name)=UPPER(?1)
                   AND status='active'
              )
              SELECT
                (SELECT COUNT(*) FROM target) AS tenant_count,
                t.tenant_id,
                t.display_name,
                m.principal_id,
                m.role,
                m.status AS membership_status,
                s.store_name,
                s.setup_status,
                p.d1_database_id,
                p.worker_status,
                p.runtime_kind,
                p.runtime_status,
                p.runtime_version,
                v.status AS verification_status,
                v.finding_count,
                v.classifier_version,
                CASE WHEN t.tenant_id=?2 THEN 1 ELSE 0 END AS is_default_tenant
              FROM target t
              JOIN tenant_memberships m
                ON m.tenant_id=t.tenant_id
               AND m.status='active'
               AND m.role='owner'
              JOIN account_principals ap ON ap.principal_id=m.principal_id
              JOIN tenant_store_profiles s ON s.tenant_id=t.tenant_id
              JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
              LEFT JOIN tenant_verification_jobs v ON v.job_id=(
                SELECT v2.job_id
                  FROM tenant_verification_jobs v2
                 WHERE v2.tenant_id=t.tenant_id
                 ORDER BY v2.created_at DESC, v2.job_id DESC
                 LIMIT 1
              )
              LIMIT 1`,
        params: [merchant, DEFAULT_TENANT_ID]
      },
      {
        sql: `SELECT product_id
                FROM catalog_products
               ORDER BY product_id ASC
               LIMIT 1`,
        params: []
      }
    ]
  });
  return {
    target: firstRow(result, 0),
    defaultProduct: firstRow(result, 1)
  };
}

async function readTenantCatalog({ accountId, apiToken, databaseId }) {
  const result = await queryD1Batch({
    ...platformConfig(accountId, apiToken, databaseId),
    batch: [
      {
        sql: `SELECT COUNT(*) AS product_count FROM catalog_products`,
        params: []
      },
      {
        sql: `SELECT p.product_id,
                    (SELECT pm.media_id
                       FROM product_media pm
                      WHERE pm.product_id=p.product_id
                      ORDER BY pm.position ASC
                      LIMIT 1) AS media_id
               FROM catalog_products p
              WHERE EXISTS (
                SELECT 1 FROM product_media pm2 WHERE pm2.product_id=p.product_id
              )
              ORDER BY p.product_id ASC
              LIMIT 1`,
        params: []
      }
    ]
  });
  return {
    productCount: integer(firstRow(result, 0)?.product_count),
    sample: firstRow(result, 1)
  };
}

function randomSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

async function insertProofSession({ accountId, apiToken, databaseId, hash, tenantId, principalId }) {
  const now = new Date();
  const expires = new Date(now.getTime() + PREVIEW_TTL_MS);
  await queryD1Batch({
    ...platformConfig(accountId, apiToken, databaseId),
    batch: [
      {
        sql: `INSERT INTO tenant_private_preview_sessions
                (session_hash,tenant_id,principal_id,created_at,expires_at)
              VALUES (?1,?2,?3,?4,?5)`,
        params: [hash, tenantId, principalId, now.toISOString(), expires.toISOString()]
      }
    ]
  });
}

async function deleteProofSessions({ accountId, apiToken, databaseId, hashes }) {
  const unique = [...new Set(hashes.filter((value) => /^[a-f0-9]{64}$/.test(String(value || ''))))];
  if (!unique.length) return;
  await queryD1Batch({
    ...platformConfig(accountId, apiToken, databaseId),
    batch: unique.map((hash) => ({
      sql: 'DELETE FROM tenant_private_preview_sessions WHERE session_hash=?1',
      params: [hash]
    }))
  });
}

function cookieHeader(token) {
  return `__Host-ce-preview=${token}`;
}

async function safeFetch(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'error',
    cache: 'no-store',
    ...options
  }).catch(() => null);
  if (!response) throw new Error('pb9_preview_unreachable');
  return response;
}

async function readJson(response) {
  return response.json().catch(() => null);
}

function assetUrls(html) {
  const matches = [];
  for (const match of String(html || '').matchAll(/(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/g)) {
    matches.push(match[1]);
  }
  return [...new Set(matches)].slice(0, 12);
}

function containsPrivateValue(text, privateValues) {
  const value = String(text || '');
  return privateValues.some((candidate) => candidate && value.includes(String(candidate)));
}

export function evaluatePb9PrivatePreview({
  target,
  tenantCatalog,
  shell,
  meta,
  products,
  productDetail,
  media,
  anonymousStatus,
  crossTenantStatus,
  defaultSentinelStatus,
  privateLeak,
  recurringSyncEnabled
}) {
  const checks = {
    uniqueMerchant: integer(target?.tenant_count) === 1,
    isolatedMerchant: integer(target?.is_default_tenant) === 0,
    activeOwner: target?.membership_status === 'active' && target?.role === 'owner',
    runtimeReady:
      target?.worker_status === 'active' &&
      target?.runtime_kind === 'catalog' &&
      target?.runtime_status === 'verified' &&
      integer(target?.runtime_version) >= 1,
    verificationReady:
      target?.verification_status === 'success' && integer(target?.finding_count) === 0,
    tenantCatalogPresent: integer(tenantCatalog?.productCount) > 0,
    shellPrivate:
      shell?.status === 200 &&
      shell?.cacheControl === 'private, no-store' &&
      /noindex/i.test(String(shell?.robots || '')),
    metaMatchesTenant:
      meta?.status === 200 && integer(meta?.body?.stats?.products) === integer(tenantCatalog?.productCount),
    productFeedWorks:
      products?.status === 200 &&
      Array.isArray(products?.body?.items) &&
      products.body.items.length > 0,
    ownProductWorks: productDetail?.status === 200,
    ownMediaWorks: media?.status === 200 && /^image\//i.test(String(media?.contentType || '')),
    anonymousFailsClosed: anonymousStatus === 404,
    crossTenantFailsClosed: crossTenantStatus === 404,
    defaultCannotReadMerchant: defaultSentinelStatus === 404,
    privateIdentifiersHidden: privateLeak === false,
    recurringSyncStillOff: recurringSyncEnabled === false
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    merchantCatalogProducts: integer(tenantCatalog?.productCount),
    previewProductsReturned: Array.isArray(products?.body?.items) ? products.body.items.length : 0
  };
}

export function safePb9Evidence(merchant, evaluation) {
  const output = {
    pb9ProductionProof: evaluation.passed ? 'passed' : 'failed',
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    checks: evaluation.checks,
    merchantCatalogProducts: evaluation.merchantCatalogProducts,
    previewProductsReturned: evaluation.previewProductsReturned,
    privateIdentifiersExposed: !evaluation.checks.privateIdentifiersHidden,
    recurringIntelligentSyncEnabled: !evaluation.checks.recurringSyncStillOff
  };
  const serialized = JSON.stringify(output);
  if (/t_[a-f0-9]{20}|prn_[a-f0-9]{20}|m_[a-f0-9]{20}|p_[a-f0-9]{20}|[a-f0-9]{8}-[a-f0-9-]{27,}|worker_script|yupoo\.com/i.test(serialized)) {
    throw new Error('pb9_safe_evidence_private_leak');
  }
  return output;
}

export async function runPb9PrivatePreviewProof() {
  const merchant = String(process.env.PB9_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const runtime = await loadRuntimeConfig();
  const control = await readControlState({
    accountId,
    apiToken,
    databaseId: runtime.controlDatabaseId,
    merchant
  });
  const target = control.target || {};
  if (integer(target.tenant_count) !== 1) throw new Error('pb9_merchant_not_unique');
  if (!/^t_[a-f0-9]{20}$/.test(String(target.tenant_id || ''))) throw new Error('pb9_tenant_missing');
  if (String(target.tenant_id) === DEFAULT_TENANT_ID) throw new Error('pb9_default_tenant_rejected');
  if (!/^prn_[a-f0-9]{20}$/.test(String(target.principal_id || ''))) throw new Error('pb9_owner_missing');
  if (!/^[a-f0-9-]{32,40}$/i.test(String(target.d1_database_id || ''))) throw new Error('pb9_tenant_database_missing');

  const tenantCatalog = await readTenantCatalog({
    accountId,
    apiToken,
    databaseId: String(target.d1_database_id)
  });
  const productId = String(tenantCatalog.sample?.product_id || '');
  const mediaId = String(tenantCatalog.sample?.media_id || '');
  const defaultProductId = String(control.defaultProduct?.product_id || '');
  if (!/^p_[a-f0-9]{20}$/.test(productId)) throw new Error('pb9_sample_product_missing');
  if (!/^m_[a-f0-9]{20}$/.test(mediaId)) throw new Error('pb9_sample_media_missing');
  if (!/^p_[a-f0-9]{20}$/.test(defaultProductId)) throw new Error('pb9_default_sentinel_missing');
  if (defaultProductId === productId) throw new Error('pb9_sentinel_collision');

  const ownSession = randomSession();
  const crossSession = randomSession();
  const cleanupHashes = [ownSession.hash, crossSession.hash];

  try {
    await insertProofSession({
      accountId,
      apiToken,
      databaseId: runtime.controlDatabaseId,
      hash: ownSession.hash,
      tenantId: String(target.tenant_id),
      principalId: String(target.principal_id)
    });
    await insertProofSession({
      accountId,
      apiToken,
      databaseId: runtime.controlDatabaseId,
      hash: crossSession.hash,
      tenantId: DEFAULT_TENANT_ID,
      principalId: String(target.principal_id)
    });

    const ownHeaders = { cookie: cookieHeader(ownSession.token) };
    const shellResponse = await safeFetch(`${APP_ORIGIN}/preview`, { headers: ownHeaders });
    const shellText = await shellResponse.text();
    const shell = {
      status: shellResponse.status,
      cacheControl: shellResponse.headers.get('cache-control'),
      robots: shellResponse.headers.get('x-robots-tag')
    };

    const [metaResponse, productsResponse, productResponse, mediaResponse, anonymousResponse, crossResponse, defaultResponse] = await Promise.all([
      safeFetch(`${APP_ORIGIN}/api/catalog/meta`, { headers: ownHeaders }),
      safeFetch(`${APP_ORIGIN}/api/products?page=1&limit=15`, { headers: ownHeaders }),
      safeFetch(`${APP_ORIGIN}/api/products/${encodeURIComponent(productId)}`, { headers: ownHeaders }),
      safeFetch(`${APP_ORIGIN}/media/${encodeURIComponent(mediaId)}/thumb`, { headers: ownHeaders }),
      safeFetch(`${APP_ORIGIN}/preview`),
      safeFetch(`${APP_ORIGIN}/api/catalog/meta`, { headers: { cookie: cookieHeader(crossSession.token) } }),
      safeFetch(`${DEFAULT_ORIGIN}/api/products/${encodeURIComponent(productId)}`)
    ]);

    const metaBody = await readJson(metaResponse);
    const productsBody = await readJson(productsResponse);
    const productBody = await readJson(productResponse);

    const jsBodies = [];
    for (const asset of assetUrls(shellText)) {
      const assetUrl = new URL(asset, APP_ORIGIN).href;
      const response = await safeFetch(assetUrl);
      if (response.ok) jsBodies.push(await response.text());
    }

    const privateValues = [
      target.tenant_id,
      target.principal_id,
      target.d1_database_id,
      target.worker_script_name,
      productId,
      mediaId
    ].filter(Boolean);
    // Product/media opaque public IDs legitimately appear in the preview payload. They are removed
    // from the private-locator leak set; tenant/principal/D1/Worker/provider identifiers may not.
    const privateLocators = privateValues.filter((value) => value !== productId && value !== mediaId);
    const publicPayload = `${shellText}\n${JSON.stringify(metaBody)}\n${JSON.stringify(productsBody)}\n${JSON.stringify(productBody)}\n${jsBodies.join('\n')}`;
    const privateLeak =
      containsPrivateValue(publicPayload, privateLocators) ||
      /https?:\/\/[^\s"']*yupoo\.com|source_url|d1_database_id|worker_script_name/i.test(publicPayload);

    const evaluation = evaluatePb9PrivatePreview({
      target,
      tenantCatalog,
      shell,
      meta: { status: metaResponse.status, body: metaBody },
      products: { status: productsResponse.status, body: productsBody },
      productDetail: { status: productResponse.status },
      media: { status: mediaResponse.status, contentType: mediaResponse.headers.get('content-type') },
      anonymousStatus: anonymousResponse.status,
      crossTenantStatus: crossResponse.status,
      defaultSentinelStatus: defaultResponse.status,
      privateLeak,
      recurringSyncEnabled: runtime.recurringSyncEnabled
    });
    const evidence = safePb9Evidence(merchant, evaluation);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (!evaluation.passed) throw new Error('pb9_production_proof_failed');
    return evidence;
  } finally {
    await deleteProofSessions({
      accountId,
      apiToken,
      databaseId: runtime.controlDatabaseId,
      hashes: cleanupHashes
    }).catch(() => {});
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb9PrivatePreviewProof().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
