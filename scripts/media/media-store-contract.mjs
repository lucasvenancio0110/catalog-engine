const requiredMethods = ['put', 'has', 'publicUrl', 'prune'];

export function assertMediaStore(store) {
  if (!store || typeof store !== 'object') {
    throw new Error('Media store ausente.');
  }
  for (const method of requiredMethods) {
    if (typeof store[method] !== 'function') {
      throw new Error(`Media store inválido: método ${method} ausente.`);
    }
  }
  if (!['repository', 'object'].includes(store.mode)) {
    throw new Error(`Media store inválido: mode ${store.mode || '(vazio)'}.`);
  }
  if (!store.publicBase || typeof store.publicBase !== 'string') {
    throw new Error('Media store inválido: publicBase ausente.');
  }
  return store;
}

export function normalizeStorageKey(key) {
  const value = String(key || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!value || value.includes('..') || value.startsWith('/')) {
    throw new Error(`Storage key inválida: ${key}`);
  }
  return value;
}

export function keyFromPublicUrl(url, publicBase) {
  const value = String(url || '');
  const base = String(publicBase || '').replace(/\/$/, '');
  if (!value || !base) return null;

  if (value.startsWith(`${base}/`)) {
    return normalizeStorageKey(value.slice(base.length + 1));
  }

  try {
    const parsed = new URL(value, 'https://catalog-engine.invalid/');
    const parsedBase = new URL(base, 'https://catalog-engine.invalid/');
    if (parsed.origin !== parsedBase.origin) return null;
    const basePath = parsedBase.pathname.replace(/\/$/, '');
    if (!parsed.pathname.startsWith(`${basePath}/`)) return null;
    return normalizeStorageKey(parsed.pathname.slice(basePath.length + 1));
  } catch {
    return null;
  }
}

export function descriptorStorageKeys(media, publicBase = '') {
  return {
    originalKey:
      media?.originalKey || keyFromPublicUrl(media?.downloadUrl, publicBase),
    webKey: media?.webKey || keyFromPublicUrl(media?.url, publicBase),
    thumbnailKey:
      media?.thumbnailKey || keyFromPublicUrl(media?.thumbnailUrl, publicBase)
  };
}
