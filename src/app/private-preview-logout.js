import { revokePortalPrivatePreview } from './private-preview.js';

async function portalToken() {
  const provider = window.__CATALOG_ENGINE_AUTH__;
  if (!provider || typeof provider.getAccessToken !== 'function') return null;
  try {
    return await provider.getAccessToken();
  } catch {
    return null;
  }
}

const root = document.querySelector('#app');
if (root) {
  root.addEventListener(
    'click',
    async (event) => {
      const button = event.target instanceof Element ? event.target.closest('.logout-button') : null;
      if (!button) return;
      const provider = window.__CATALOG_ENGINE_AUTH__;
      if (!provider || typeof provider.logout !== 'function') return;

      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      const token = await portalToken();
      await revokePortalPrivatePreview(token);
      await provider.logout();
    },
    true
  );
}
