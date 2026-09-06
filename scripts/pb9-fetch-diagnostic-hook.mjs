const nativeFetch = globalThis.fetch;

function classifyFetchError(error) {
  const code = String(error?.cause?.code || '').toLowerCase();
  const message = `${String(error?.message || '')} ${String(error?.cause?.message || '')}`.toLowerCase();
  if (message.includes('redirect')) return 'redirect';
  if (code.includes('enotfound') || code.includes('eai_again') || message.includes('getaddrinfo')) return 'dns';
  if (code.includes('cert') || code.includes('tls') || message.includes('certificate') || message.includes('tls')) return 'tls';
  if (code.includes('timeout') || message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (code.includes('econnrefused') || message.includes('connection refused')) return 'connection_refused';
  if (code.includes('econnreset') || message.includes('connection reset')) return 'connection_reset';
  return code ? `network_${code.replace(/[^a-z0-9_]+/g, '_').slice(0, 40)}` : 'network_unknown';
}

function classifyFetchTarget(input) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
    const host = new URL(String(raw || '')).hostname.toLowerCase();
    if (host === 'app.catalogoengine.com') return 'app';
    if (host === 'catalogoengine.com') return 'default';
    if (host === 'api.cloudflare.com') return 'cloudflare';
    return 'other';
  } catch {
    return 'unknown';
  }
}

if (typeof nativeFetch === 'function') {
  globalThis.fetch = async (...args) => {
    try {
      return await nativeFetch(...args);
    } catch (error) {
      console.error(
        `pb9_node_fetch_failure=${classifyFetchError(error)} target=${classifyFetchTarget(args[0])}`
      );
      throw error;
    }
  };
}
