import './merchant-theme.css';
import { accessibleTextColor, normalizeBrandColor } from '../domain/brand-colors.js';

const THEME_DEFAULTS = Object.freeze({
  'premium-dark': Object.freeze({ primary: '#8A7DFF', secondary: '#57D6A0', light: false }),
  stadium: Object.freeze({ primary: '#57D6A0', secondary: '#8A7DFF', light: false }),
  clean: Object.freeze({ primary: '#111827', secondary: '#64748B', light: true })
});
const SAFE_LOGO_PATH = /^\/brand-assets\/bas_[a-f0-9]{20}\.webp$/;

function themeDefault(themeKey) {
  return THEME_DEFAULTS[themeKey] || THEME_DEFAULTS['premium-dark'];
}

export function normalizeMerchantStoreBranding(store = {}) {
  const requestedTheme = String(store?.themeKey || '').trim().toLowerCase();
  const themeKey = Object.hasOwn(THEME_DEFAULTS, requestedTheme) ? requestedTheme : 'premium-dark';
  const fallback = themeDefault(themeKey);
  const primaryColor = normalizeBrandColor(store?.primaryColor) || fallback.primary;
  const secondaryColor = normalizeBrandColor(store?.secondaryColor) || fallback.secondary;
  const rawLogoPath = String(store?.logoPath || '').trim();

  return {
    themeKey,
    primaryColor,
    secondaryColor,
    primaryTextColor: accessibleTextColor(primaryColor) || '#FFFFFF',
    secondaryTextColor: accessibleTextColor(secondaryColor) || '#FFFFFF',
    logoPath: SAFE_LOGO_PATH.test(rawLogoPath) ? rawLogoPath : null,
    defaultLight: fallback.light
  };
}

export function applyMerchantStoreBranding(
  store,
  { root = document.documentElement, documentRef = document } = {}
) {
  if (!root || !documentRef) return null;
  const branding = normalizeMerchantStoreBranding(store);

  root.dataset.storeTheme = branding.themeKey;
  root.style.setProperty('--merchant-primary', branding.primaryColor);
  root.style.setProperty('--merchant-primary-text', branding.primaryTextColor);
  root.style.setProperty('--merchant-secondary', branding.secondaryColor);
  root.style.setProperty('--merchant-secondary-text', branding.secondaryTextColor);
  root.style.setProperty('--accent', branding.primaryColor);
  root.style.setProperty('--accent-text', branding.primaryTextColor);
  root.style.setProperty('--swiper-theme-color', branding.primaryColor);
  root.classList.toggle('light', branding.defaultLight);

  const body = documentRef.body;
  if (body) body.dataset.storeTheme = branding.themeKey;

  const themeMeta = documentRef.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', branding.defaultLight ? '#F8FAFC' : '#080A0D');
  }

  const logo = documentRef.querySelector('#storeLogo');
  const storeName = String(store?.name || documentRef.querySelector('#storeName')?.textContent || 'Loja').trim();
  if (logo && branding.logoPath) {
    logo.src = branding.logoPath;
    logo.alt = `Logo ${storeName || 'da loja'}`;
    logo.hidden = false;
  }

  return branding;
}

async function readCatalogMeta(fetchImpl = fetch) {
  const response = await fetchImpl('/api/catalog/meta', { cache: 'no-store' });
  if (!response.ok) throw new Error(`merchant_branding_meta_http_${response.status}`);
  const payload = await response.json();
  return payload?.store && typeof payload.store === 'object' ? payload.store : {};
}

function mainStoreConfigHasRendered(documentRef) {
  const storeName = documentRef.querySelector('#storeName');
  if (!storeName) return true;
  return String(storeName.textContent || '').trim() !== 'Catálogo';
}

export async function hydrateMerchantStoreBranding({
  fetchImpl = fetch,
  root = document.documentElement,
  documentRef = document,
  MutationObserverImpl = globalThis.MutationObserver,
  fallbackDelayMs = 1600
} = {}) {
  const store = await readCatalogMeta(fetchImpl);

  if (mainStoreConfigHasRendered(documentRef) || typeof MutationObserverImpl !== 'function') {
    return applyMerchantStoreBranding(store, { root, documentRef });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearTimeout(timer);
      resolve(applyMerchantStoreBranding(store, { root, documentRef }));
    };
    const target = documentRef.querySelector('#storeName');
    const observer = target
      ? new MutationObserverImpl(() => {
          if (mainStoreConfigHasRendered(documentRef)) finish();
        })
      : null;
    observer?.observe(target, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(finish, Math.max(0, Number(fallbackDelayMs) || 0));
  });
}

if (typeof document !== 'undefined') {
  void hydrateMerchantStoreBranding().catch((error) => {
    console.error('merchant_store_branding_failed', String(error?.message || error).slice(0, 96));
  });
}
