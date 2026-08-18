import {
  CloudflareSaasError,
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostname,
  getCloudflareCustomHostname,
  restartCloudflareHttpDcv
} from './cloudflare-saas.js';
import { readTenantDomain } from './admin-domain.js';
import { stableOpaqueId } from './runtime-identity.js';
import { maybeAdvanceTenantToPublish } from './tenant-publish-gate.js';

function runtimeConfig(env) {
  const zoneId = String(env.CLOUDFLARE_SAAS_ZONE_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_SAAS_API_TOKEN || '').trim();
  const cnameTarget = String(env.CLOUDFLARE_SAAS_CNAME_TARGET || '').trim();
  if (!zoneId || !apiToken || !cnameTarget) return null;
  return { zoneId, apiToken, cnameTarget };
}

async function domainRecord(db, tenantId, domainId) {
  return db
    .prepare(
      `SELECT d.domain_id, d.tenant_id, d.hostname, d.status AS domain_status,
              s.provider_hostname_id, s.provider_status, s.ssl_status
         FROM tenant_domains d
         LEFT JOIN tenant_domain_provider_state s ON s.domain_id=d.domain_id
        WHERE d.domain_id=?1 AND d.tenant_id=?2 AND d.domain_type='custom'
        LIMIT 1`
    )
    .bind(domainId, tenantId)
    .first();
}

async function jobIdFor(domainId, operation) {
  return stableOpaqueId('djob', `${domainId}:${operation}`);
}

async function ensureJob(db, tenantId, domainId, operation) {
  const jobId = await jobIdFor(domainId, operation);
  await db
    .prepare(
      `INSERT INTO tenant_domain_jobs
        (job_id, tenant_id, domain_id, operation, status, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(job_id) DO NOTHING`
    )
    .bind(jobId, tenantId, domainId, operation)
    .run();
  return jobId;
}

async function claimJob(db, jobId) {
  const result = await db
    .prepare(
      `UPDATE tenant_domain_jobs
          SET status='running',
              attempt_count=attempt_count+1,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
              finished_at=NULL,
              last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status IN ('pending','failed','success')`
    )
    .bind(jobId)
    .run();
  return Number(result.meta?.changes || 0) > 0;
}

async function finishJob(db, jobId) {
  await db
    .prepare(
      `UPDATE tenant_domain_jobs
          SET status='success', finished_at=CURRENT_TIMESTAMP, next_attempt_at=NULL,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1`
    )
    .bind(jobId)
    .run();
}

async function failJob(db, jobId, domainId, safeCode) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_domain_jobs
            SET status='failed', finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+5 minutes'),
                last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(jobId, safeCode),
    db
      .prepare(
        `UPDATE tenant_domain_provider_state
            SET last_error_code=?2, last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE domain_id=?1`
      )
      .bind(domainId, safeCode),
    db
      .prepare(
        `UPDATE tenant_domains
            SET status=CASE WHEN status='active' THEN 'active' ELSE 'error' END,
                last_error=?2, updated_at=CURRENT_TIMESTAMP
          WHERE domain_id=?1`
      )
      .bind(domainId, safeCode)
  ]);
}

async function persistProviderState(db, record, state) {
  const nextDomainStatus = state.ready ? 'active' : 'verifying';
  await db.batch([
    db
      .prepare(
        `INSERT INTO tenant_domain_provider_state
          (domain_id, tenant_id, provider, provider_hostname_id, provider_status, ssl_status,
           cname_target, ownership_txt_name, ownership_txt_value, ssl_txt_name, ssl_txt_value,
           ssl_http_url, ssl_http_body, last_checked_at, last_error_code, created_at, updated_at)
         VALUES (?1, ?2, 'cloudflare', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                 CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(domain_id) DO UPDATE SET
           provider='cloudflare',
           provider_hostname_id=excluded.provider_hostname_id,
           provider_status=excluded.provider_status,
           ssl_status=excluded.ssl_status,
           cname_target=excluded.cname_target,
           ownership_txt_name=excluded.ownership_txt_name,
           ownership_txt_value=excluded.ownership_txt_value,
           ssl_txt_name=excluded.ssl_txt_name,
           ssl_txt_value=excluded.ssl_txt_value,
           ssl_http_url=excluded.ssl_http_url,
           ssl_http_body=excluded.ssl_http_body,
           last_checked_at=CURRENT_TIMESTAMP,
           last_error_code=NULL,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        record.domain_id,
        record.tenant_id,
        state.providerHostnameId,
        state.providerStatus,
        state.sslStatus,
        state.cnameTarget,
        state.ownershipTxtName,
        state.ownershipTxtValue,
        state.sslTxtName,
        state.sslTxtValue,
        state.sslHttpUrl,
        state.sslHttpBody
      ),
    db
      .prepare(
        `UPDATE tenant_domains
            SET status=?2, last_error=NULL, verified_at=CASE WHEN ?2='active' THEN CURRENT_TIMESTAMP ELSE verified_at END,
                updated_at=CURRENT_TIMESTAMP
          WHERE domain_id=?1 AND tenant_id=?3`
      )
      .bind(record.domain_id, nextDomainStatus, record.tenant_id)
  ]);

  if (state.ready) await markDomainProvisioningReady(db, record.tenant_id);
}

async function markDomainProvisioningReady(db, tenantId) {
  // Domain success alone is not enough anymore. Runtime dispatch smoke must also be
  // verified before the provisioning run may cross the publish checkpoint.
  await maybeAdvanceTenantToPublish(db, tenantId);
}

async function clearDeletedProviderState(db, record) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_domain_provider_state
            SET provider_hostname_id=NULL, provider_status='deleted', ssl_status='deleted',
                cname_target=NULL, ownership_txt_name=NULL, ownership_txt_value=NULL,
                ssl_txt_name=NULL, ssl_txt_value=NULL, ssl_http_url=NULL, ssl_http_body=NULL,
                last_checked_at=CURRENT_TIMESTAMP, last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE domain_id=?1 AND tenant_id=?2`
      )
      .bind(record.domain_id, record.tenant_id),
    db
      .prepare(
        `UPDATE tenant_domains
            SET status='disabled', last_error=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE domain_id=?1 AND tenant_id=?2`
      )
      .bind(record.domain_id, record.tenant_id)
  ]);
}

export function cloudflareSaasConfigured(env) {
  return Boolean(runtimeConfig(env));
}

export async function processTenantDomainProvider(
  db,
  { tenantId, domainId, operation, env },
  { fetchImpl = fetch } = {}
) {
  const config = runtimeConfig(env);
  if (!config) return { outcome: 'queued', reason: 'cloudflare_saas_unconfigured' };

  const record = await domainRecord(db, tenantId, domainId);
  if (!record) return { outcome: 'skipped', reason: 'domain_not_found' };
  const jobId = await ensureJob(db, tenantId, domainId, operation);
  const claimed = await claimJob(db, jobId);
  if (!claimed) return { outcome: 'busy', jobId };

  try {
    if (operation === 'delete') {
      if (record.provider_hostname_id) {
        await deleteCloudflareCustomHostname(
          {
            zoneId: config.zoneId,
            apiToken: config.apiToken,
            providerHostnameId: record.provider_hostname_id
          },
          { fetchImpl }
        );
      }
      await clearDeletedProviderState(db, record);
      await finishJob(db, jobId);
      return { outcome: 'success', jobId, domain: null };
    }

    let state;
    if (!record.provider_hostname_id) {
      state = await createCloudflareCustomHostname(
        {
          zoneId: config.zoneId,
          apiToken: config.apiToken,
          hostname: record.hostname,
          cnameTarget: config.cnameTarget
        },
        { fetchImpl }
      );
    } else if (operation === 'refresh' && record.ssl_status !== 'active') {
      state = await restartCloudflareHttpDcv(
        {
          zoneId: config.zoneId,
          apiToken: config.apiToken,
          providerHostnameId: record.provider_hostname_id,
          cnameTarget: config.cnameTarget
        },
        { fetchImpl }
      );
    } else {
      state = await getCloudflareCustomHostname(
        {
          zoneId: config.zoneId,
          apiToken: config.apiToken,
          providerHostnameId: record.provider_hostname_id,
          cnameTarget: config.cnameTarget
        },
        { fetchImpl }
      );
    }

    if (state.hostname !== record.hostname) {
      throw new CloudflareSaasError('cloudflare_saas_hostname_mismatch', 502);
    }
    await persistProviderState(db, record, state);
    await finishJob(db, jobId);
    return {
      outcome: 'success',
      jobId,
      ready: state.ready,
      domain: await readTenantDomain(db, tenantId)
    };
  } catch (error) {
    const safeCode =
      error instanceof CloudflareSaasError ? error.code : 'cloudflare_saas_operation_failed';
    await failJob(db, jobId, domainId, safeCode);
    return {
      outcome: 'failed',
      jobId,
      error: safeCode,
      domain: await readTenantDomain(db, tenantId)
    };
  }
}
