import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}
async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_backcompat_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`m7d9_backcompat_ambiguous:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

{
  const path = 'worker/tenant-data-plane-command.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `const TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION = CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION;`,
    `const TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION = CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION;\n\nfunction migrationCommandContract(payload) {\n  const version = Number(payload?.version);\n  const targetSchemaVersion = Number(payload?.targetSchemaVersion);\n  if (version === 3 && targetSchemaVersion === 7) {\n    return { version, targetSchemaVersion };\n  }\n  if (\n    version === TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION &&\n    targetSchemaVersion === TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION\n  ) {\n    return { version, targetSchemaVersion };\n  }\n  return null;\n}`,
    'command-contract-helper'
  );
  source = replaceOnce(
    source,
    `  if (\n    Number(payload?.version) !== TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION ||\n    String(payload?.tenantId || '') !== boundTenantId ||\n    Number(payload?.targetSchemaVersion) !== TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION ||\n    Object.keys(payload || {}).some(\n      (key) => !['version', 'tenantId', 'targetSchemaVersion'].includes(key)\n    )\n  ) {\n    return safeJsonError('tenant_data_plane_contract_invalid', 400);\n  }\n\n  try {\n    const previousVersion = await inspectTenantDataPlaneSchema(env.CATALOG_DB, boundTenantId);\n    for (\n      let version = previousVersion + 1;\n      version <= TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION;\n      version += 1\n    ) {`,
    `  const migrationContract = migrationCommandContract(payload);\n  if (\n    !migrationContract ||\n    String(payload?.tenantId || '') !== boundTenantId ||\n    Object.keys(payload || {}).some(\n      (key) => !['version', 'tenantId', 'targetSchemaVersion'].includes(key)\n    )\n  ) {\n    return safeJsonError('tenant_data_plane_contract_invalid', 400);\n  }\n\n  try {\n    const previousVersion = await inspectTenantDataPlaneSchema(env.CATALOG_DB, boundTenantId);\n    if (previousVersion > migrationContract.targetSchemaVersion) {\n      throw new TenantDataPlaneCommandError('tenant_data_plane_schema_target_invalid', 409);\n    }\n    for (\n      let version = previousVersion + 1;\n      version <= migrationContract.targetSchemaVersion;\n      version += 1\n    ) {`,
    'command-contract-validation'
  );
  source = replaceOnce(
    source,
    `    if (schemaVersion !== TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION) {\n      throw new TenantDataPlaneCommandError('tenant_data_plane_migration_verification_failed', 502);\n    }\n    return Response.json(\n      {\n        ok: true,\n        version: TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION,`,
    `    if (schemaVersion !== migrationContract.targetSchemaVersion) {\n      throw new TenantDataPlaneCommandError('tenant_data_plane_migration_verification_failed', 502);\n    }\n    return Response.json(\n      {\n        ok: true,\n        version: migrationContract.version,`,
    'command-response-contract'
  );
  source = replaceOnce(
    source,
    `    ? \`const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION=\${TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION};\\nconst TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH=\${JSON.stringify(TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH)};\\nconst TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION=\${TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION};\\nconst TENANT_DATA_PLANE_MIGRATION_STATEMENTS=\${JSON.stringify(TENANT_DATA_PLANE_MIGRATION_STATEMENTS)};\\n\${inspectTenantDataPlaneSchema.toString()}\\n\${tenantDataPlaneSchemaMigrationBatch.toString()}\\n\${handleTenantDataPlaneSchemaMigrationCommand.toString()}\\n\``,
    `    ? \`const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION=\${TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION};\\nconst TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH=\${JSON.stringify(TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH)};\\nconst TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION=\${TENANT_DATA_PLANE_MIGRATION_TARGET_VERSION};\\nconst TENANT_DATA_PLANE_MIGRATION_STATEMENTS=\${JSON.stringify(TENANT_DATA_PLANE_MIGRATION_STATEMENTS)};\\n\${migrationCommandContract.toString()}\\n\${inspectTenantDataPlaneSchema.toString()}\\n\${tenantDataPlaneSchemaMigrationBatch.toString()}\\n\${handleTenantDataPlaneSchemaMigrationCommand.toString()}\\n\``,
    'command-generated-runtime-helper'
  );
  await write(path, source);
}

{
  const path = 'worker/ingestion/tenant-data-plane.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `export async function migrateTenantDataPlaneSchema(context, env, targetSchemaVersion) {`,
    `function migrationCommandVersionForSchema(schemaVersion) {\n  if (schemaVersion === 7) return 3;\n  if (schemaVersion === 8) return TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION;\n  throw new TenantDataPlaneClientError('tenant_data_plane_schema_target_invalid', 500);\n}\n\nexport async function migrateTenantDataPlaneSchema(context, env, targetSchemaVersion) {`,
    'client-version-helper'
  );
  source = replaceOnce(
    source,
    `  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {\n    throw new TenantDataPlaneClientError('tenant_data_plane_schema_target_invalid', 500);\n  }\n\n  let fetcher;`,
    `  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {\n    throw new TenantDataPlaneClientError('tenant_data_plane_schema_target_invalid', 500);\n  }\n  const migrationCommandVersion = migrationCommandVersionForSchema(schemaVersion);\n\n  let fetcher;`,
    'client-resolve-version'
  );
  source = replaceOnce(
    source,
    `      version: TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION,\n      tenantId: target.tenantId,\n      targetSchemaVersion: schemaVersion`,
    `      version: migrationCommandVersion,\n      tenantId: target.tenantId,\n      targetSchemaVersion: schemaVersion`,
    'client-request-version'
  );
  source = replaceOnce(
    source,
    `    Number(payload?.version) !== TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION`,
    `    Number(payload?.version) !== migrationCommandVersion`,
    'client-response-version'
  );
  await write(path, source);
}

{
  const path = 'worker/data-plane-migration-runner.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `export function normalizeMigrationKind(value = 'provisioning') {`,
    `function migrationCommandVersionForTarget(targetVersion) {\n  const version = Number(targetVersion);\n  if (version === 7) return 3;\n  if (version === TENANT_DATA_PLANE_SCHEMA_VERSION) {\n    return TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION;\n  }\n  throw new CloudflarePlatformError('tenant_data_plane_schema_state_invalid', 500);\n}\n\nexport function normalizeMigrationKind(value = 'provisioning') {`,
    'runner-command-version-helper'
  );
  source = replaceOnce(
    source,
    `async function claimMigration(db, job) {\n  const kind = normalizeMigrationKind(job.migration_kind);\n  const result = await db`,
    `async function claimMigration(db, job) {\n  const kind = normalizeMigrationKind(job.migration_kind);\n  const requiredCommandVersion = migrationCommandVersionForTarget(job.target_schema_version);\n  const result = await db`,
    'runner-claim-command-version'
  );
  source = replaceOnce(
    source,
    `      job.tenant_id,\n      TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION\n    )`,
    `      job.tenant_id,\n      requiredCommandVersion\n    )`,
    'runner-claim-bind-version'
  );
  source = replaceOnce(
    source,
    `    if (\n      migrationKind === 'maintenance' &&\n      Number(context.migration_command_version || 0) < TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION\n    ) {\n      throw new CloudflarePlatformError('tenant_migration_command_not_prepared', 409);\n    }`,
    `    const requiredCommandVersion = migrationCommandVersionForTarget(job.target_schema_version);\n    if (\n      migrationKind === 'maintenance' &&\n      Number(context.migration_command_version || 0) < requiredCommandVersion\n    ) {\n      throw new CloudflarePlatformError('tenant_migration_command_not_prepared', 409);\n    }`,
    'runner-process-command-version'
  );
  source = replaceOnce(
    source,
    `      targetVersion !== TENANT_DATA_PLANE_SCHEMA_VERSION ||\n      controlVersion > targetVersion`,
    `      targetVersion < 1 ||\n      targetVersion > TENANT_DATA_PLANE_SCHEMA_VERSION ||\n      controlVersion > targetVersion`,
    'runner-allow-historical-target'
  );
  await write(path, source);
}

console.log(JSON.stringify({ m7d9MigrationBackcompat: true }));
