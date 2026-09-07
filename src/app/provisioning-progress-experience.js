import './provisioning-progress-styles.css';
import { accessibleTextColor, normalizeBrandColor } from '../domain/brand-colors.js';
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

function countPresentation(progress) {
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

function customerJourney(progress, previewReady) {
  const stage = progress.stage;
  const sourceReady = stage !== 'source';
  const productsFound = Number(progress.counters?.discovered || 0) > 0 ||
    ['importing', 'finalizing', 'organizing', 'checking', 'ready'].includes(stage);
  const preparingStore = ['organizing', 'checking', 'ready'].includes(stage);
  const items = [
    ['Identidade criada', true, false],
    ['Fonte conectada', sourceReady, stage === 'source'],
    ['Encontrando produtos', productsFound, sourceReady && !productsFound],
    ['Preparando sua vitrine', previewReady, productsFound && !previewReady],
    ['Sua loja está pronta', previewReady, false]
  ];

  return items.map(([label, done, current], index) => ({
    label,
    state: done ? 'done' : current || (index === 3 && preparingStore && !previewReady) ? 'current' : 'future'
  }));
}

function journeyView(progress, previewReady) {
  const list = el('ol', { className: 'progress-journey' });
  for (const item of customerJourney(progress, previewReady)) {
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

function updatedLabel(progress) {
  if (!progress.updatedAt) return 'Estado salvo no Catalog Engine';
  const date = new Date(progress.updatedAt);
  if (Number.isNaN(date.getTime())) return 'Estado salvo no Catalog Engine';
  return `Atualizado às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function loadingView(brand, hasPrevious) {
  const mark = brand.logoPath
    ? el('img', { className: 'progress-brand-logo' })
    : el('span', { className: 'progress-brand-initials', text: portalInitials(brand.storeName) });
  if (brand.logoPath && mark instanceof HTMLImageElement) {
    mark.src = brand.logoPath;
    mark.alt = `Logo ${brand.storeName}`;
  }
  return el('div', { className: 'progress-loading' }, [
    el('div', { className: 'progress-orbit', ariaLabel: 'Preparando loja' }, [
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--one' }),
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--two' }),
      el('div', { className: 'progress-brand-mark' }, [mark])
    ]),
    el('span', { className: 'progress-kicker', text: brand.storeName }),
    el('h2', { text: hasPrevious ? 'Atualizando sua loja…' : 'Estamos montando sua loja.' }),
    el('p', { text: hasPrevious ? 'Mantendo o último estado real enquanto buscamos novidades.' : 'Conectando os checkpoints reais da criação.' })
  ]);
}

function progressView({ progress, brand, previewReady, onOpenPreview }) {
  const count = countPresentation(progress);
  const complete = previewReady;
  const attention = progress.status === 'attention';
  const mark = brand.logoPath
    ? el('img', { className: 'progress-brand-logo' })
    : el('span', { className: 'progress-brand-initials', text: portalInitials(brand.storeName) });
  if (brand.logoPath && mark instanceof HTMLImageElement) {
    mark.src = brand.logoPath;
    mark.alt = `Logo ${brand.storeName}`;
  }

  const content = el('div', { className: `progress-content progress-content--${attention ? 'attention' : complete ? 'complete' : 'running'}` }, [
    el('div', { className: 'progress-orbit progress-orbit--live' }, [
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--one' }),
      el('span', { className: 'progress-orbit-ring progress-orbit-ring--two' }),
      el('div', { className: 'progress-brand-mark' }, [mark])
    ]),
    el('span', { className: 'progress-kicker', text: brand.storeName }),
    el('h2', { text: complete ? 'Sua loja está pronta para visualizar.' : attention ? 'Sua loja continua preservada.' : 'Estamos montando sua loja.' }),
    el('p', {
      className: 'progress-message',
      text: complete
        ? 'A visualização privada já passou pelas verificações atuais. Você pode entrar na loja agora.'
        : progress.message
    })
  ]);

  if (count) {
    content.append(
      el('div', { className: 'progress-live-count', ariaLabel: `${count.value} ${count.label}` }, [
        el('strong', { text: count.value.toLocaleString('pt-BR') }),
        el('span', { text: count.label })
      ])
    );
  }

  content.append(journeyView(progress, previewReady));
  const retry = retryNote(progress);
  if (retry) content.append(retry);

  if (complete) {
    const open = el('button', {
      className: 'progress-open-store',
      type: 'button',
      text: 'Ver minha loja'
    });
    open.addEventListener('click', onOpenPreview);
    content.append(
      el('div', { className: 'progress-ready-action' }, [
        open,
        el('span', { text: 'Esta é a visualização privada. Domínio e publicação continuam separados.' })
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

  content.append(el('small', { className: 'progress-updated', text: updatedLabel(progress) }));
  return content;
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
  let previewReady = false;
  let timer = null;
  let failureCount = 0;
  let requestInFlight = false;
  let brandingLoaded = false;

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

  function render(progress) {
    lastProgress = progress;
    body.replaceChildren(progressView({
      progress,
      brand,
      previewReady,
      onOpenPreview: openVerifiedPreview
    }));
  }

  function schedule(delay) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, Math.min(Math.max(Number(delay) || 8000, 5000), 30000));
  }

  async function refresh() {
    if (closed || requestInFlight || document.hidden) return;
    requestInFlight = true;
    transientError.hidden = true;
    if (!lastProgress) body.replaceChildren(loadingView(brand, false));
    try {
      const token = await getAccessToken();
      if (!token) throw new PortalProvisioningProgressError('unauthorized', 401);
      const work = [requestPortalProvisioningProgress({ tenantId: store.tenantId, token })];
      if (!brandingLoaded) work.push(requestBranding({ tenantId: store.tenantId, token }));
      const [progress, profile] = await Promise.all(work);
      if (!brandingLoaded) {
        brand = normalizeBranding(profile, store);
        brandingLoaded = true;
        applyBranding(overlay, brand);
      }

      previewReady = false;
      if (progress.stage === 'ready' && progress.status === 'complete') {
        try {
          const preview = await requestPortalPrivatePreviewStatus({ tenantId: store.tenantId, token });
          previewReady = preview.available === true;
        } catch {
          previewReady = false;
        }
      }

      failureCount = 0;
      render(progress);
      schedule(previewReady ? 30000 : Math.min(progress.pollAfterMs, 8000));
    } catch (error) {
      failureCount += 1;
      if (lastProgress) {
        transientError.textContent = errorMessage(error);
        transientError.hidden = false;
      } else {
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
      close();
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
