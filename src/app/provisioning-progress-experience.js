import PQueue from 'p-queue';
import './provisioning-progress-styles.css';
import { accessibleTextColor, normalizeBrandColor } from '../domain/brand-colors.js';
import {
  choosePreviewAuthority,
  realConstructionCount,
  requestPortalConstructionMedia,
  requestPortalConstructionPreview
} from './construction-preview.js';
import { portalApiErrorMessage, portalInitials } from './portal-model.js';
import {
  requestPortalPrivatePreviewStatus,
  startPortalPrivatePreview
} from './private-preview.js';
import {
  PortalProvisioningProgressError,
  requestPortalProvisioningProgress
} from './provisioning-progress.js';

const SAFE_LOGO_PATH = /^\/brand-assets\/bas_[a-f0-9]{20}\.webp$/;
const THEME_DEFAULTS = Object.freeze({
  'premium-dark': Object.freeze({ primary: '#8A7DFF', secondary: '#57D6A0', light: false }),
  stadium: Object.freeze({ primary: '#57D6A0', secondary: '#8A7DFF', light: false }),
  clean: Object.freeze({ primary: '#111827', secondary: '#64748B', light: true })
});

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.type) node.type = options.type;
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function errorMessage(error) {
  const code = error instanceof PortalProvisioningProgressError ? error.code : 'progress_state_unavailable';
  if (code === 'progress_state_unavailable') {
    return 'Não foi possível atualizar agora. O último estado confirmado da sua loja foi preservado.';
  }
  if (code === 'progress_state_invalid') {
    return 'O estado recebido não pôde ser confirmado com segurança. O último estado válido foi preservado.';
  }
  return portalApiErrorMessage(code);
}

function normalizeBranding(profile, store) {
  const requestedTheme = String(profile?.themeKey || store?.themeKey || '').trim().toLowerCase();
  const themeKey = Object.hasOwn(THEME_DEFAULTS, requestedTheme) ? requestedTheme : 'premium-dark';
  const defaults = THEME_DEFAULTS[themeKey];
  const primaryColor = normalizeBrandColor(profile?.primaryColor) || defaults.primary;
  const secondaryColor = normalizeBrandColor(profile?.secondaryColor) || defaults.secondary;
  const rawLogo = String(profile?.logoPath || '').trim();
  return {
    themeKey,
    primaryColor,
    secondaryColor,
    primaryTextColor: accessibleTextColor(primaryColor) || '#FFFFFF',
    logoPath: SAFE_LOGO_PATH.test(rawLogo) ? rawLogo : null,
    storeName: String(profile?.storeName || store?.storeName || 'Sua loja').trim() || 'Sua loja',
    light: defaults.light
  };
}

async function requestBranding({ tenantId, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`/api/admin/stores/${tenantId}/branding`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  try {
    const payload = await response.json();
    return payload?.profile || null;
  } catch {
    return null;
  }
}

function applyBranding(overlay, brand) {
  overlay.dataset.creationTheme = brand.themeKey;
  overlay.classList.toggle('progress-overlay--light', brand.light);
  overlay.style.setProperty('--creation-primary', brand.primaryColor);
  overlay.style.setProperty('--creation-primary-text', brand.primaryTextColor);
  overlay.style.setProperty('--creation-secondary', brand.secondaryColor);
}

function countPresentation(progress, construction) {
  const constructionCount = realConstructionCount(construction);
  if (constructionCount > 0) {
    return {
      value: constructionCount,
      label: constructionCount === 1 ? 'produto disponível' : 'produtos disponíveis'
    };
  }
  const counters = progress?.counters || {};
  if (Number(counters.discovered) > 0) {
    return {
      value: Number(counters.discovered),
      label: Number(counters.discovered) === 1 ? 'produto encontrado' : 'produtos encontrados'
    };
  }
  if (Number(counters.total) > 0) {
    return {
      value: Number(counters.total),
      label: Number(counters.total) === 1 ? 'produto no catálogo' : 'produtos no catálogo'
    };
  }
  if (Number(counters.checked) > 0) {
    return {
      value: Number(counters.checked),
      label: Number(counters.checked) === 1 ? 'produto conferido' : 'produtos conferidos'
    };
  }
  return null;
}

function customerJourney(progress, construction, authority) {
  const stage = progress.stage;
  const sourceReady = stage !== 'source';
  const constructionCount = realConstructionCount(construction);
  const productsFound = constructionCount > 0 || Number(progress.counters?.discovered || 0) > 0 ||
    ['importing', 'finalizing', 'organizing', 'checking', 'ready'].includes(stage);
  const canVisualize = Boolean(authority);
  const items = [
    ['Identidade criada', true, false],
    ['Fonte conectada', sourceReady, stage === 'source'],
    ['Encontrando produtos', productsFound, sourceReady && !productsFound],
    ['Preparando sua vitrine', canVisualize, productsFound && !canVisualize],
    ['Sua loja já pode ser visualizada', canVisualize, false]
  ];

  return items.map(([label, done, current]) => ({
    label,
    state: done ? 'done' : current ? 'current' : 'future'
  }));
}

function journeyView(progress, construction, authority) {
  const list = el('ol', { className: 'progress-journey' });
  for (const item of customerJourney(progress, construction, authority)) {
    const node = el('li', { className: `progress-journey-item progress-journey-item--${item.state}` }, [
      el('span', { className: 'progress-journey-mark', text: item.state === 'done' ? '✓' : item.state === 'current' ? '●' : '○' }),
      el('span', { text: item.label })
    ]);
    if (item.state === 'current') node.setAttribute('aria-current', 'step');
    list.append(node);
  }
  return list;
}

function retryNote(progress) {
  if (progress.retry?.kind !== 'automatic') return null;
  return el('div', { className: 'progress-retry-note' }, [
    el('strong', { text: 'Nova tentativa automática programada' }),
    el('span', { text: 'Você não precisa repetir a importação nem recriar sua loja.' })
  ]);
}

function updatedLabel(progress, construction) {
  const value = construction?.updatedAt || progress.updatedAt;
  if (!value) return 'Estado salvo no Catalog Engine';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Estado salvo no Catalog Engine';
  return `Atualizado às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function brandMark(brand) {
  const mark = brand.logoPath
    ? el('img', { className: 'progress-brand-logo' })
    : el('span', { className: 'progress-brand-initials', text: portalInitials(brand.storeName) });
  if (brand.logoPath && mark instanceof HTMLImageElement) {
    mark.src = brand.logoPath;
    mark.alt = `Logo ${brand.storeName}`;
  }
  return mark;
}

function loadingView(brand, hasPrevious) {
  return el('div', { className: 'progress-loading' }, [
    el('div', { className: 'progress-orbit', ariaLabel: 'Preparando loja' }, [
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--one' }),
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--two' }),
      el('div', { className: 'progress-brand-mark' }, [brandMark(brand)])
    ]),
    el('span', { className: 'progress-kicker', text: brand.storeName }),
    el('h2', { text: hasPrevious ? 'Atualizando sua loja…' : 'Estamos montando sua loja.' }),
    el('p', { text: hasPrevious ? 'Mantendo o último estado real enquanto buscamos novidades.' : 'Conectando os checkpoints reais da criação.' })
  ]);
}

function previewMessage(progress, construction, authority) {
  if (authority === 'verified') {
    return 'A visualização privada já passou pelas verificações atuais. Você pode entrar na loja agora.';
  }
  if (authority === 'construction') {
    const count = realConstructionCount(construction);
    return `${count.toLocaleString('pt-BR')} produtos reais já estão disponíveis. Continuamos adicionando e organizando o restante.`;
  }
  return progress.message;
}

function progressView({ progress, brand, construction, authority, onOpenPreview }) {
  const count = countPresentation(progress, construction);
  const viewable = Boolean(authority);
  const attention = progress.status === 'attention' && !viewable;
  const content = el('div', { className: `progress-content progress-content--${attention ? 'attention' : viewable ? 'complete' : 'running'}` }, [
    el('div', { className: 'progress-orbit progress-orbit--live' }, [
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--one' }),
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--two' }),
      el('div', { className: 'progress-brand-mark' }, [brandMark(brand)])
    ]),
    el('span', { className: 'progress-kicker', text: brand.storeName }),
    el('h2', {
      text: authority === 'verified'
        ? 'Sua loja está pronta para visualizar.'
        : authority === 'construction'
          ? 'Sua loja já está aparecendo.'
          : attention
            ? 'Sua loja continua preservada.'
            : 'Estamos montando sua loja.'
    }),
    el('p', { className: 'progress-message', text: previewMessage(progress, construction, authority) })
  ]);

  if (count) {
    content.append(
      el('div', { className: 'progress-live-count', ariaLabel: `${count.value} ${count.label}` }, [
        el('strong', { text: count.value.toLocaleString('pt-BR') }),
        el('span', { text: count.label })
      ])
    );
  }

  content.append(journeyView(progress, construction, authority));
  const retry = retryNote(progress);
  if (retry) content.append(retry);

  if (viewable) {
    const open = el('button', {
      className: 'progress-open-store',
      type: 'button',
      text: authority === 'verified' ? 'Ver minha loja' : 'Ver loja em construção'
    });
    open.addEventListener('click', onOpenPreview);
    content.append(
      el('div', { className: 'progress-ready-action' }, [
        open,
        el('span', {
          text: authority === 'verified'
            ? 'Esta é a visualização privada verificada. Domínio e publicação continuam separados.'
            : 'Prévia privada em construção: os produtos continuam sendo adicionados e organizados. Domínio e publicação continuam separados.'
        })
      ])
    );
  } else {
    content.append(
      el('div', { className: 'progress-safety-note' }, [
        el('strong', { text: 'Você não precisa ficar nesta tela.' }),
        el('span', { text: 'O progresso é salvo no servidor. Pode sair e voltar quando quiser.' })
      ])
    );
  }

  content.append(el('small', { className: 'progress-updated', text: updatedLabel(progress, construction) }));
  return content;
}

function constructionCard(product) {
  const media = el('div', { className: 'construction-card-media' }, [
    el('span', { className: 'construction-card-placeholder', text: product.coverMediaId ? 'Carregando imagem…' : 'Imagem ainda não disponível' })
  ]);
  if (product.coverMediaId) media.dataset.mediaId = product.coverMediaId;
  const card = el('article', { className: 'construction-card' }, [
    media,
    el('div', { className: 'construction-card-copy' }, [
      el('span', { className: 'construction-card-status', text: 'Produto encontrado' }),
      el('h3', { text: product.title }),
      el('p', { text: 'Detalhes e organização continuam sendo preparados.' })
    ])
  ]);
  card.dataset.productId = product.id;
  return card;
}

function constructionStorefrontView({ construction, brand, onBack }) {
  const back = el('button', {
    className: 'construction-back',
    type: 'button',
    text: 'Voltar para criação'
  });
  back.addEventListener('click', onBack);
  const count = realConstructionCount(construction);
  const grid = el('div', { className: 'construction-grid', ariaLabel: 'Produtos disponíveis na prévia em construção' });
  for (const product of construction.products) grid.append(constructionCard(product));
  return el('section', { className: 'construction-storefront' }, [
    el('div', { className: 'construction-storefront-top' }, [
      back,
      el('div', { className: 'construction-storefront-brand' }, [brandMark(brand), el('strong', { text: brand.storeName })])
    ]),
    el('div', { className: 'construction-storefront-hero' }, [
      el('span', { className: 'progress-kicker', text: 'Prévia privada em construção' }),
      el('h2', { text: 'Sua loja já está ganhando forma.' }),
      el('p', { text: `${count.toLocaleString('pt-BR')} produtos reais já estão disponíveis. Continuamos adicionando e organizando o restante.` })
    ]),
    grid,
    el('p', { className: 'construction-storefront-note', text: 'Esta prévia ainda não é a versão verificada nem uma publicação pública.' })
  ]);
}

function focusableElements(panel) {
  return [...panel.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(
    (node) => !node.hidden
  );
}

export async function openProvisioningProgressExperience({ store, getAccessToken, onDone }) {
  if (!store?.tenantId || typeof getAccessToken !== 'function') return;
  const previousFocus = document.activeElement;
  const overlay = el('div', { className: 'progress-overlay' });
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Criação da loja ${store.storeName || 'sua loja'}`);

  let brand = normalizeBranding(null, store);
  applyBranding(overlay, brand);

  const panel = el('section', { className: 'progress-panel' });
  const closeButton = el('button', {
    className: 'progress-close',
    type: 'button',
    text: 'Sair',
    ariaLabel: 'Sair da tela de criação da loja'
  });
  const body = el('div', { className: 'progress-panel-body' });
  const transientError = el('div', { className: 'progress-transient-error' });
  transientError.hidden = true;
  transientError.setAttribute('role', 'status');

  let closed = false;
  let lastProgress = null;
  let construction = null;
  let verifiedReady = false;
  let timer = null;
  let failureCount = 0;
  let requestInFlight = false;
  let brandingLoaded = false;
  let viewMode = 'progress';
  let mediaGeneration = 0;
  const mediaObjectUrls = new Set();

  function authority() {
    return choosePreviewAuthority({ verifiedReady, construction });
  }

  function clearConstructionMedia() {
    mediaGeneration += 1;
    for (const url of mediaObjectUrls) URL.revokeObjectURL(url);
    mediaObjectUrls.clear();
  }

  async function openVerifiedPreview() {
    const button = panel.querySelector('.progress-open-store');
    if (button) {
      button.disabled = true;
      button.textContent = 'Abrindo sua loja…';
    }
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('preview_auth_required');
      const session = await startPortalPrivatePreview({ tenantId: store.tenantId, token });
      window.location.assign(session.previewUrl);
    } catch {
      if (button) {
        button.disabled = false;
        button.textContent = 'Tentar abrir novamente';
      }
      transientError.textContent = 'Sua loja está pronta, mas não conseguimos abrir o preview agora. Tente novamente.';
      transientError.hidden = false;
    }
  }

  function render(progress = lastProgress) {
    if (!progress || viewMode !== 'progress') return;
    lastProgress = progress;
    body.classList.remove('progress-panel-body--storefront');
    body.replaceChildren(progressView({
      progress,
      brand,
      construction,
      authority: authority(),
      onOpenPreview: openCurrentPreview
    }));
  }

  async function loadConstructionMedia(snapshot) {
    const token = await getAccessToken();
    if (!token || closed || viewMode !== 'construction') return;
    const generation = mediaGeneration;
    const queue = new PQueue({ concurrency: 3 });
    const tasks = snapshot.products
      .filter((product) => product.coverMediaId)
      .map((product) => queue.add(async () => {
        const target = body.querySelector(`[data-product-id="${product.id}"] .construction-card-media`);
        if (!target) return;
        try {
          const blob = await requestPortalConstructionMedia({
            tenantId: store.tenantId,
            mediaId: product.coverMediaId,
            token
          });
          if (closed || viewMode !== 'construction' || generation !== mediaGeneration || !target.isConnected) return;
          const objectUrl = URL.createObjectURL(blob);
          mediaObjectUrls.add(objectUrl);
          const image = el('img', { className: 'construction-card-image' });
          image.src = objectUrl;
          image.alt = `Imagem de ${product.title}`;
          image.loading = 'lazy';
          target.replaceChildren(image);
        } catch {
          if (target.isConnected) {
            target.replaceChildren(el('span', { className: 'construction-card-placeholder', text: 'Imagem indisponível' }));
          }
        }
      }));
    await Promise.allSettled(tasks);
  }

  async function openConstructionPreview() {
    if (!construction?.ready) return;
    viewMode = 'construction';
    clearConstructionMedia();
    const snapshot = construction;
    body.classList.add('progress-panel-body--storefront');
    body.replaceChildren(constructionStorefrontView({
      construction: snapshot,
      brand,
      onBack: () => {
        clearConstructionMedia();
        viewMode = 'progress';
        render();
        panel.querySelector('.progress-open-store')?.focus();
      }
    }));
    body.querySelector('.construction-back')?.focus();
    loadConstructionMedia(snapshot).catch(() => {});
  }

  async function openCurrentPreview() {
    if (authority() === 'verified') return openVerifiedPreview();
    return openConstructionPreview();
  }

  function schedule(delay) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, Math.min(Math.max(Number(delay) || 2500, 1500), 30000));
  }

  async function refresh() {
    if (closed || requestInFlight || document.hidden) return;
    requestInFlight = true;
    transientError.hidden = true;
    if (!lastProgress && viewMode === 'progress') body.replaceChildren(loadingView(brand, false));
    try {
      const token = await getAccessToken();
      if (!token) throw new PortalProvisioningProgressError('unauthorized', 401);
      const constructionWork = requestPortalConstructionPreview({ tenantId: store.tenantId, token })
        .catch(() => construction);
      const work = [
        requestPortalProvisioningProgress({ tenantId: store.tenantId, token }),
        constructionWork
      ];
      if (!brandingLoaded) work.push(requestBranding({ tenantId: store.tenantId, token }));
      const [progress, nextConstruction, profile] = await Promise.all(work);
      construction = nextConstruction || construction;
      if (!brandingLoaded) {
        brand = normalizeBranding(profile, store);
        brandingLoaded = true;
        applyBranding(overlay, brand);
      }

      verifiedReady = false;
      if (progress.stage === 'ready' && progress.status === 'complete') {
        try {
          const preview = await requestPortalPrivatePreviewStatus({ tenantId: store.tenantId, token });
          verifiedReady = preview.available === true;
        } catch {
          verifiedReady = false;
        }
      }

      failureCount = 0;
      lastProgress = progress;
      render(progress);
      const nextDelay = authority()
        ? 8000
        : construction?.readiness === 'indexed'
          ? 1800
          : Math.min(progress.pollAfterMs, 2200);
      schedule(nextDelay);
    } catch (error) {
      failureCount += 1;
      if (lastProgress) {
        transientError.textContent = errorMessage(error);
        transientError.hidden = false;
      } else if (viewMode === 'progress') {
        body.replaceChildren(
          el('div', { className: 'progress-content progress-content--attention' }, [
            el('span', { className: 'progress-kicker', text: brand.storeName }),
            el('h2', { text: 'Sua criação continua preservada.' }),
            el('p', { className: 'progress-message', text: errorMessage(error) }),
            el('button', { className: 'progress-retry-button', type: 'button', text: 'Tentar novamente' })
          ])
        );
        body.querySelector('.progress-retry-button')?.addEventListener('click', refresh);
      }
      schedule(Math.min(5000 * 2 ** Math.min(failureCount, 2), 20000));
    } finally {
      requestInFlight = false;
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearConstructionMedia();
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    overlay.remove();
    document.documentElement.classList.remove('progress-dialog-open');
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    if (typeof onDone === 'function') await onDone(lastProgress);
  }

  function onVisibilityChange() {
    if (!document.hidden && !closed) refresh();
    if (document.hidden) clearTimeout(timer);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (viewMode === 'construction') {
        clearConstructionMedia();
        viewMode = 'progress';
        render();
        panel.querySelector('.progress-open-store')?.focus();
      } else {
        close();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(panel);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', onVisibilityChange);

  panel.append(
    el('header', { className: 'progress-header' }, [
      el('div', { className: 'progress-header-copy' }, [
        el('span', { className: 'progress-header-signal', text: 'Catalog Engine' }),
        el('strong', { text: 'Criando sua loja' })
      ]),
      closeButton
    ]),
    transientError,
    body
  );
  overlay.append(panel);
  document.body.append(overlay);
  document.documentElement.classList.add('progress-dialog-open');
  closeButton.focus();
  body.replaceChildren(loadingView(brand, false));
  await refresh();
}
