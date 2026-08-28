export const TENANT_SYNC_REMOVAL_POLICY_CONTRACT_VERSION = 1;
export const TENANT_SYNC_REMOVAL_POLICY_VERSION = 1;

function text(value) {
  return String(value ?? '').trim();
}

export function scopedListingPreviousRow(row = {}) {
  const hasScopedProjection = Object.prototype.hasOwnProperty.call(row, 'scope_membership_state');
  if (!hasScopedProjection) return null;

  const membershipState = text(row.scope_membership_state).toLowerCase();
  const canonicalPresent = Number(row.canonical_product_present || 0) === 1;
  if (!membershipState) {
    return {
      status: canonicalPresent ? 'active' : 'deleted',
      missCount: 0
    };
  }
  if (!['active', 'missing', 'detached'].includes(membershipState)) {
    throw new Error('tenant_sync_scope_membership_state_invalid');
  }
  return {
    status: membershipState === 'detached' ? 'deleted' : membershipState,
    missCount: Math.max(0, Number(row.scope_miss_count || 0))
  };
}

export function removalPolicySnapshot({ scope, removalMissThreshold = 3 } = {}) {
  const threshold = Math.max(2, Number.parseInt(removalMissThreshold, 10) || 3);
  const scopeId = text(scope?.id);
  const scopeKind = text(scope?.kind);
  if (!scopeId || !['catalog', 'category', 'source', 'legacy'].includes(scopeKind)) {
    throw new Error('tenant_sync_removal_scope_invalid');
  }
  return Object.freeze({
    contractVersion: TENANT_SYNC_REMOVAL_POLICY_CONTRACT_VERSION,
    policyVersion: TENANT_SYNC_REMOVAL_POLICY_VERSION,
    removalThreshold: threshold,
    scopeId,
    scopeKind
  });
}
