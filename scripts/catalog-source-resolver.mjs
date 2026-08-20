import { verifyYupooSourceUrl, resolveYupooSourceUrl } from './yupoo-source-resolver.mjs';

const resolvers = Object.freeze({
  yupoo: Object.freeze({
    resolve: resolveYupooSourceUrl,
    verify: verifyYupooSourceUrl
  })
});

function sourceResolver(provider) {
  const key = String(provider || '').trim().toLowerCase();
  const resolver = resolvers[key];
  if (!resolver) throw new Error('catalog_source_provider_not_supported');
  return resolver;
}

export function resolveCatalogSourceUrl(provider, value, options = {}) {
  return sourceResolver(provider).resolve(value, options);
}

export function verifyCatalogSourceUrl(provider, value, options = {}) {
  return sourceResolver(provider).verify(value, options);
}
