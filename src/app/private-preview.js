function previewError(code, status = 0) {
  const error = new Error(code || 'preview_unavailable');
  error.code = code || 'preview_unavailable';
  error.status = Number(status) || 0;
  return error;
}

async function previewJson(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return payload;
}

export async function requestPortalPrivatePreviewStatus({ tenantId, token }) {
  const response = await fetch(`/api/admin/stores/${encodeURIComponent(tenantId)}/preview-status`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  const payload = await previewJson(response);
  if (!response.ok) throw previewError(payload.error, response.status);
  return { available: payload.available === true };
}

export async function startPortalPrivatePreview({ tenantId, token }) {
  const response = await fetch(`/api/admin/stores/${encodeURIComponent(tenantId)}/preview-session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  const payload = await previewJson(response);
  if (!response.ok) throw previewError(payload.error, response.status);
  if (payload.previewUrl !== '/preview') throw previewError('preview_invalid_response', 502);
  return payload;
}

export async function revokePortalPrivatePreview(token) {
  if (!token) return;
  await fetch('/api/admin/preview-session', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  }).catch(() => {});
}
