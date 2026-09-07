function constructionStub(env, tenantId) {
  const namespace = env?.TENANT_CONSTRUCTION_STATE;
  if (
    !namespace ||
    typeof namespace.idFromName !== 'function' ||
    typeof namespace.get !== 'function'
  ) {
    return null;
  }
  return namespace.get(namespace.idFromName(String(tenantId || '')));
}

function safeProgressCode(error) {
  const code = String(error?.code || error?.message || '').trim().toLowerCase();
  if (/^(construction|supplier|catalog_provider)_[a-z0-9_]{1,100}$/.test(code)) return code;
  return 'construction_progress_unavailable';
}

export function createInitialConstructionPageWriter(env, tenantId) {
  const stub = constructionStub(env, tenantId);
  if (!stub || typeof stub.fetch !== 'function') return null;

  return async (batch) => {
    const seed = batch?.seed;
    if (!seed || batch?.complete !== false) return { outcome: 'ignored' };
    try {
      const response = await stub.fetch('https://construction.internal/batch', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(seed)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.warn(
          'tenant_import_construction_progress_skipped',
          safeProgressCode({ message: payload?.error })
        );
        return { outcome: 'skipped', code: safeProgressCode({ message: payload?.error }) };
      }
      const payload = await response.json().catch(() => null);
      if (!payload?.ok || !Number.isInteger(payload?.revision)) {
        console.warn('tenant_import_construction_progress_skipped', 'construction_progress_invalid');
        return { outcome: 'skipped', code: 'construction_progress_invalid' };
      }
      return { outcome: 'written', revision: payload.revision };
    } catch (error) {
      const code = safeProgressCode(error);
      console.warn('tenant_import_construction_progress_skipped', code);
      return { outcome: 'skipped', code };
    }
  };
}
