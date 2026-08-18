const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

export async function stableOpaqueId(prefix, seed) {
  const hash = await sha256Hex(`${prefix}:${seed}`);
  return `${prefix}_${hash.slice(0, 20)}`;
}

export async function stableProvisioningIdempotencyKey({ slug, ownerPrincipalId = null }) {
  return sha256Hex(
    JSON.stringify({
      slug,
      ownerPrincipalId: ownerPrincipalId || null
    })
  );
}

export async function stableCustomDomainId(tenantId, hostname) {
  const hash = await sha256Hex(`custom-domain:${tenantId}:${hostname}`);
  return `dom_${hash.slice(0, 20)}`;
}

export async function stablePrincipalId(issuer, subject) {
  const hash = await sha256Hex(`principal:${issuer}:${subject}`);
  return `prn_${hash.slice(0, 20)}`;
}
