import { hydratePortalIcons } from '../ui/portal-icons.js';
import { openSourceConnectionExperience } from './source-connection-experience.js';
import { requestPortalSourceState } from './source-connection.js';

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

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function navButtons(root) {
  return [...root.querySelectorAll('.sidebar .nav-item'), ...root.querySelectorAll('.mobile-nav .nav-item')];
}

function ensureMobileAppearanceTarget(root) {
  const mobileButtons = [...root.querySelectorAll('.mobile-nav .nav-item')];
  if (mobileButtons.some((button) => button.querySelector('span')?.textContent.trim() === 'Aparência')) return;

  const futureDomain = mobileButtons.find(
    (button) => button.querySelector('span')?.textContent.trim() === 'Domínio'
  );
  if (!futureDomain) return;
  setText(futureDomain.querySelector('span'), 'Aparência');
  const icon = futureDomain.querySelector('[data-lucide]');
  if (icon) icon.dataset.lucide = 'palette';
  futureDomain.title = 'Personalizar aparência da loja';
  hydratePortalIcons(root);
}

function openSource(store) {
  if (!store?.tenantId) return;
  openSourceConnectionExperience({
    store,
    getAccessToken: portalToken,
    onDone: async () => window.location.reload()
  });
}

function wireCatalogNavigation(root, store) {
  if (!store?.tenantId) return;
  for (const button of navButtons(root)) {
    if (button.querySelector('span')?.textContent.trim() !== 'Catálogo') continue;
    button.disabled = false;
    button.title = 'Conectar ou consultar a fonte do catálogo';
    if (button.dataset.sourceWired !== '1') {
      button.dataset.sourceWired = '1';
      button.addEventListener('click', () => openSource(store));
    }
  }
}

function storeCardCopy(card, store, source) {
  if (!card || !store?.tenantId) return;
  const bodyCopy = card.querySelector('.store-card-body p');
  const meta = card.querySelectorAll('.store-card-meta > div');
  const action = card.querySelector('.store-card-action');

  if (source) {
    setText(
      bodyCopy,
      'Fonte conectada. O Catalog Engine já reconheceu seu catálogo e está preparando os próximos passos.'
    );
    if (meta[0]) {
      setText(meta[0].querySelector('small'), 'Próximo passo');
      setText(meta[0].querySelector('strong'), 'Definir importação');
    }
    if (meta[1]) {
      setText(meta[1].querySelector('small'), 'Jornada');
      setText(meta[1].querySelector('strong'), 'Marca ✓ → catálogo ✓ → preview');
    }
    if (action) {
      setText(action.querySelector('span'), 'Ver conexão');
      action.title = `Ver fonte do catálogo de ${store.storeName || 'sua loja'}`;
    }
  } else {
    setText(
      bodyCopy,
      'Sua identidade está pronta. Agora conecte a fonte dos produtos para avançar.'
    );
    if (meta[0]) {
      setText(meta[0].querySelector('small'), 'Próximo passo');
      setText(meta[0].querySelector('strong'), 'Conectar catálogo');
    }
    if (meta[1]) {
      setText(meta[1].querySelector('small'), 'Jornada');
      setText(meta[1].querySelector('strong'), 'Marca ✓ → catálogo → preview');
    }
    if (action) {
      setText(action.querySelector('span'), 'Conectar catálogo');
      action.title = `Conectar catálogo de ${store.storeName || 'sua loja'}`;
    }
  }

  if (action) {
    action.disabled = false;
    if (action.dataset.sourceWired !== '1') {
      action.dataset.sourceWired = '1';
      action.addEventListener('click', () => openSource(store));
    }
  }
  card.dataset.sourceState = source ? 'connected' : 'empty';
}

let enhancementInFlight = false;

export async function enhancePortalSourceConnection(root = document.querySelector('#app')) {
  if (!root || enhancementInFlight || !root.querySelector('.store-card')) return 0;
  const cards = [...root.querySelectorAll('.store-card')];
  if (cards.length && cards.every((card) => card.dataset.sourceWired === '1')) return 0;

  enhancementInFlight = true;
  try {
    const [session, token] = await Promise.all([portalSession(), portalToken()]);
    const stores = Array.isArray(session?.stores) ? session.stores : [];
    if (!stores.length || !token) return 0;

    ensureMobileAppearanceTarget(root);
    wireCatalogNavigation(root, stores[0]);

    await Promise.all(
      cards.map(async (card, index) => {
        const store = stores[index];
        if (!store?.tenantId) return;
        let source = null;
        try {
          source = await requestPortalSourceState({ tenantId: store.tenantId, token });
        } catch {
          // The dialog owns the customer-facing retry/error state. Keep the card actionable
          // without exposing transport/provider detail from the background enhancement.
        }
        storeCardCopy(card, store, source);
        card.dataset.sourceWired = '1';
      })
    );

    hydratePortalIcons(root);
    return stores.length;
  } finally {
    enhancementInFlight = false;
  }
}

const root = document.querySelector('#app');
if (root) {
  enhancePortalSourceConnection(root);
  const observer = new MutationObserver(() => enhancePortalSourceConnection(root));
  observer.observe(root, { childList: true, subtree: true });
}
