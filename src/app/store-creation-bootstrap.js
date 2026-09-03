import './store-creation-styles.css';
import { openPortalStoreCreationPanel } from './store-creation-panel.js';

const CREATE_STORE_LABELS = new Set(['Criar minha primeira loja', 'Nova loja']);

async function portalToken() {
  const provider = window.__CATALOG_ENGINE_AUTH__;
  if (!provider || typeof provider.getAccessToken !== 'function') return null;
  return provider.getAccessToken();
}

async function refreshAfterCreation() {
  window.location.reload();
}

async function resetUnauthorizedSession() {
  const provider = window.__CATALOG_ENGINE_AUTH__;
  if (provider && typeof provider.handleUnauthorized === 'function') {
    await provider.handleUnauthorized();
  }
  window.location.reload();
}

function openCreateStore() {
  openPortalStoreCreationPanel({
    tokenProvider: portalToken,
    onCreated: refreshAfterCreation,
    onUnauthorized: resetUnauthorizedSession
  });
}

export function wirePortalStoreCreation(root = document.querySelector('#app')) {
  if (!root) return 0;
  let wired = 0;
  for (const button of root.querySelectorAll('button')) {
    if (!CREATE_STORE_LABELS.has(button.textContent.trim())) continue;
    if (button.disabled || button.dataset.storeCreationWired === '1') continue;
    button.dataset.storeCreationWired = '1';
    button.addEventListener('click', openCreateStore);
    wired += 1;
  }
  return wired;
}

const root = document.querySelector('#app');
if (root) {
  wirePortalStoreCreation(root);
  const observer = new MutationObserver(() => wirePortalStoreCreation(root));
  observer.observe(root, { childList: true, subtree: true });
}
