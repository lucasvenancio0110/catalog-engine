import { defineCatalogProvider } from './provider-contract.js';

const YUPOO_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i;

function normalizePathname(pathname) {
  return pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

export function canHandleYupooSource(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' && YUPOO_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeYupooCatalogUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('Informe uma URL válida do catálogo Yupoo.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('A fonte Yupoo precisa usar HTTPS.');
  }
  if (url.username || url.password || url.port) {
    throw new Error('A URL do fornecedor contém componentes não permitidos.');
  }

  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  if (!YUPOO_HOST_PATTERN.test(url.hostname)) {
    throw new Error('A fonte precisa ser um catálogo público do Yupoo (*.x.yupoo.com).');
  }

  const pathname = normalizePathname(url.pathname);
  if (pathname === '/' || pathname === '/albums') {
    url.pathname = '/albums/';
    url.search = '';
    return {
      canonicalUrl: url.href,
      scopeKind: 'catalog'
    };
  }

  const categoryMatch = pathname.match(/^\/categories\/(\d+)$/i);
  if (categoryMatch) {
    const isSubCategory = url.searchParams.get('isSubCate') === 'true';
    url.pathname = `/categories/${categoryMatch[1]}`;
    url.search = '';
    if (isSubCategory) url.searchParams.set('isSubCate', 'true');
    return {
      canonicalUrl: url.href,
      scopeKind: 'category'
    };
  }

  throw new Error('Conecte a raiz do catálogo (/albums/) ou uma categoria Yupoo suportada.');
}

export const yupooSourceProvider = defineCatalogProvider({
  key: 'yupoo',
  label: 'Yupoo',
  canHandleSource: canHandleYupooSource,
  normalizeSource: normalizeYupooCatalogUrl
});
