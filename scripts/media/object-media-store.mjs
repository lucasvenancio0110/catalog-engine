import { normalizeStorageKey } from './media-store-contract.mjs';

function ensureDriver(driver) {
  for (const method of ['has', 'put', 'list', 'delete']) {
    if (typeof driver?.[method] !== 'function') {
      throw new Error(`Object media driver inválido: método ${method} ausente.`);
    }
  }
  return driver;
}

export class ObjectMediaStore {
  constructor({ driver, publicBase }) {
    this.driver = ensureDriver(driver);
    this.publicBase = String(publicBase || '').replace(/\/$/, '');
    if (!/^https:\/\//i.test(this.publicBase)) {
      throw new Error('Object media store exige publicBase HTTPS.');
    }
    this.mode = 'object';
  }

  publicUrl(key) {
    return `${this.publicBase}/${normalizeStorageKey(key)}`;
  }

  async has(key) {
    return Boolean(await this.driver.has(normalizeStorageKey(key)));
  }

  async put(key, bytes) {
    const normalized = normalizeStorageKey(key);
    if (await this.has(normalized)) {
      const metadata = typeof this.driver.metadata === 'function'
        ? await this.driver.metadata(normalized)
        : null;
      return {
        created: false,
        key: normalized,
        url: this.publicUrl(normalized),
        bytes: Number(metadata?.bytes || bytes.length)
      };
    }

    await this.driver.put(normalized, bytes, {
      cacheControl: normalized.startsWith('original/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=31536000, immutable'
    });
    return {
      created: true,
      key: normalized,
      url: this.publicUrl(normalized),
      bytes: bytes.length
    };
  }

  async prune(referencedKeys = []) {
    const referenced = new Set(referencedKeys.filter(Boolean).map(normalizeStorageKey));
    const keys = await this.driver.list('');
    let removed = 0;
    let removedBytes = 0;

    for (const keyValue of keys || []) {
      const key = normalizeStorageKey(typeof keyValue === 'string' ? keyValue : keyValue.key);
      if (referenced.has(key)) continue;
      const bytes = Number(
        typeof keyValue === 'object' && keyValue ? keyValue.bytes || 0 : 0
      );
      await this.driver.delete(key);
      removed += 1;
      removedBytes += bytes;
    }
    return { removed, removedBytes };
  }
}
