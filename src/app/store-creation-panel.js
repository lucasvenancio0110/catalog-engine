import { portalApiErrorMessage } from './portal-model.js';
import {
  PortalStoreCreationError,
  normalizePortalStoreSlug,
  requestPortalStoreCreation
} from './store-creation.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function field(labelText, control, helperText) {
  const wrapper = node('label', 'store-create-field');
  const label = node('span', 'store-create-label', labelText);
  wrapper.append(label, control);
  if (helperText) wrapper.append(node('small', 'store-create-helper', helperText));
  return wrapper;
}

function setSubmitting(form, submitting) {
  for (const control of form.elements) control.disabled = submitting;
  const submit = form.querySelector('[data-store-create-submit]');
  if (submit) submit.textContent = submitting ? 'Criando loja…' : 'Criar loja';
}

export function openPortalStoreCreationPanel({ tokenProvider, onCreated, onUnauthorized } = {}) {
  document.querySelector('.store-create-dialog')?.remove();

  const dialog = node('dialog', 'store-create-dialog');
  dialog.setAttribute('aria-labelledby', 'store-create-title');

  const form = node('form', 'store-create-form');
  form.noValidate = true;

  const close = node('button', 'store-create-close', 'Fechar');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar criação de loja');
  close.addEventListener('click', () => dialog.close());

  const heading = node('div', 'store-create-heading');
  heading.append(
    node('span', 'eyebrow', 'PB3 · Primeira loja'),
    Object.assign(node('h2', '', 'Crie a estrutura da sua loja.'), { id: 'store-create-title' }),
    node(
      'p',
      '',
      'Informe apenas os dados básicos agora. Marca, fonte de produtos e domínio serão configurados nas próximas etapas.'
    )
  );

  const name = document.createElement('input');
  name.name = 'name';
  name.type = 'text';
  name.autocomplete = 'organization';
  name.minLength = 2;
  name.maxLength = 80;
  name.required = true;
  name.placeholder = 'Ex.: Arena Imports';

  const slug = document.createElement('input');
  slug.name = 'slug';
  slug.type = 'text';
  slug.autocomplete = 'off';
  slug.spellcheck = false;
  slug.minLength = 3;
  slug.maxLength = 64;
  slug.required = true;
  slug.pattern = '[a-z0-9][a-z0-9-]{1,62}[a-z0-9]';
  slug.placeholder = 'arena-imports';

  const currency = document.createElement('select');
  currency.name = 'currency';
  for (const [value, label] of [
    ['BRL', 'BRL · Real brasileiro'],
    ['USD', 'USD · Dólar americano'],
    ['EUR', 'EUR · Euro']
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    currency.append(option);
  }

  let slugEdited = false;
  name.addEventListener('input', () => {
    if (!slugEdited) slug.value = normalizePortalStoreSlug(name.value);
  });
  slug.addEventListener('input', () => {
    slugEdited = true;
  });
  slug.addEventListener('blur', () => {
    slug.value = normalizePortalStoreSlug(slug.value);
  });

  const fields = node('div', 'store-create-fields');
  fields.append(
    field('Nome da loja', name, 'Esse nome aparecerá no seu portal e poderá ser refinado depois.'),
    field('Identificador da loja', slug, 'Use letras, números e hífens. O domínio próprio é configurado em outra etapa.'),
    field('Moeda principal', currency, 'Define a moeda base usada pela loja.')
  );

  const status = node('div', 'store-create-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const cancel = node('button', 'secondary-button', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());

  const submit = node('button', 'primary-button', 'Criar loja');
  submit.type = 'submit';
  submit.dataset.storeCreateSubmit = '1';

  const actions = node('div', 'store-create-actions');
  actions.append(cancel, submit);

  form.append(close, heading, fields, status, actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'store-create-status';
    status.textContent = '';
    setSubmitting(form, true);

    try {
      const token = await tokenProvider?.();
      const result = await requestPortalStoreCreation({
        token,
        input: { name: name.value, slug: slug.value, currency: currency.value }
      });
      status.className = 'store-create-status store-create-status--success';
      status.textContent = result.replayed
        ? 'Loja confirmada. Atualizando seu portal…'
        : 'Loja criada. Atualizando seu portal…';
      await onCreated?.(result);
      dialog.close();
    } catch (error) {
      const code =
        error instanceof PortalStoreCreationError
          ? error.code
          : 'admin_temporarily_unavailable';
      if (error?.status === 401) {
        await onUnauthorized?.();
        dialog.close();
        return;
      }
      status.className = 'store-create-status store-create-status--error';
      status.textContent = portalApiErrorMessage(code);
      setSubmitting(form, false);
    }
  });

  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.append(form);
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  name.focus();
  return dialog;
}
