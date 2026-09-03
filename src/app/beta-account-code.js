import './beta-account-code.css';

const PRINCIPAL_PATTERN = /^prn_[a-f0-9]{20}$/;
let sessionRequestInFlight = false;

export function isPortalPrincipalId(value) {
  return PRINCIPAL_PATTERN.test(String(value || '').trim());
}

function element(tag, options = {}, children = []) {
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

function betaAccountPanel(principalId) {
  const status = element('span', {
    className: 'beta-account-code-status',
    text: ''
  });
  status.setAttribute('aria-live', 'polite');

  const code = element('code', {
    className: 'beta-account-code-value',
    text: principalId
  });
  code.setAttribute('tabindex', '0');

  const copyButton = element('button', {
    className: 'secondary-button beta-account-code-copy',
    type: 'button',
    text: 'Copiar código',
    ariaLabel: 'Copiar código da conta beta'
  });

  copyButton.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(principalId);
      copyButton.textContent = 'Copiado';
      status.textContent = 'Código copiado.';
    } catch {
      status.textContent = 'Segure o código acima para copiar.';
      code.focus();
    }
  });

  return element('section', { className: 'beta-account-code' }, [
    element('div', { className: 'beta-account-code-copyblock' }, [
      element('span', { className: 'eyebrow', text: 'Acesso beta' }),
      element('h2', { text: 'Código da sua conta' }),
      element('p', {
        text: 'Este código serve apenas para liberarmos sua conta beta. Ele não é sua senha.'
      })
    ]),
    element('div', { className: 'beta-account-code-action' }, [code, copyButton, status])
  ]);
}

async function loadCurrentSession() {
  const auth = window.__CATALOG_ENGINE_AUTH__;
  if (!auth || typeof auth.getAccessToken !== 'function') return null;
  const token = await auth.getAccessToken();
  if (!token) return null;

  const response = await fetch('/api/admin/session', {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!response.ok) return null;
  return response.json();
}

async function maybeMountBetaAccountCode() {
  if (sessionRequestInFlight || document.querySelector('.beta-account-code')) return;

  const emptyState = document.querySelector('.portal-main .empty-state');
  const waitingForGrant = emptyState?.querySelector('.empty-helper');
  if (!emptyState || !waitingForGrant) return;

  sessionRequestInFlight = true;
  try {
    const session = await loadCurrentSession();
    const principalId = String(session?.principalId || '').trim();
    if (!isPortalPrincipalId(principalId)) return;
    if (!document.body.contains(emptyState) || document.querySelector('.beta-account-code')) return;
    emptyState.before(betaAccountPanel(principalId));
  } catch {
    // The main portal owns authentication/session errors. This helper stays silent.
  } finally {
    sessionRequestInFlight = false;
  }
}

function startBetaAccountCodeHelper() {
  const root = document.querySelector('#app');
  if (!root) return;
  const observer = new MutationObserver(() => {
    void maybeMountBetaAccountCode();
  });
  observer.observe(root, { childList: true, subtree: true });
  void maybeMountBetaAccountCode();
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  startBetaAccountCodeHelper();
}
