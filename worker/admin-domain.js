import { buildTenantDomainAttachPlan, publicTenantDomainState } from './custom-domain.js';
import { stableOpaqueId } from './runtime-identity.js';

function appError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

async function activeDomainRow(db, tenantId) {
  return db
    .prepare(
      `SELECT d.domain_id, d.tenant_id, d.hostname, d.status AS domain_status,
              s.provider, s.provider_hostname_id, s.provider_status, s.ssl_status,
              s.cname_target, s.ownership_txt_name, s.ownership_txt_value,
              s.ssl_txt_name, s.ssl_txt_value, s.ssl_http_url, s.ssl_http_body,
              s.last_checked_at, s.last_error_code
         FROM tenant_domains d
         LEFT JOIN tenant_domain_provider_state s ON s.domain_id=d.domain_id
        WHERE d.tenant_id=?1 AND d.domain_type='custom' AND d.status!='disabled'
        ORDER BY CASE d.status WHEN 'active' THEN 0 WHEN 'verifying' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
                 d.updated_at DESC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

async function domainOwner(db, hostname) {
  return db
    .prepare(
      `SELECT domain_id, tenant_id, status
         FROM tenant_domains
        WHERE hostname=?1
        LIMIT 1`
    )
    .bind(hostname)
    .first();
}

async function latestProvisioningRun(db, tenantId) {
  return db
    .prepare(
      `SELECT provisioning_id, status, current_step
         FROM tenant_provisioning_runs
        WHERE tenant_id=?1
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

async function enqueueDomainJob(db, { tenantId, domainId, operation }) {
  const jobId = await stableOpaqueId('djob', `${domainId}:${operation}`);
  await db
    .prepare(
      `INSERT INTO tenant_domain_jobs
        (job_id, tenant_id, domain_id, operation, status, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(job_id) DO UPDATE SET
         status=CASE WHEN tenant_domain_jobs.status='running' THEN 'running' ELSE 'pending' END,
         attempt_count=CASE WHEN tenant_domain_jobs.status='running' THEN tenant_domain_jobs.attempt_count ELSE 0 END,
         next_attempt_at=CASE WHEN tenant_domain_jobs.status='running' THEN tenant_domain_jobs.next_attempt_at ELSE CURRENT_TIMESTAMP END,
         finished_at=CASE WHEN tenant_domain_jobs.status='running' THEN tenant_domain_jobs.finished_at ELSE NULL END,
         last_error_code=CASE WHEN tenant_domain_jobs.status='running' THEN tenant_domain_jobs.last_error_code ELSE NULL END,
         updated_at=CURRENT_TIMESTAMP`
    )
    .bind(jobId, tenantId, domainId, operation)
    .run();
  return jobId;
}

async function resetProvisioningDomainCheckpoint(db, tenantId) {
  const run = await latestProvisioningRun(db, tenantId);
  if (!run?.provisioning_id) return;
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_provisioning_steps
            SET status=CASE WHEN status IN ('success','failed','blocked','skipped') THEN 'pending' ELSE status END,
                finished_at=NULL,
                last_error=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND step_key='domain'`
      )
      .bind(run.provisioning_id),
    db
      .prepare(
        `UPDATE tenant_provisioning_runs
            SET status=CASE WHEN current_step IN ('domain','publish','complete') THEN 'running' ELSE status END,
                current_step=CASE WHEN current_step IN ('domain','publish','complete') THEN 'domain' ELSE current_step END,
                finished_at=CASE WHEN current_step IN ('domain','publish','complete') THEN NULL ELSE finished_at END,
                last_error=CASE WHEN current_step IN ('domain','publish','complete') THEN NULL ELSE last_error END,
                updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND tenant_id=?2`
      )
      .bind(run.provisioning_id, tenantId)
  ]);
}

export async function readTenantDomain(db, tenantId) {
  const row = await activeDomainRow(db, tenantId);
  return row ? publicTenantDomainState(row) : null;
}

export async function attachTenantDomain(db, { tenantId, principalId, hostname }) {
  const plan = await buildTenantDomainAttachPlan({ tenantId, hostname });
  const current = await activeDomainRow(db, tenantId);
  const owner = await domainOwner(db, plan.domain.hostname);

  if (owner && owner.tenant_id !== tenantId) throw appError('domain_unavailable', 409);
  if (owner && owner.tenant_id === tenantId && owner.status !== 'disabled' && owner.domain_id !== plan.domain.domainId) {
    throw appError('domain_unavailable', 409);
  }

  if (current && current.domain_id !== plan.domain.domainId) {
    const providerAllocated = Boolean(current.provider_hostname_id);
    if (providerAllocated || ['active', 'verifying'].includes(current.domain_status)) {
      throw appError('domain_change_requires_disconnect', 409);
    }
    await db.batch([
      db
        .prepare(
          `UPDATE tenant_domains SET status='disabled', updated_at=CURRENT_TIMESTAMP WHERE domain_id=?1 AND tenant_id=?2`
        )
        .bind(current.domain_id, tenantId),
      db
        .prepare(
          `UPDATE tenant_domain_jobs
              SET status='cancelled', finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE domain_id=?1 AND status='pending'`
        )
        .bind(current.domain_id)
    ]);
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO tenant_domains
          (domain_id, tenant_id, hostname, domain_type, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'custom', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(domain_id) DO UPDATE SET
           status=CASE WHEN tenant_domains.status='active' THEN 'active' ELSE 'pending' END,
           last_error=NULL,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(plan.domain.domainId, tenantId, plan.domain.hostname),
    db
      .prepare(
        `INSERT INTO tenant_domain_provider_state
          (domain_id, tenant_id, provider, provider_status, ssl_status, created_at, updated_at)
         VALUES (?1, ?2, 'cloudflare', 'pending', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(domain_id) DO UPDATE SET
           last_error_code=NULL,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(plan.domain.domainId, tenantId),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, ?2, 'tenant.domain.attached', 'domain', ?3, ?4, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM tenant_audit_log
             WHERE tenant_id=?1 AND principal_id=?2 AND action='tenant.domain.attached' AND target_id=?3 AND metadata_json=?4
          )`
      )
      .bind(
        tenantId,
        principalId,
        plan.domain.domainId,
        JSON.stringify({ hostname: plan.domain.hostname, domainType: 'custom' })
      )
  ];
  await db.batch(statements);
  await enqueueDomainJob(db, {
    tenantId,
    domainId: plan.domain.domainId,
    operation: 'provision'
  });
  await resetProvisioningDomainCheckpoint(db, tenantId);
  return readTenantDomain(db, tenantId);
}

export async function requestTenantDomainRefresh(db, { tenantId, principalId }) {
  const current = await activeDomainRow(db, tenantId);
  if (!current) throw appError('domain_not_connected', 409);
  const operation = current.provider_hostname_id ? 'refresh' : 'provision';
  await enqueueDomainJob(db, { tenantId, domainId: current.domain_id, operation });
  await db
    .prepare(
      `INSERT INTO tenant_audit_log
        (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?1, ?2, 'tenant.domain.refresh_requested', 'domain', ?3, ?4, CURRENT_TIMESTAMP)`
    )
    .bind(tenantId, principalId, current.domain_id, JSON.stringify({ operation }))
    .run();
  return readTenantDomain(db, tenantId);
}

export async function disconnectTenantDomain(db, { tenantId, principalId }) {
  const current = await activeDomainRow(db, tenantId);
  if (!current) return null;
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_domains
            SET status='disabled', last_error=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE domain_id=?1 AND tenant_id=?2`
      )
      .bind(current.domain_id, tenantId),
    db
      .prepare(
        `UPDATE tenant_domain_jobs
            SET status='cancelled', finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE domain_id=?1 AND status='pending'`
      )
      .bind(current.domain_id),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         VALUES (?1, ?2, 'tenant.domain.disconnect_requested', 'domain', ?3, '{}', CURRENT_TIMESTAMP)`
      )
      .bind(tenantId, principalId, current.domain_id)
  ]);
  if (current.provider_hostname_id) {
    await enqueueDomainJob(db, { tenantId, domainId: current.domain_id, operation: 'delete' });
  }
  await resetProvisioningDomainCheckpoint(db, tenantId);
  return null;
}
