import { normalizeYupooCatalogUrl } from '../src/domain/tenant-source-connection.js';

const probeHeaders = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

export function subcategoryVariant(value) {
  const normalized = normalizeYupooCatalogUrl(value);
  const url = new URL(normalized.canonicalUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!/\/categories\/\d+$/i.test(pathname)) return url.href;
  if (!url.searchParams.has('isSubCate')) url.searchParams.set('isSubCate', 'true');
  return url.href;
}

async function probe(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(url, {
      headers: probeHeaders,
      redirect: 'follow',
      signal: controller.signal
    });
    if (response.url) normalizeYupooCatalogUrl(response.url);
    await response.body?.cancel().catch(() => {});
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveYupooSourceUrl(value, { fetchImpl = fetch } = {}) {
  const normalized = normalizeYupooCatalogUrl(value);
  const url = new URL(normalized.canonicalUrl);
  const pathname = url.pathname.replace(/\/+$/, '');

  if (!/\/categories\/\d+$/i.test(pathname) || url.searchParams.has('isSubCate')) {
    return url.href;
  }

  let normalStatus;
  try {
    normalStatus = await probe(url.href, fetchImpl);
  } catch {
    // Network instability is not evidence that this is a subcategory. Let the crawler retry normally.
    return url.href;
  }

  if (normalStatus !== 404) return url.href;

  const candidate = subcategoryVariant(url.href);
  try {
    const candidateStatus = await probe(candidate, fetchImpl);
    if (candidateStatus >= 200 && candidateStatus < 400) return candidate;
  } catch {
    // Return the candidate: the crawler already has bounded retries and will surface the real error.
    return candidate;
  }

  return candidate;
}

export async function verifyYupooSourceUrl(value, { fetchImpl = fetch } = {}) {
  const resolved = await resolveYupooSourceUrl(value, { fetchImpl });
  const status = await probe(resolved, fetchImpl);
  if (status < 200 || status >= 400) {
    throw new Error(`O catálogo Yupoo respondeu HTTP ${status}.`);
  }
  return resolved;
}
