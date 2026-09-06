import './import-decision-styles.css';
import { portalApiErrorMessage } from './portal-model.js';
import {
  PortalImportDecisionError,
  confirmPortalFullSourceImport,
  requestPortalImportDecisionState
} from './import-decision.js';

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
  const code = error instanceof PortalImportDecisionError ? error.code : 'import_decision_failed';
  return portalApiErrorMessage(code);
}

function connectedSourceBadge() {
  return el('div', { className: 'import-decision-source' }, [
    el('div', { className: 'import-decision-source-mark', text: 'Y' }),
    el('div', { className: 'import-decision-source-copy' }, [
      el('strong', { text: 'Yupoo conectado' }),
      el('span', { text: 'Fonte verificada e protegida' })
    ]),
    el('span', { className: 'import-decision-source-state', text: 'Ativo' })
  ]);
}

function confirmedView({ decision, close }) {
  const preexisting = decision?.authority === 'preexisting_import';
  const action = el('button', {
    className: 'import-decision-secondary',
    type: 'button',
    text: 'Voltar para minhas lojas'
  });
  action.addEventListener('click', close);

  return el('div', { className: 'import-decision-content import-decision-content--success' }, [
    el('div', { className: 'import-decision-success-mark', text: '✓' }),
    el('span', {
      className: 'import-decision-kicker',
      text: preexisting ? 'Decisão recuperada' : 'Importação definida'
    }),
    el('h2', { text: preexisting ? 'Seu catálogo já está em preparação.' : 'Catálogo completo confirmado.' }),
    el('p', {
      text: preexisting
        ? 'A preparação inicial já havia começado antes desta etapa. Preservamos o trabalho existente e registramos a mesma regra: usar todo o conteúdo da fonte conectada.'
        : 'O Catalog Engine agora pode usar todo o conteúdo da fonte conectada na importação inicial. A organização da vitrine acontece depois, sem transformar pastas do fornecedor em categorias públicas automaticamente.'
    }),
    connectedSourceBadge(),
    el('div', { className: 'import-decision-next' }, [
      el('small', { text: 'Próximo passo' }),
      el('strong', { text: 'Preparar o catálogo' }),
      el('span', { text: 'Você poderá sair desta tela. As próximas etapas usam estados reais e continuam em segundo plano.' })
    ]),
    action
  ]);
}

function decisionView({ store, getAccessToken, setBody, close }) {
  const content = el('div', { className: 'import-decision-content' });
  const errorBox = el('div', { className: 'import-decision-error' });
  errorBox.hidden = true;
  errorBox.setAttribute('role', 'alert');

  const confirm = el('button', {
    className: 'import-decision-primary',
    type: 'button',
    text: 'Importar catálogo completo'
  });

  confirm.addEventListener('click', async () => {
    errorBox.hidden = true;
    confirm.disabled = true;
    confirm.textContent = 'Confirmando decisão…';
    try {
      const token = await getAccessToken();
      const decision = await confirmPortalFullSourceImport({
        tenantId: store.tenantId,
        token
      });
      setBody(confirmedView({ decision, close }));
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
      confirm.disabled = false;
      confirm.textContent = 'Importar catálogo completo';
      confirm.focus();
    }
  });

  content.append(
    el('span', { className: 'import-decision-kicker', text: 'Definir importação' }),
    el('h2', { text: 'Leve todo o seu catálogo para a loja.' }),
    el('p', {
      text: `A ${store?.storeName || 'sua loja'} está pronta para a primeira importação. Neste beta, usamos todo o conteúdo da fonte que você conectou e deixamos a organização comercial para o Catalog Engine.`
    }),
    connectedSourceBadge(),
    el('div', { className: 'import-decision-choice' }, [
      el('div', { className: 'import-decision-choice-check', text: '✓' }),
      el('div', { className: 'import-decision-choice-copy' }, [
        el('small', { text: 'Opção disponível no beta' }),
        el('strong', { text: 'Catálogo completo' }),
        el('span', { text: 'Importa todos os produtos encontrados dentro da fonte conectada.' })
      ])
    ]),
    el('div', { className: 'import-decision-trust' }, [
      el('strong', { text: 'Sua estrutura continua sob controle.' }),
      el('span', {
        text: 'Pastas e categorias do fornecedor entram como evidência privada. O Catalog Engine organiza a experiência pública depois, sem copiar a navegação do Yupoo automaticamente.'
      })
    ]),
    errorBox,
    confirm,
    el('p', {
      className: 'import-decision-note',
      text: 'A importação só recebe autorização depois desta confirmação. Nenhum link privado do fornecedor é exibido na loja.'
    })
  );
  queueMicrotask(() => confirm.focus());
  return content;
}

function focusableElements(panel) {
  return [...panel.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(
    (node) => !node.hidden
  );
}

export async function openImportDecisionExperience({ store, getAccessToken, onDone }) {
  if (!store?.tenantId || typeof getAccessToken !== 'function') return;
  const previousFocus = document.activeElement;
  const overlay = el('div', { className: 'import-decision-overlay' });
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Importação de ${store.storeName || 'sua loja'}`);

  const panel = el('section', { className: 'import-decision-panel' });
  const closeButton = el('button', {
    className: 'import-decision-close',
    type: 'button',
    text: 'Fechar',
    ariaLabel: 'Fechar decisão de importação'
  });
  const body = el('div', { className: 'import-decision-panel-body' });

  function setBody(node) {
    body.replaceChildren(node);
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    document.documentElement.classList.remove('import-decision-dialog-open');
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    if (typeof onDone === 'function') await onDone();
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

  panel.append(
    el('header', { className: 'import-decision-header' }, [
      el('div', {}, [
        el('span', { className: 'import-decision-kicker', text: 'Importação do catálogo' }),
        el('strong', { text: store.storeName || 'Sua loja' })
      ]),
      closeButton
    ]),
    body
  );
  overlay.append(panel);
  document.body.append(overlay);
  document.documentElement.classList.add('import-decision-dialog-open');
  closeButton.focus();

  setBody(
    el('div', { className: 'import-decision-loading' }, [
      el('div', { className: 'import-decision-loading-dot' }),
      el('strong', { text: 'Consultando sua decisão…' }),
      el('span', { text: 'Usando apenas o estado salvo no Catalog Engine.' })
    ])
  );

  try {
    const token = await getAccessToken();
    const state = await requestPortalImportDecisionState({ tenantId: store.tenantId, token });
    if (!state.sourceConnected) {
      throw new PortalImportDecisionError('import_decision_source_required', 409);
    }
    setBody(
      state.decision
        ? confirmedView({ decision: state.decision, close })
        : decisionView({ store, getAccessToken, setBody, close })
    );
  } catch (error) {
    const retry = el('button', {
      className: 'import-decision-secondary',
      text: 'Tentar novamente',
      type: 'button'
    });
    retry.addEventListener('click', () => window.location.reload());
    setBody(
      el('div', { className: 'import-decision-content import-decision-content--error' }, [
        el('span', { className: 'import-decision-kicker', text: 'Não foi possível confirmar' }),
        el('h2', { text: 'Sua configuração foi preservada.' }),
        el('p', { text: errorMessage(error) }),
        retry
      ])
    );
  }
}
