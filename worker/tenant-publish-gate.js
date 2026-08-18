export async function tenantPublishPrerequisites(db, tenantId) {
  const row = await db
    .prepare(
      `SELECT r.provisioning_id, r.current_step,
              p.runtime_kind, p.runtime_status, p.runtime_version,
              d.domain_id, d.status AS domain_status,
              ds.provider_status, ds.ssl_status
         FROM tenant_provisioning_runs r
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         LEFT JOIN tenant_domains d ON d.domain_id=(
           SELECT d2.domain_id
             FROM tenant_domains d2
            WHERE d2.tenant_id=r.tenant_id
              AND d2.domain_type='custom'
              AND d2.status!='disabled'
            ORDER BY CASE d2.status WHEN 'active' THEN 0 WHEN 'verifying' THEN 1 ELSE 2 END,
                     d2.updated_at DESC
            LIMIT 1
         )
         LEFT JOIN tenant_domain_provider_state ds ON ds.domain_id=d.domain_id
        WHERE r.provisioning_id=(
          SELECT r2.provisioning_id
            FROM tenant_provisioning_runs r2
           WHERE r2.tenant_id=?1
           ORDER BY r2.created_at DESC
           LIMIT 1
        )
        LIMIT 1`
    )
    .bind(tenantId)
    .first();

  if (!row?.provisioning_id) {
    return { ready: false, reason: 'provisioning_not_found', provisioningId: null };
  }
  if (row.current_step !== 'domain') {
    return {
      ready: row.current_step === 'publish',
      reason: row.current_step === 'publish' ? 'already_ready' : 'checkpoint_mismatch',
      provisioningId: row.provisioning_id,
      domainId: row.domain_id || null
    };
  }
  if (
    row.runtime_kind !== 'catalog' ||
    row.runtime_status !== 'verified' ||
    Number(row.runtime_version || 0) < 1
  ) {
    return {
      ready: false,
      reason: 'tenant_runtime_not_verified',
      provisioningId: row.provisioning_id,
      domainId: row.domain_id || null
    };
  }
  if (!row.domain_id) {
    return {
      ready: false,
      reason: 'tenant_domain_required',
      provisioningId: row.provisioning_id,
      domainId: null
    };
  }
  if (
    row.domain_status !== 'active' ||
    row.provider_status !== 'active' ||
    row.ssl_status !== 'active'
  ) {
    return {
      ready: false,
      reason: 'tenant_domain_not_verified',
      provisioningId: row.provisioning_id,
      domainId: row.domain_id
    };
  }
  return {
    ready: true,
    reason: 'ready',
    provisioningId: row.provisioning_id,
    domainId: row.domain_id
  };
}

export async function maybeAdvanceTenantToPublish(db, tenantId) {
  const prerequisites = await tenantPublishPrerequisites(db, tenantId);
  if (!prerequisites.ready || prerequisites.reason === 'already_ready') return prerequisites;

  await db.batch([
    db
      .prepare(
        `UPDATE tenant_provisioning_steps
            SET status='success',
                attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                finished_at=CURRENT_TIMESTAMP,
                last_error=NULL,
                metadata_json=?2,
                updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND step_key='domain'`
      )
      .bind(
        prerequisites.provisioningId,
        JSON.stringify({
          domainId: prerequisites.domainId,
          verified: true,
          tenantRuntimeVerified: true
        })
      ),
    db
      .prepare(
        `UPDATE tenant_provisioning_runs
            SET status='running', current_step='publish', last_error=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='domain'`
      )
      .bind(prerequisites.provisioningId, tenantId)
  ]);
  return { ...prerequisites, advanced: true };
}
