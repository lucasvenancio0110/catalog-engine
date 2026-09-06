import './provisioning-progress-styles.css';
import { portalApiErrorMessage } from './portal-model.js';
import {
  PortalProvisioningProgressError,
  requestPortalProvisioningProgress
} from './provisioning-progress.js';

const STAGE_ORDER = [
  ['preparing', 'Preparando'],
  ['discovering', 'Lendo catálogo'],
  ['importing', 'Importando'],
  ['finalizing', 'Finalizando'],
  ['organizing', 'Organizando'],
  ['checking', 'Conferindo'],
  ['ready', 'Pronto']
];

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
    return 'Não foi possível atualizar o andamento agora. O último estado confirmado foi preservado.';
  }
  if (code === 'progress_state_invalid') {
    return 'O andamento recebido não pôde ser confirmado com segurança. O último estado válido foi preservado.';
  }
  return portalApiErrorMessage(code);
}

function stageIndex(stage) {
  if (stage === 'source') return -1;
  return STAGE_ORDER.findIndex(([key]) => key === stage);
}

function timeline(progress) {
  const current = stageIndex(progress.stage);
  const list = el('ol', { className: 'progress-timeline' });
  STAGE_ORDER.forEach(([key, label], index) => {
    const state = progress.stage === 'ready' || index < current ? 'done' : index === current ? 'current' : 'future';
    const item = el('li', { className: `progress-timeline-item progress-timeline-item--${state}` }, [
      el('span', { className: 'progress-timeline-mark', text: state === 'done' ? '✓' : String(index + 1) }),
      el('span', { className: 'progress-timeline-label', text: label })
    ]);
    if (state === 'current') item.setAttribute('aria-current', 'step');
    list.append(item);
  });
  return list;
}

function counterRows(progress) {
  const counters = progress.counters;
  if (!counters) return null;
  const rows = [];
  if (progress.stage === 'discovering') {
    if (counters.discovered > 0) rows.push(['Itens encontrados', counters.discovered]);
    if (counters.queued > 0) rows.push(['Itens preparados para leitura', counters.queued]);
  } else if (progress.stage === 'importing' || progress.stage === 'finalizing') {
    if (counters.discovered > 0) rows.push(['Itens encontrados', counters.discovered]);
    if (counters.completed > 0 || counters.discovered > 0) rows.push(['Itens processados', counters.completed || 0]);
    if (counters.published > 0) rows.push(['Produtos consolidados', counters.published]);
    if (counters.deferred > 0) rows.push(['Aguardando nova tentativa', counters.deferred]);
  } else if (progress.stage === 'organizing') {
    if (counters.total > 0) rows.push(['Produtos no catálogo', counters.total]);
    if (counters.processed > 0) rows.push(['Produtos organizados', counters.processed]);
    if (counters.review > 0) rows.push(['Separados para revisão', counters.review]);
  } else if (progress.stage === 'checking' || progress.stage === 'ready') {
    if (counters.checked > 0) rows.push(['Produtos conferidos', counters.checked]);
    if (counters.findings > 0) rows.push(['Itens para revisão', counters.findings]);
  }
  if (!rows.length) return null;
  return el(
    'dl',
    { className: 'progress-counters' },
    rows.map(([label, value]) =>
      el('div', { className: 'progress-counter' }, [
        el('dt', { text: label }),
        el('dd', { text: Number(value).toLocaleString('pt-BR') })
      ])
    )
  );
}

function retryNote(progress) {
  if (progress.retry?.kind !== 'automatic') return null;
  return el('div', { className: 'progress-retry-note' }, [
    el('strong', { text: 'Nova tentativa automática programada' }),
    el('span', { text: 'Você não precisa repetir a importação nem recriar a loja.' })
  ]);
}

function updatedLabel(progress) {
  if (!progress.updatedAt) return 'Estado salvo no Catalog Engine';
  const date = new Date(progress.updatedAt);
  if (Number.isNaN(date.getTime())) return 'Estado salvo no Catalog Engine';
  return `Atualizado às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function progressView(progress) {
  const stateMark = progress.status === 'complete' ? '✓' : progress.status === 'attention' ? '!' : '•';
  const content = el('div', { className: `progress-content progress-content--${progress.status}` }, [
    el('div', { className: 'progress-state-line' }, [
      el('span', { className: 'progress-state-mark', text: stateMark }),
      el('span', {
        className: 'progress-kicker',
        text: progress.status === 'attention' ? 'Atenção necessária' : progress.status === 'complete' ? 'Preparação concluída' : 'Preparação em andamento'
      })
    ]),
    el('h2', { text: progress.title }),
    el('p', { className: 'progress-message', text: progress.message }),
    timeline(progress),
    counterRows(progress),
    retryNote(progress),
    el('div', { className: 'progress-safety-note' }, [
      el('strong', { text: 'Pode fechar esta tela.' }),
      el('span', { text: 'O andamento fica salvo e será retomado do estado real quando você voltar.' })
    ]),
    el('small', { className: 'progress-updated', text: updatedLabel(progress) })
  ]);
  return content;
}

function loadingView(hasPrevious) {
  return el('div', { className: 'progress-loading' }, [
    el('span', { className: 'progress-loading-dot' }),
    el('strong', { text: hasPrevious ? 'Atualizando andamento…' : 'Consultando andamento…' }),
    el('span', { text: hasPrevious ? 'Mantendo o último estado confirmado enquanto consultamos.' : 'Lendo os checkpoints salvos da sua loja.' })
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
  overlay.setAttribute('aria-label', `Andamento do catálogo de ${store.storeName || 'sua loja'}`);

  const panel = el('section', { className: 'progress-panel' });
  const closeButton = el('button', {
    className: 'progress-close',
    type: 'button',
    text: 'Fechar',
    ariaLabel: 'Fechar andamento do catálogo'
  });
  const body = el('div', { className: 'progress-panel-body' });
  const transientError = el('div', { className: 'progress-transient-error' });
  transientError.hidden = true;
  transientError.setAttribute('role', 'status');

  let closed = false;
  let lastProgress = null;
  let timer = null;
  let failureCount = 0;
  let requestInFlight = false;

  function render(progress) {
    lastProgress = progress;
    body.replaceChildren(progressView(progress));
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
    if (!lastProgress) body.replaceChildren(loadingView(false));
    try {
      const token = await getAccessToken();
      const progress = await requestPortalProvisioningProgress({ tenantId: store.tenantId, token });
      failureCount = 0;
      render(progress);
      schedule(progress.pollAfterMs);
    } catch (error) {
      failureCount += 1;
      if (lastProgress) {
        transientError.textContent = errorMessage(error);
        transientError.hidden = false;
      } else {
        body.replaceChildren(
          el('div', { className: 'progress-content progress-content--attention' }, [
            el('span', { className: 'progress-kicker', text: 'Não foi possível atualizar' }),
            el('h2', { text: 'Seu progresso continua preservado.' }),
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
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', onVisibilityChange);

  panel.append(
    el('header', { className: 'progress-header' }, [
      el('div', {}, [
        el('span', { className: 'progress-kicker', text: 'Andamento do catálogo' }),
        el('strong', { text: store.storeName || 'Sua loja' })
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
  body.replaceChildren(loadingView(false));
  await refresh();
}
