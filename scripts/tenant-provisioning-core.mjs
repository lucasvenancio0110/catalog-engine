function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildTenantProvisioningSql(plan) {
  const statements = [];
  const { tenant, profile, dataPlane, domain, membership, provisioning } = plan;

  statements.push(
    `INSERT INTO catalog_tenants (tenant_id, slug, display_name, status, created_at, updated_at) VALUES (${sqlString(tenant.tenantId)}, ${sqlString(tenant.slug)}, ${sqlString(tenant.displayName)}, ${sqlString(tenant.status)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id) DO UPDATE SET slug=excluded.slug, display_name=excluded.display_name, status=excluded.status, updated_at=CURRENT_TIMESTAMP;`
  );

  statements.push(
    `INSERT INTO tenant_store_profiles (tenant_id, store_name, currency, theme_key, setup_status, created_at, updated_at) VALUES (${sqlString(profile.tenantId)}, ${sqlString(profile.storeName)}, ${sqlString(profile.currency)}, ${sqlString(profile.themeKey)}, ${sqlString(profile.setupStatus)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id) DO UPDATE SET store_name=excluded.store_name, currency=excluded.currency, theme_key=excluded.theme_key, setup_status=excluded.setup_status, updated_at=CURRENT_TIMESTAMP;`
  );

  statements.push(
    `INSERT INTO tenant_catalog_instances (tenant_id, data_plane_key, status, schema_version, created_at, updated_at) VALUES (${sqlString(dataPlane.tenantId)}, ${sqlString(dataPlane.dataPlaneKey)}, ${sqlString(dataPlane.status)}, ${Number(dataPlane.schemaVersion || 0)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id) DO UPDATE SET data_plane_key=excluded.data_plane_key, updated_at=CURRENT_TIMESTAMP;`
  );

  if (domain) {
    statements.push(
      `INSERT INTO tenant_domains (domain_id, tenant_id, hostname, domain_type, status, created_at, updated_at) VALUES (${sqlString(domain.domainId)}, ${sqlString(domain.tenantId)}, ${sqlString(domain.hostname)}, ${sqlString(domain.domainType)}, ${sqlString(domain.status)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(domain_id) DO UPDATE SET hostname=excluded.hostname, status=excluded.status, updated_at=CURRENT_TIMESTAMP;`
    );
  }

  if (membership) {
    statements.push(
      `INSERT INTO tenant_memberships (membership_id, tenant_id, principal_id, role, status, created_at, updated_at) VALUES (${sqlString(membership.membershipId)}, ${sqlString(membership.tenantId)}, ${sqlString(membership.principalId)}, ${sqlString(membership.role)}, ${sqlString(membership.status)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id, principal_id) DO UPDATE SET role=excluded.role, status=excluded.status, updated_at=CURRENT_TIMESTAMP;`
    );
  }

  statements.push(
    `INSERT INTO tenant_provisioning_runs (provisioning_id, tenant_id, idempotency_key, requested_by_principal_id, status, current_step, context_json, created_at, updated_at) VALUES (${sqlString(provisioning.provisioningId)}, ${sqlString(provisioning.tenantId)}, ${sqlString(provisioning.idempotencyKey)}, ${sqlString(provisioning.requestedByPrincipalId)}, ${sqlString(provisioning.status)}, ${sqlString(provisioning.currentStep)}, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(provisioning_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP;`
  );

  for (const step of provisioning.steps) {
    statements.push(
      `INSERT INTO tenant_provisioning_steps (provisioning_id, step_key, status, attempt_count, updated_at) VALUES (${sqlString(provisioning.provisioningId)}, ${sqlString(step.stepKey)}, ${sqlString(step.status)}, ${Number(step.attemptCount || 0)}, CURRENT_TIMESTAMP) ON CONFLICT(provisioning_id, step_key) DO UPDATE SET updated_at=CURRENT_TIMESTAMP;`
    );
  }

  const auditMetadata = JSON.stringify({ provisioningId: provisioning.provisioningId, slug: tenant.slug });
  statements.push(
    `INSERT INTO tenant_audit_log (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at) SELECT ${sqlString(tenant.tenantId)}, ${sqlString(provisioning.requestedByPrincipalId)}, 'tenant.provision.requested', 'tenant', ${sqlString(tenant.tenantId)}, ${sqlString(auditMetadata)}, CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM tenant_audit_log WHERE tenant_id=${sqlString(tenant.tenantId)} AND action='tenant.provision.requested' AND metadata_json=${sqlString(auditMetadata)});`
  );

  return `PRAGMA foreign_keys = ON;\n${statements.join('\n')}\n`;
}
