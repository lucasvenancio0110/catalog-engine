const MEDIA_ID_PATTERN = /^m_[a-f0-9]{20}$/;
const DEFAULT_ALLOWED_SOURCE_HOSTS = ['photo.yupoo.com'];

function clean(value = '') {
  return String(value).trim();
}

export function normalizeMediaId(value) {
  const mediaId = clean(value).toLowerCase();
  return MEDIA_ID_PATTERN.test(mediaId) ? mediaId : null;
}

export function parseAllowedSourceHosts(value = '') {
  const parsed = clean(value)
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? [...new Set(parsed)] : DEFAULT_ALLOWED_SOURCE_HOSTS;
}

function hostMatches(hostname, rule) {
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === rule;
}

export function safeSourceUrl(value, allowedHosts = DEFAULT_ALLOWED_SOURCE_HOSTS) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    if (!allowedHosts.some((rule) => hostMatches(hostname, rule))) return null;
    url.username = '';
    url.password = '';
    return url;
  } catch {
    return null;
  }
}

export function safeRefererUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.toLowerCase().endsWith('.x.yupoo.com')) return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function buildUpstreamHeaders(refererUrl) {
  const headers = new Headers({
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (compatible; CatalogEngineMedia/1.0)'
  });
  const safeReferer = safeRefererUrl(refererUrl);
  if (safeReferer) headers.set('referer', safeReferer);
  return headers;
}

export function publicMediaHeaders(originHeaders) {
  const contentType = originHeaders.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) return null;

  const headers = new Headers();
  headers.set('content-type', contentType);
  headers.set('cache-control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cross-origin-resource-policy', 'cross-origin');

  for (const name of ['content-length', 'etag', 'last-modified']) {
    const value = originHeaders.get(name);
    if (value) headers.set(name, value);
  }

  return headers;
}

export function mediaCacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  return new Request(url.href, { method: 'GET' });
}
