import { TENANT_PROVISION_STEPS } from '../src/domain/tenant-provisioning.js';

const ALLOWED_TYPES = new Set(['running', 'success', 'skipped', 'failed', 'blocked']);

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeMetadata(metadata) {
  const value = metadata && typeof metadata === 'object' ? metadata : {};
  const serialized = JSON.stringify(value);
  if (/https?:\/\/|x\.yupoo\.com|credential|secret|token|password/i.test(serialized)) {
    throw new Error('Provisioning transition metadata contains private or unsafe data.');
  }
  return serialized;
}

function nextStepAfter(stepKey) {
  const index = TENANT_PROVISION_STEPS.indexOf(stepKey);
  if (index < 0) throw new Error(`Unknown provisioning step: ${stepKey}`);
  return TENANT_PROVISION_STEPS[index + 1] || 'complete';
}

export function buildProvisioningTransitionSql({
  tenantId,
  provisioningId,
  stepKey,
  type,
  error = null,
  metadata = null
}) {
  if (!/^t_[a-f0-9]{20}$/.test(String(tenantId))) throw new Error('Invalid tenant id.');
  if (!/^pv_[a-f0-9]{20}$/.test(String(provisioningId))) throw new Error('Invalid provisioning id.');
  if (!TENANT_PROVISION_STEPS.includes(stepKey)) throw new Error(`Unknown provisioning step: ${stepKey}`);
  if (!ALLOWED_TYPES.has(type)) throw new Error(`Unsupported provisioning transition: ${type}`);

  const runScope = `provisioning_id=${sqlString(provisioningId)} AND tenant_id=${sqlString(tenantId)}`;
  const stepScope = `provisioning_id=${sqlString(provisioningId)} AND step_key=${sqlString(stepKey)} AND provisioning_id IN (SELECT provisioning_id FROM tenant_provisioning_runs WHERE tenant_id=${sqlString(tenantId)})`;
  const metadataJson = safeMetadata(metadata);

  if (type === 'running') {
    return [
      `UPDATE tenant_provisioning_steps SET status='running', attempt_count=attempt_count+1, started_at=CURRENT_TIMESTAMP, finished_at=NULL, last_error=NULL, metadata_json=${sqlString(metadataJson)}, updated_at=CURRENT_TIMESTAMP WHERE ${stepScope};`,
      `UPDATE tenant_provisioning_runs SET status='running', current_step=${sqlString(stepKey)}, started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE ${runScope};`
    ].join('\n');
  }

  if (type === 'failed' || type === 'blocked') {
    const runStatus = type === 'failed' ? 'failed' : 'blocked';
    const message = String(error || (type === 'blocked' ? 'blocked' : 'failed')).slice(0, 500);
    return [
      `UPDATE tenant_provisioning_steps SET status=${sqlString(type)}, finished_at=CURRENT_TIMESTAMP, last_error=${sqlString(message)}, metadata_json=${sqlString(metadataJson)}, updated_at=CURRENT_TIMESTAMP WHERE ${stepScope};`,
      `UPDATE tenant_provisioning_runs SET status=${sqlString(runStatus)}, current_step=${sqlString(stepKey)}, last_error=${sqlString(message)}, updated_at=CURRENT_TIMESTAMP WHERE ${runScope};`
    ].join('\n');
  }

  const nextStep = nextStepAfter(stepKey);
  const completed = nextStep === 'complete';
  const runStatus = completed ? 'success' : 'running';
  return [
    `UPDATE tenant_provisioning_steps SET status=${sqlString(type)}, finished_at=CURRENT_TIMESTAMP, last_error=NULL, metadata_json=${sqlString(metadataJson)}, updated_at=CURRENT_TIMESTAMP WHERE ${stepScope};`,
    `UPDATE tenant_provisioning_runs SET status=${sqlString(runStatus)}, current_step=${sqlString(nextStep)}, finished_at=${completed ? 'CURRENT_TIMESTAMP' : 'NULL'}, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE ${runScope};`
  ].join('\n');
}
