const API_BASE = 'https://api.cloudflare.com/client/v4';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name.toLowerCase()}_missing`);
  return value;
}

async function request(apiToken, path) {
  const response = await fetch(`${API_BASE}${path}`, {
    redirect: 'error',
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const error = payload?.errors?.[0] || {};
    throw new Error(`cloudflare_api_${response.status}_${String(error.code ?? response.status).slice(0, 40)}:${String(error.message || 'request failed').replace(/\s+/g, ' ').slice(0, 180)}`);
  }
  return payload.result;
}

function permissionNames(policies) {
  return [...new Set(
    (Array.isArray(policies) ? policies : [])
      .flatMap((policy) => Array.isArray(policy?.permission_groups) ? policy.permission_groups : [])
      .map((group) => String(group?.name || '').trim())
      .filter((name) => /(^DNS\b|^Zone\b)/i.test(name))
  )].sort();
}

function resourceKeys(policies) {
  return (Array.isArray(policies) ? policies : [])
    .flatMap((policy) => Object.keys(policy?.resources || {}));
}

async function main() {
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const zoneName = String(process.env.CLOUDFLARE_PLATFORM_ZONE || 'catalogoengine.com').trim().toLowerCase();

  const verify = await request(apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/verify`);
  const tokenId = String(verify?.id || '').trim();
  if (!tokenId) throw new Error('cloudflare_token_id_missing');

  const token = await request(apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/${encodeURIComponent(tokenId)}`);
  const zones = await request(apiToken, `/zones?${new URLSearchParams({ name: zoneName, 'account.id': accountId, status: 'active', per_page: '50' })}`);
  const zone = (Array.isArray(zones) ? zones : []).find((item) => String(item?.name || '').toLowerCase() === zoneName);
  if (!zone?.id) throw new Error('cloudflare_zone_resolution_failed');

  const keys = resourceKeys(token?.policies);
  const exactZoneKey = `com.cloudflare.api.account.zone.${zone.id}`;
  const allZonesKey = 'com.cloudflare.api.account.zone.*';
  const accountKey = `com.cloudflare.api.account.${accountId}`;
  const hasExactZone = keys.includes(exactZoneKey);
  const hasAllZones = keys.includes(allZonesKey);
  const hasAccountResource = keys.includes(accountKey);
  const hasNestedAllZones = (Array.isArray(token?.policies) ? token.policies : []).some((policy) => {
    const scoped = policy?.resources?.[accountKey];
    return scoped && typeof scoped === 'object' && scoped['com.cloudflare.api.account.zone.*'] === '*';
  });

  console.log(JSON.stringify({
    token: {
      status: String(verify?.status || token?.status || 'unknown'),
      name: String(token?.name || ''),
      policyCount: Array.isArray(token?.policies) ? token.policies.length : 0
    },
    zone: {
      name: zoneName,
      resolved: true
    },
    zonePermissions: permissionNames(token?.policies),
    scope: {
      hasExactZone,
      hasAllZones,
      hasNestedAllZones,
      hasAccountResource,
      zoneAuthorized: hasExactZone || hasAllZones || hasNestedAllZones
    }
  }, null, 2));
}

await main();
