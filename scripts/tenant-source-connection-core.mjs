function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildTenantSourceConnectionSql(plan, { provisioningId = null } = {}) {
  const { connection, privateSource } = plan;
  const statements = [
    `INSERT INTO supplier_sources (tenant_id, source_key, provider, source_url, status, sync_strategy, updated_at) VALUES (${sqlString(connection.tenantId)}, ${sqlString(connection.sourceKey)}, ${sqlString(connection.provider)}, ${sqlString(privateSource.canonicalUrl)}, 'active', ${sqlString(connection.syncStrategy)}, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id, source_key) DO UPDATE SET provider=excluded.provider, source_url=excluded.source_url, status='active', sync_strategy=excluded.sync_strategy, last_error=NULL, updated_at=CURRENT_TIMESTAMP;`,
    `INSERT INTO tenant_source_connections (connection_id, tenant_id, provider, source_key, source_locator_ref, status, sync_strategy, last_health_at, updated_at) VALUES (${sqlString(connection.connectionId)}, ${sqlString(connection.tenantId)}, ${sqlString(connection.provider)}, ${sqlString(connection.sourceKey)}, ${sqlString(connection.sourceLocatorRef)}, 'active', ${sqlString(connection.syncStrategy)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id, source_key) DO UPDATE SET provider=excluded.provider, source_locator_ref=excluded.source_locator_ref, status='active', sync_strategy=excluded.sync_strategy, last_health_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP;`
  ];

  if (provisioningId) {
    statements.push(
      `UPDATE tenant_provisioning_steps SET status='success', attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END, started_at=COALESCE(started_at, CURRENT_TIMESTAMP), finished_at=CURRENT_TIMESTAMP, last_error=NULL, metadata_json=${sqlString(JSON.stringify({ provider: connection.provider, sourceKey: connection.sourceKey, scopeKind: privateSource.scopeKind }))}, updated_at=CURRENT_TIMESTAMP WHERE provisioning_id=${sqlString(provisioningId)} AND step_key='source' AND provisioning_id IN (SELECT provisioning_id FROM tenant_provisioning_runs WHERE tenant_id=${sqlString(connection.tenantId)});`,
      `UPDATE tenant_provisioning_runs SET status='running', current_step='import', started_at=COALESCE(started_at, CURRENT_TIMESTAMP), last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE provisioning_id=${sqlString(provisioningId)} AND tenant_id=${sqlString(connection.tenantId)};`
    );
  }

  statements.push(
    `INSERT INTO tenant_audit_log (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at) VALUES (${sqlString(connection.tenantId)}, NULL, 'tenant.source.connected', 'source_connection', ${sqlString(connection.connectionId)}, ${sqlString(JSON.stringify({ provider: connection.provider, sourceKey: connection.sourceKey, scopeKind: privateSource.scopeKind }))}, CURRENT_TIMESTAMP);`
  );

  return `PRAGMA foreign_keys = ON;\n${statements.join('\n')}\n`;
}