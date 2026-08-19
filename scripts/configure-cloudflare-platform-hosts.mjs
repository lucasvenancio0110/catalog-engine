const API_BASE = 'https://api.cloudflare.com/client/v4';

export function planPlatformHostRecord({ records, host, target }) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  const normalizedTarget = String(target || '').trim().replace(/\.$/, '').toLowerCase();
  const list = Array.isArray(records) ? records : [];
  const exact = list.filter((record) => String(record?.name || '').trim().toLowerCase() === normalizedHost);

  if (!normalizedHost || !normalizedTarget) throw new Error('platform_host_config_invalid');
  if (exact.length === 0) return { action: 'create', recordId: null };
  if (exact.length > 1) throw new Error('platform_host_multiple_dns_records');

  const [record] = exact;
  if (String(record?.type || '').toUpperCase() !== 'CNAME') {
    throw new Error(`platform_host_conflicting_dns_type_${String(record?.type || 'unknown').toLowerCase()}`);
  }

  const content = String(record?.content || '').trim().replace(/\.$/, '').toLowerCase();
  const healthy = content === normalizedTarget && record?.proxied === true && Number(record?.ttl || 1) === 1;
  return healthy
    ? { action: 'noop', recordId: String(record.id || '') }
    : { action: 'update', recordId: String(record.id || '') };
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name.toLowerCase()}_missing`);
  return value;
}

async function cloudflareRequest(apiToken, path, { method = 'GET', body } = {}) {
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

async function resolveZone({ apiToken, accountId, zoneName }) {
  const params = new URLSearchParams({ name: zoneName, 'account.id': accountId, status: 'active', per_page: '50' });
  const zones = await cloudflareRequest(apiToken, `/zones?${params.toString()}`);
  const exact = (Array.isArray(zones) ? zones : []).filter(
    (zone) => String(zone?.name || '').trim().toLowerCase() === zoneName.toLowerCase()
  );
  if (exact.length !== 1) throw new Error(`cloudflare_zone_resolution_failed_${exact.length}`);
  return exact[0];
}

async function readHostRecords({ apiToken, zoneId, host }) {
  const params = new URLSearchParams({ name: host, per_page: '100' });
  const records = await cloudflareRequest(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records?${params}`);
  return Array.isArray(records) ? records : [];
}

async function ensureHostRecord({ apiToken, zoneId, host, target }) {
  const records = await readHostRecords({ apiToken, zoneId, host });
  const plan = planPlatformHostRecord({ records, host, target });
  const desired = { type: 'CNAME', name: host, content: target, ttl: 1, proxied: true };

  if (plan.action === 'create') {
    await cloudflareRequest(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
      method: 'POST',
      body: desired
    });
  } else if (plan.action === 'update') {
    if (!plan.recordId) throw new Error('platform_host_dns_record_id_missing');
    await cloudflareRequest(
      apiToken,
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(plan.recordId)}`,
      { method: 'PATCH', body: desired }
    );
  }

  const verified = await readHostRecords({ apiToken, zoneId, host });
  const finalPlan = planPlatformHostRecord({ records: verified, host, target });
  if (finalPlan.action !== 'noop') throw new Error('platform_host_dns_verification_failed');
  return { changed: plan.action !== 'noop', action: plan.action };
}

async function verifyPortal(host) {
  const healthUrl = `https://${host}/api/health`;
  const portalUrl = `https://${host}/`;
  let last = 'not_started';

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const [health, portal] = await Promise.all([
        fetch(healthUrl, { redirect: 'error', headers: { accept: 'application/json' } }),
        fetch(portalUrl, { redirect: 'error', headers: { accept: 'text/html' } })
      ]);
      const healthText = await health.text();
      const portalText = await portal.text();
      const isHealth = health.status === 200 && /healthy|ok/i.test(healthText);
      const isPortal =
        portal.status === 200 &&
        String(portal.headers.get('content-type') || '').includes('text/html') &&
        /Catalog Engine\s*[—-]\s*Portal/i.test(portalText);
      if (isHealth && isPortal) {
        return { attempts: attempt, healthStatus: health.status, portalStatus: portal.status };
      }
      last = `health=${health.status},portal=${portal.status},portalMarker=${isPortal}`;
    } catch (error) {
      last = String(error?.message || error).slice(0, 180);
    }
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, Math.min(30000, attempt * 3000)));
  }

  throw new Error(`platform_host_live_verification_failed:${last}`);
}

export async function configurePlatformHosts() {
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const zoneName = String(process.env.CLOUDFLARE_PLATFORM_ZONE || 'catalogoengine.com').trim().toLowerCase();
  const appHost = String(process.env.CLOUDFLARE_APP_HOST || 'app.catalogoengine.com').trim().toLowerCase();
  const appTarget = String(process.env.CLOUDFLARE_APP_TARGET || 'origin.catalogoengine.com').trim().toLowerCase();

  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('cloudflare_account_id_invalid');
  if (apiToken.length < 20) throw new Error('cloudflare_api_token_invalid');
  if (!appHost.endsWith(`.${zoneName}`)) throw new Error('platform_app_host_outside_zone');

  const zone = await resolveZone({ apiToken, accountId, zoneName });
  const dns = await ensureHostRecord({ apiToken, zoneId: zone.id, host: appHost, target: appTarget });
  const live = await verifyPortal(appHost);

  const summary = {
    ok: true,
    zone: zoneName,
    appHost,
    appTarget,
    dnsAction: dns.action,
    dnsChanged: dns.changed,
    live
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await configurePlatformHosts();
}
