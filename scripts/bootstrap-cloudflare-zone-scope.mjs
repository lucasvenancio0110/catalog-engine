const API_BASE = 'https://api.cloudflare.com/client/v4';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name.toLowerCase()}_missing`);
  return value;
}

async function request(apiToken, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const error = payload?.errors?.[0] || {};
    const code = String(error.code ?? response.status).slice(0, 40);
    const message = String(error.message || 'Cloudflare request failed').replace(/\s+/g, ' ').slice(0, 220);
    throw new Error(`cloudflare_api_${response.status}_${code}:${message}`);
  }
  return payload.result;
}

function normalizePolicies(policies) {
  return (Array.isArray(policies) ? policies : []).map((policy) => ({
    effect: policy?.effect === 'deny' ? 'deny' : 'allow',
    resources: policy?.resources || {},
    permission_groups: (Array.isArray(policy?.permission_groups) ? policy.permission_groups : [])
      .map((group) => ({ id: String(group?.id || '').trim() }))
      .filter((group) => group.id)
  }));
}

function findPermissionGroup(groups, candidates) {
  const normalized = new Map(
    (Array.isArray(groups) ? groups : []).map((group) => [String(group?.name || '').trim().toLowerCase(), group])
  );
  for (const candidate of candidates) {
    const group = normalized.get(candidate.toLowerCase());
    if (group?.id && Array.isArray(group?.scopes) && group.scopes.includes('com.cloudflare.api.account.zone')) {
      return { id: String(group.id), name: String(group.name) };
    }
  }
  return null;
}

async function main() {
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const zoneName = String(process.env.CLOUDFLARE_PLATFORM_ZONE || 'catalogoengine.com').trim().toLowerCase();

  const verify = await request(apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/verify`);
  const tokenId = String(verify?.id || '').trim();
  if (!tokenId) throw new Error('cloudflare_token_id_missing');

  const [token, permissionGroups, zones] = await Promise.all([
    request(apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/${encodeURIComponent(tokenId)}`),
    request(apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/permission_groups`),
    request(apiToken, `/zones?${new URLSearchParams({ name: zoneName, 'account.id': accountId, status: 'active', per_page: '50' })}`)
  ]);

  const zone = (Array.isArray(zones) ? zones : []).find(
    (item) => String(item?.name || '').trim().toLowerCase() === zoneName
  );
  if (!zone?.id) throw new Error('cloudflare_zone_resolution_failed');

  const zoneResource = `com.cloudflare.api.account.zone.${zone.id}`;
  const currentPolicies = Array.isArray(token?.policies) ? token.policies : [];
  const alreadyAuthorized = currentPolicies.some((policy) => {
    const resources = policy?.resources || {};
    return Object.prototype.hasOwnProperty.call(resources, zoneResource) ||
      Object.prototype.hasOwnProperty.call(resources, 'com.cloudflare.api.account.zone.*');
  });

  if (alreadyAuthorized) {
    console.log(JSON.stringify({ ok: true, changed: false, reason: 'zone_scope_already_present', zone: zoneName }, null, 2));
    return;
  }

  const zoneRead = findPermissionGroup(permissionGroups, ['Zone Read']);
  const dnsRead = findPermissionGroup(permissionGroups, ['DNS Read', 'DNS Records Read']);
  const dnsWrite = findPermissionGroup(permissionGroups, ['DNS Write', 'DNS Records Write']);
  if (!zoneRead || !dnsWrite) {
    const available = (Array.isArray(permissionGroups) ? permissionGroups : [])
      .filter((group) => Array.isArray(group?.scopes) && group.scopes.includes('com.cloudflare.api.account.zone'))
      .map((group) => String(group?.name || ''))
      .filter((name) => /^(DNS|Zone)\b/i.test(name))
      .sort();
    throw new Error(`required_zone_permission_groups_missing:${JSON.stringify({ zoneRead: Boolean(zoneRead), dnsWrite: Boolean(dnsWrite), available })}`);
  }

  const permissionGroupsForZone = [zoneRead, dnsRead, dnsWrite].filter(Boolean);
  const policies = normalizePolicies(currentPolicies);
  policies.push({
    effect: 'allow',
    resources: { [zoneResource]: '*' },
    permission_groups: permissionGroupsForZone.map((group) => ({ id: group.id }))
  });

  const body = {
    name: String(token?.name || 'catalog-engine-github'),
    policies,
    status: 'active'
  };
  if (token?.condition) body.condition = token.condition;
  if (token?.expires_on) body.expires_on = token.expires_on;
  if (token?.not_before) body.not_before = token.not_before;

  await request(apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'PUT',
    body
  });

  const updated = await request(apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/${encodeURIComponent(tokenId)}`);
  const authorized = (Array.isArray(updated?.policies) ? updated.policies : []).some((policy) =>
    Object.prototype.hasOwnProperty.call(policy?.resources || {}, zoneResource)
  );
  if (!authorized) throw new Error('cloudflare_zone_scope_update_not_observed');

  console.log(JSON.stringify({
    ok: true,
    changed: true,
    zone: zoneName,
    permissions: permissionGroupsForZone.map((group) => group.name)
  }, null, 2));
}

await main();
