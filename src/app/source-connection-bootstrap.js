import { hydratePortalIcons } from '../ui/portal-icons.js';
import { openImportDecisionExperience } from './import-decision-experience.js';
import { requestPortalImportDecisionState } from './import-decision.js';
import { openProvisioningProgressExperience } from './provisioning-progress-experience.js';
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
  return [
    ...root.querySelectorAll('.sidebar .nav-item'),
    ...root.querySelectorAll('.mobile-nav .nav-item')
  ];
}

function ensureMobileAppearanceTarget(root) {
  const mobileButtons = [...root.querySelectorAll('.mobile-nav .nav-item')];
  if (
    mobileButtons.some((button) => button.querySelector('span')?.textContent.trim() === 'Aparência')
  ) {
    return;
  }

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

function openProgress(store) {
  if (!store?.tenantId) return;
  openProvisioningProgressExperience({
    store,
    getAccessToken: portalToken
  });
}

function openImport(store) {
  if (!store?.tenantId) return;
  openImportDecisionExperience({
    store,
    getAccessToken: portalToken,
    onDone: async () => window.location.reload()
  });
}

function openSource(store) {
  if (!store?.tenantId) return;
  openSourceConnectionExperience({
    store,
    getAccessToken: portalToken,
    onDefineImport: () => openImport(store),
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

function storeCardCopy(
  card,
  store,
  { source = null, decisionState = null, stateKnown = true } = {}
) {
  if (!card || !store?.tenantId) return;
  const bodyCopy = card.querySelector('.store-card-body p');
  const meta = card.querySelectorAll('.store-card-meta > div');
  const action = card.querySelector('.store-card-action');
  const connected = source?.status === 'active';
  const decision = decisionState?.decision || null;

  if (!stateKnown) {
    setText(
      bodyCopy,
      'Não foi possível confirmar o catálogo agora. Abra esta etapa para tentar novamente sem alterar sua loja.'
    );
    if (meta[0]) {
      setText(meta[0].querySelector('small'), 'Próximo passo');
      setText(meta[0].querySelector('strong'), 'Consultar catálogo');
    }
    if (meta[1]) {
      setText(meta[1].querySelector('small'), 'Jornada');
      setText(meta[1].querySelector('strong'), 'Marca ✓ → fonte → importação → preview');
    }
    if (action) {
      setText(action.querySelector('span'), 'Abrir catálogo');
      action.title = `Consultar catálogo de ${store.storeName || 'sua loja'}`;
    }
    card.dataset.catalogAction = 'source';
  } else if (connected && decision) {
    setText(
      bodyCopy,
      'Fonte conectada e importação confirmada. A preparação continua em segundo plano e você pode acompanhar o estado real sem manter esta tela aberta.'
    );
    if (meta[0]) {
      setText(meta[0].querySelector('small'), 'Andamento');
      setText(meta[0].querySelector('strong'), 'Preparando catálogo');
    }
    if (meta[1]) {
      setText(meta[1].querySelector('small'), 'Jornada');
      setText(meta[1].querySelector('strong'), 'Marca ✓ → fonte ✓ → importação ✓ → preparação → preview');
    }
    if (action) {
      setText(action.querySelector('span'), 'Ver andamento');
      action.title = `Ver andamento do catálogo de ${store.storeName || 'sua loja'}`;
    }
    card.dataset.catalogAction = 'progress';
  } else if (connected) {
    setText(
      bodyCopy,
      'Fonte conectada. Agora escolha como a primeira importação deve usar esse catálogo.'
    );
    if (meta[0]) {
      setText(meta[0].querySelector('small'), 'Próximo passo');
      setText(meta[0].querySelector('strong'), 'Definir importação');
    }
    if (meta[1]) {
      setText(meta[1].querySelector('small'), 'Jornada');
      setText(meta[1].querySelector('strong'), 'Marca ✓ → fonte ✓ → importação → preview');
    }
    if (action) {
      setText(action.querySelector('span'), 'Definir importação');
      action.title = `Definir importação de ${store.storeName || 'sua loja'}`;
    }
    card.dataset.catalogAction = 'import';
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
      setText(meta[1].querySelector('strong'), 'Marca ✓ → fonte → importação → preview');
    }
    if (action) {
      setText(action.querySelector('span'), 'Conectar catálogo');
      action.title = `Conectar catálogo de ${store.storeName || 'sua loja'}`;
    }
    card.dataset.catalogAction = 'source';
  }

  if (action) {
    action.disabled = false;
    if (action.dataset.sourceWired !== '1') {
      action.dataset.sourceWired = '1';
      action.addEventListener('click', () => {
        if (card.dataset.catalogAction === 'progress') openProgress(store);
        else if (card.dataset.catalogAction === 'import') openImport(store);
        else openSource(store);
      });
    }
  }
  card.dataset.sourceState = !stateKnown ? 'unknown' : connected ? 'connected' : 'empty';
  card.dataset.importDecisionState = decision ? 'confirmed' : 'pending';
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
        try {
          const source = await requestPortalSourceState({ tenantId: store.tenantId, token });
          const decisionState = source?.status === 'active'
            ? await requestPortalImportDecisionState({ tenantId: store.tenantId, token })
            : null;
          storeCardCopy(card, store, { source, decisionState, stateKnown: true });
        } catch {
          // Background refresh failure is not equivalent to "no source" or
          // "no decision". Keep the card actionable and let the explicit flow own retry.
          storeCardCopy(card, store, { source: null, decisionState: null, stateKnown: false });
        }
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
