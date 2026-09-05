import './source-connection-styles.css';
import { portalApiErrorMessage } from './portal-model.js';
import {
  PortalSourceConnectionError,
  requestPortalSourceConnection,
  requestPortalSourceState
} from './source-connection.js';

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.type) node.type = options.type;
  if (options.name) node.name = options.name;
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.value != null) node.value = options.value;
  if (options.disabled) node.disabled = true;
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function sourceErrorMessage(error) {
  const code = error instanceof PortalSourceConnectionError ? error.code : 'source_connection_failed';
  return portalApiErrorMessage(code);
}

function providerCard() {
  return el('div', { className: 'source-provider-card' }, [
    el('div', { className: 'source-provider-mark', text: 'Y' }),
    el('div', { className: 'source-provider-copy' }, [
      el('strong', { text: 'Yupoo' }),
      el('span', { text: 'Conector disponível no beta' })
    ]),
    el('span', { className: 'source-provider-state', text: 'Disponível' })
  ]);
}

function connectedView({ close }) {
  return el('div', { className: 'source-content source-content--success' }, [
    el('div', { className: 'source-success-mark', text: '✓' }),
    el('span', { className: 'source-kicker', text: 'Fonte verificada' }),
    el('h2', { text: 'Fonte conectada.' }),
    el('p', {
      text: 'O Yupoo foi reconhecido e salvo com segurança. O endereço real fica protegido dentro do Catalog Engine.'
    }),
    providerCard(),
    el('div', { className: 'source-next-step' }, [
      el('small', { text: 'Próximo passo' }),
      el('strong', { text: 'Definir o que será importado' }),
      el('span', { text: 'A próxima etapa usa apenas decisões e estados reais do catálogo, sem fingir que a importação já terminou.' })
    ]),
    (() => {
      const button = el('button', {
        className: 'source-secondary-button',
        text: 'Voltar para minhas lojas',
        type: 'button'
      });
      button.addEventListener('click', close);
      return button;
    })()
  ]);
}

function formView({ store, getAccessToken, setBody, close }) {
  const form = el('form', { className: 'source-form' });
  const label = el('label', { className: 'source-field' }, [
    el('span', { text: 'Link do catálogo Yupoo' })
  ]);
  const input = el('input', {
    type: 'url',
    name: 'sourceUrl',
    placeholder: 'https://sualoja.x.yupoo.com/albums/'
  });
  input.required = true;
  input.autocomplete = 'off';
  input.inputMode = 'url';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.maxLength = 2048;
  label.append(input);
  label.append(
    el('small', {
      text: 'Cole de preferência o link principal do catálogo. O endereço é usado apenas para importar seus produtos e não será exibido na loja.'
    })
  );

  const errorBox = el('div', { className: 'source-form-error' });
  errorBox.hidden = true;
  errorBox.setAttribute('role', 'alert');

  const submit = el('button', {
    className: 'source-primary-button',
    type: 'submit',
    text: 'Verificar e conectar'
  });

  form.append(
    el('span', { className: 'source-kicker', text: 'Adicionar produtos' }),
    el('h2', { text: 'Conecte seu catálogo.' }),
    el('p', {
      text: `Vamos verificar a fonte da ${store?.storeName || 'sua loja'} antes de continuar. Nenhum endereço privado será publicado.`
    }),
    providerCard(),
    label,
    errorBox,
    submit,
    el('p', {
      className: 'source-form-note',
      text: 'Nesta fase, apenas Yupoo está disponível. Outros conectores não são simulados nem liberados antes de estarem prontos.'
    })
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Verificando fonte…';
    input.disabled = true;
    try {
      const token = await getAccessToken();
      await requestPortalSourceConnection({
        tenantId: store.tenantId,
        token,
        sourceUrl: input.value
      });
      setBody(connectedView({ close }));
    } catch (error) {
      errorBox.textContent = sourceErrorMessage(error);
      errorBox.hidden = false;
      input.disabled = false;
      submit.disabled = false;
      submit.textContent = 'Verificar e conectar';
      input.focus();
    }
  });

  queueMicrotask(() => input.focus());
  return form;
}

function focusableElements(panel) {
  return [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(
    (node) => !node.hidden
  );
}

export async function openSourceConnectionExperience({ store, getAccessToken, onDone }) {
  if (!store?.tenantId || typeof getAccessToken !== 'function') return;
  const previousFocus = document.activeElement;
  const overlay = el('div', { className: 'source-overlay' });
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Fonte de produtos de ${store.storeName || 'sua loja'}`);

  const panel = el('section', { className: 'source-panel' });
  const closeButton = el('button', {
    className: 'source-close',
    type: 'button',
    text: 'Fechar',
    ariaLabel: 'Fechar conexão de catálogo'
  });
  const body = el('div', { className: 'source-panel-body' });

  function setBody(node) {
    body.replaceChildren(node);
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    document.documentElement.classList.remove('source-dialog-open');
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
    el('header', { className: 'source-panel-header' }, [
      el('div', {}, [
        el('span', { className: 'source-kicker', text: 'Fonte do catálogo' }),
        el('strong', { text: store.storeName || 'Sua loja' })
      ]),
      closeButton
    ]),
    body
  );
  overlay.append(panel);
  document.body.append(overlay);
  document.documentElement.classList.add('source-dialog-open');
  closeButton.focus();

  setBody(
    el('div', { className: 'source-loading' }, [
      el('div', { className: 'source-loading-dot' }),
      el('strong', { text: 'Consultando a fonte da loja…' }),
      el('span', { text: 'Usando o estado salvo no Catalog Engine.' })
    ])
  );

  try {
    const token = await getAccessToken();
    const source = await requestPortalSourceState({ tenantId: store.tenantId, token });
    if (source) {
      setBody(connectedView({ close }));
    } else {
      setBody(formView({ store, getAccessToken, setBody, close }));
    }
  } catch (error) {
    const retry = el('button', {
      className: 'source-secondary-button',
      text: 'Tentar novamente',
      type: 'button'
    });
    retry.addEventListener('click', () => window.location.reload());
    setBody(
      el('div', { className: 'source-content source-content--error' }, [
        el('span', { className: 'source-kicker', text: 'Não foi possível carregar' }),
        el('h2', { text: 'A fonte continua protegida.' }),
        el('p', { text: sourceErrorMessage(error) }),
        retry
      ])
    );
  }
}
