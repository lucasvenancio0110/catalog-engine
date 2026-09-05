import { openBrandingExperience } from './branding-experience.js';
import { hydratePortalIcons } from '../ui/portal-icons.js';

async function portalToken() {
  const provider = window.__CATALOG_ENGINE_AUTH__;
  if (!provider || typeof provider.getAccessToken !== 'function') return null;
  return provider.getAccessToken();
}

async function portalSession() {
  const token = await portalToken();
  if (!token) return null;
  const response = await fetch('/api/admin/session', {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!response.ok) return null;
  return response.json();
}

function openAppearance(store) {
  if (!store?.tenantId) return;
  openBrandingExperience({
    store,
    getAccessToken: portalToken,
    onDone: async () => window.location.reload()
  });
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function strategicPortalCopy(root, session) {
  const stores = Array.isArray(session?.stores) ? session.stores : [];
  if (!stores.length) return;

  setText(
    root.querySelector('.page-header p'),
    'Gerencie sua operação, acompanhe a evolução do catálogo e avance sua loja até a publicação.'
  );
  const allowance = session?.entitlements;
  if (allowance) {
    const used = Number(allowance.usedStores ?? stores.length);
    const maximum = Number(allowance.maxStores ?? stores.length);
    if (Number.isFinite(used) && Number.isFinite(maximum)) {
      setText(root.querySelector('.account-summary small'), `Acesso beta · ${used} de ${maximum}`);
    }
  }

  const values = root.querySelectorAll('.value-strip strong');
  setText(values[0], 'Importação inicial automatizada');
  setText(values[1], 'Inteligência para estruturar o catálogo');
  setText(values[2], 'Sua marca no seu próprio domínio');
}

function appearanceButtons(root) {
  return [
    ...root.querySelectorAll('.sidebar .nav-item'),
    ...root.querySelectorAll('.mobile-nav .nav-item')
  ].filter((button) => button.querySelector('span')?.textContent.trim() === 'Aparência');
}

function wireAppearanceNavigation(root, store) {
  if (!store?.tenantId) return;
  for (const button of appearanceButtons(root)) {
    const icon = button.querySelector('[data-lucide]');
    if (icon) icon.dataset.lucide = 'palette';
    button.disabled = false;
    button.title = 'Personalizar aparência da loja';
    if (button.dataset.brandingWired !== '1') {
      button.dataset.brandingWired = '1';
      button.addEventListener('click', () => openAppearance(store));
    }
  }
  hydratePortalIcons(root);
}

let enhancementInFlight = false;

export async function enhancePortalBranding(root = document.querySelector('#app')) {
  if (!root || enhancementInFlight || !root.querySelector('.store-card')) return 0;
  const targets = appearanceButtons(root);
  if (targets.length && targets.every((button) => button.dataset.brandingWired === '1')) return 0;
  enhancementInFlight = true;
  try {
    const session = await portalSession();
    const stores = Array.isArray(session?.stores) ? session.stores : [];
    if (!stores.length) return 0;
    strategicPortalCopy(root, session);
    wireAppearanceNavigation(root, stores[0]);
    return stores.length;
  } finally {
    enhancementInFlight = false;
  }
}

const root = document.querySelector('#app');
if (root) {
  enhancePortalBranding(root);
  const observer = new MutationObserver(() => enhancePortalBranding(root));
  observer.observe(root, { childList: true, subtree: true });
}
