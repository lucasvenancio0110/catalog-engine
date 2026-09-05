import './branding-styles.css';
import { normalizeBrandColor, accessibleTextColor } from '../domain/brand-colors.js';
import { portalApiErrorMessage, portalInitials } from './portal-model.js';

const MAX_LOGO_BYTES = 2_097_152;
const ACCEPTED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.type) node.type = options.type;
  if (options.name) node.name = options.name;
  if (options.value != null) node.value = String(options.value);
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.accept) node.accept = options.accept;
  if (options.src) node.src = options.src;
  if (options.alt != null) node.alt = options.alt;
  if (options.disabled) node.disabled = true;
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function themeDescription(key) {
  const descriptions = {
    'premium-dark': 'Elegante, profundo e focado em produto.',
    stadium: 'Mais energia visual para catálogos esportivos.',
    clean: 'Claro, editorial e com bastante respiro.'
  };
  return descriptions[key] || 'Tema controlado e otimizado pelo Catalog Engine.';
}

async function api(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    cache: 'no-store'
  });
  let payload = {};
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'branding_temporarily_unavailable');
    error.code = payload.error || 'branding_temporarily_unavailable';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function field(label, input, helper) {
  const wrapper = el('label', { className: 'brand-field' }, [
    el('span', { className: 'brand-field-label', text: label }),
    input
  ]);
  if (helper) wrapper.append(el('small', { text: helper }));
  return wrapper;
}

function themePicker(themes, selected) {
  const group = el('fieldset', { className: 'brand-theme-fieldset' });
  group.append(el('legend', { text: 'Estilo da vitrine' }));
  const grid = el('div', { className: 'brand-theme-grid' });
  for (const theme of themes) {
    const radio = el('input', {
      type: 'radio',
      name: 'themeKey',
      value: theme.key
    });
    radio.checked = theme.key === selected;
    const card = el('label', { className: 'brand-theme-card' }, [
      radio,
      el('span', { className: `brand-theme-swatch brand-theme-swatch--${theme.key}` }),
      el('span', { className: 'brand-theme-copy' }, [
        el('strong', { text: theme.name }),
        el('small', { text: themeDescription(theme.key) })
      ])
    ]);
    grid.append(card);
  }
  group.append(grid);
  return group;
}

function colorField(label, name, value, fallback) {
  const color = normalizeBrandColor(value) || fallback;
  const picker = el('input', { type: 'color', name, value: color });
  const text = el('input', { type: 'text', name: `${name}Text`, value: color });
  text.maxLength = 7;
  text.autocapitalize = 'characters';
  const sync = (source, target) => {
    const normalized = normalizeBrandColor(source.value);
    if (!normalized) return;
    source.value = normalized;
    target.value = normalized;
  };
  picker.addEventListener('input', () => sync(picker, text));
  text.addEventListener('change', () => sync(text, picker));
  return el('label', { className: 'brand-color-field' }, [
    el('span', { className: 'brand-field-label', text: label }),
    el('span', { className: 'brand-color-control' }, [picker, text])
  ]);
}

function setMessage(node, message, tone = '') {
  node.className = tone ? `brand-message brand-message--${tone}` : 'brand-message';
  node.textContent = message || '';
}

function previewCard(profile, form) {
  const preview = el('section', { className: 'brand-live-preview' });
  const visual = el('div', { className: 'brand-preview-visual' });
  const logo = profile.logoPath
    ? el('img', { className: 'brand-preview-logo', src: profile.logoPath, alt: '' })
    : el('span', {
        className: 'brand-preview-initials',
        text: portalInitials(profile.storeName)
      });
  const title = el('strong', { text: profile.storeName });
  const caption = el('span', { text: 'Sua marca começa a ganhar forma aqui.' });
  const action = el('span', { className: 'brand-preview-action', text: 'Explorar catálogo' });
  visual.append(logo, title, caption, action);
  preview.append(
    el('span', { className: 'eyebrow', text: 'Prévia de identidade' }),
    el('h3', { text: 'Consistência antes de publicar.' }),
    el('p', {
      text: 'Esta é uma leitura visual da sua marca. O preview completo da loja será liberado depois que o catálogo estiver preparado.'
    }),
    visual
  );

  const update = () => {
    const storeName = form.elements.storeName?.value?.trim() || profile.storeName;
    const primary = normalizeBrandColor(form.elements.primaryColorText?.value) || '#8A7DFF';
    const secondary = normalizeBrandColor(form.elements.secondaryColorText?.value) || '#57D6A0';
    title.textContent = storeName;
    if (!profile.logoPath) logo.textContent = portalInitials(storeName);
    visual.style.setProperty('--merchant-primary', primary);
    visual.style.setProperty('--merchant-secondary', secondary);
    action.style.color = accessibleTextColor(primary) || '#000000';
  };
  form.addEventListener('input', update);
  update();
  return preview;
}

function validateLogo(file) {
  if (!file) return null;
  if (!ACCEPTED_LOGO_TYPES.has(file.type)) return 'Use PNG, JPEG ou WebP.';
  if (file.size > MAX_LOGO_BYTES) return 'A logo deve ter no máximo 2 MB.';
  return null;
}

function buildExperience({ store, profile, themes, token, onDone, close }) {
  const form = el('form', { className: 'branding-form' });
  const message = el('div', { className: 'brand-message', ariaLabel: 'Status da alteração' });
  message.setAttribute('role', 'status');

  const storeName = el('input', {
    type: 'text',
    name: 'storeName',
    value: profile.storeName,
    placeholder: 'Nome da sua loja'
  });
  storeName.minLength = 2;
  storeName.maxLength = 80;
  storeName.required = true;
  storeName.autocomplete = 'organization';

  const whatsapp = el('input', {
    type: 'tel',
    name: 'whatsapp',
    value: profile.whatsapp || '',
    placeholder: '+55 41 99999-9999'
  });
  whatsapp.autocomplete = 'tel';

  const instagram = el('input', {
    type: 'text',
    name: 'instagram',
    value: profile.instagram ? `@${profile.instagram}` : '',
    placeholder: '@sualoja'
  });
  instagram.autocapitalize = 'none';
  instagram.autocomplete = 'off';

  const logoInput = el('input', {
    type: 'file',
    name: 'logo',
    accept: 'image/png,image/jpeg,image/webp'
  });
  const logoName = el('span', {
    className: 'brand-logo-selection',
    text: profile.logoPath ? 'Logo atual salva' : 'Nenhum arquivo selecionado'
  });
  logoInput.addEventListener('change', () => {
    const file = logoInput.files?.[0];
    const error = validateLogo(file);
    logoName.textContent = error || file?.name || (profile.logoPath ? 'Logo atual salva' : 'Nenhum arquivo selecionado');
    logoName.classList.toggle('is-error', Boolean(error));
  });

  const logoVisual = profile.logoPath
    ? el('img', { className: 'brand-logo-current', src: profile.logoPath, alt: `Logo atual de ${profile.storeName}` })
    : el('span', { className: 'brand-logo-current brand-logo-current--initials', text: portalInitials(profile.storeName) });

  const logoBlock = el('section', { className: 'brand-logo-block' }, [
    logoVisual,
    el('div', { className: 'brand-logo-copy' }, [
      el('strong', { text: 'Logo da loja' }),
      el('p', { text: 'PNG, JPEG ou WebP. Nós validamos a imagem e preparamos uma versão segura para a loja.' }),
      el('label', { className: 'secondary-button brand-file-button' }, [
        el('span', { text: profile.logoPath ? 'Trocar logo' : 'Escolher logo' }),
        logoInput
      ]),
      logoName
    ])
  ]);

  if (profile.logoPath) {
    const remove = el('button', {
      className: 'brand-link-button',
      text: 'Remover logo',
      type: 'button'
    });
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      setMessage(message, 'Removendo a logo…');
      try {
        await api(`/api/admin/stores/${store.tenantId}/branding/logo`, token, { method: 'DELETE' });
        setMessage(message, 'Logo removida. A identidade continua salva.', 'success');
        setTimeout(() => onDone(), 450);
      } catch (error) {
        remove.disabled = false;
        setMessage(message, portalApiErrorMessage(error.code), 'error');
      }
    });
    logoBlock.querySelector('.brand-logo-copy')?.append(remove);
  }

  form.append(
    el('section', { className: 'brand-form-section' }, [
      el('span', { className: 'brand-section-index', text: '01' }),
      el('div', { className: 'brand-section-copy' }, [
        el('h3', { text: 'Marca' }),
        el('p', { text: 'O nome e a logo que vão representar sua operação para o cliente.' })
      ]),
      field('Nome da loja', storeName, 'Você pode refinar esse nome sem alterar o identificador interno da loja.'),
      logoBlock
    ]),
    el('section', { className: 'brand-form-section' }, [
      el('span', { className: 'brand-section-index', text: '02' }),
      el('div', { className: 'brand-section-copy' }, [
        el('h3', { text: 'Assinatura visual' }),
        el('p', { text: 'Escolha uma base profissional e dê à interface as cores da sua marca.' })
      ]),
      themePicker(themes, profile.themeKey),
      el('div', { className: 'brand-colors-grid' }, [
        colorField('Cor principal', 'primaryColor', profile.primaryColor, '#8A7DFF'),
        colorField('Cor de apoio', 'secondaryColor', profile.secondaryColor, '#57D6A0')
      ]),
      el('small', { className: 'brand-form-note', text: 'O Catalog Engine escolhe automaticamente texto claro ou escuro para preservar contraste sobre essas cores.' })
    ]),
    el('section', { className: 'brand-form-section' }, [
      el('span', { className: 'brand-section-index', text: '03' }),
      el('div', { className: 'brand-section-copy' }, [
        el('h3', { text: 'Presença pública' }),
        el('p', { text: 'Canais opcionais que poderão acompanhar sua loja e facilitar o contato.' })
      ]),
      el('div', { className: 'brand-contact-grid' }, [
        field('WhatsApp', whatsapp, 'Use o número com código do país, por exemplo +55.'),
        field('Instagram', instagram, 'Informe apenas o seu perfil público.')
      ])
    ])
  );

  const preview = previewCard(profile, form);
  const submit = el('button', {
    className: 'primary-button brand-save-button',
    text: 'Salvar identidade',
    type: 'submit'
  });
  form.append(
    message,
    el('div', { className: 'brand-form-footer' }, [
      el('div', {}, [
        el('strong', { text: 'Agora: construir sua marca' }),
        el('small', { text: 'Depois: conectar a fonte do catálogo' })
      ]),
      submit
    ])
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = logoInput.files?.[0];
    const logoError = validateLogo(file);
    if (logoError) {
      setMessage(message, logoError, 'error');
      return;
    }
    const primaryColor = normalizeBrandColor(form.elements.primaryColorText?.value);
    const secondaryColor = normalizeBrandColor(form.elements.secondaryColorText?.value);
    if (!primaryColor || !secondaryColor) {
      setMessage(message, 'Revise as cores da marca. Use o formato #RRGGBB.', 'error');
      return;
    }
    const themeKey = form.querySelector('input[name="themeKey"]:checked')?.value;
    submit.disabled = true;
    setMessage(message, file ? 'Salvando identidade e preparando sua logo…' : 'Salvando sua identidade…');
    try {
      await api(`/api/admin/stores/${store.tenantId}/branding`, token, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storeName: storeName.value,
          themeKey,
          primaryColor,
          secondaryColor,
          whatsapp: whatsapp.value,
          instagram: instagram.value
        })
      });
      if (file) {
        await api(`/api/admin/stores/${store.tenantId}/branding/logo`, token, {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file
        });
      }
      setMessage(message, 'Identidade salva. Sua loja já está pronta para o próximo passo.', 'success');
      setTimeout(() => onDone(), 600);
    } catch (error) {
      submit.disabled = false;
      setMessage(message, portalApiErrorMessage(error.code), 'error');
    }
  });

  const content = el('div', { className: 'branding-workspace' }, [form, preview]);
  const closeButton = el('button', {
    className: 'brand-close',
    type: 'button',
    text: 'Fechar',
    ariaLabel: 'Fechar configuração de aparência'
  });
  closeButton.addEventListener('click', close);
  return el('div', { className: 'branding-panel' }, [
    el('header', { className: 'branding-header' }, [
      el('div', {}, [
        el('span', { className: 'eyebrow', text: 'Identidade da loja' }),
        el('h2', { text: 'Dê uma identidade que seus clientes reconhecem.' }),
        el('p', { text: 'Defina sua assinatura visual e os canais públicos. O Catalog Engine mantém essa identidade consistente nas próximas etapas.' })
      ]),
      closeButton
    ]),
    content
  ]);
}

export async function openBrandingExperience({ store, getAccessToken, onDone }) {
  const previousFocus = document.activeElement;
  const overlay = el('div', { className: 'branding-overlay' });
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Aparência de ${store.storeName || 'sua loja'}`);
  const loading = el('div', { className: 'brand-loading' }, [
    el('span', { className: 'brand-loading-mark', text: portalInitials(store.storeName) }),
    el('strong', { text: 'Preparando sua identidade…' }),
    el('small', { text: 'Carregando apenas as configurações desta loja.' })
  ]);
  overlay.append(loading);
  document.body.append(overlay);
  document.body.classList.add('branding-open');

  const close = () => {
    overlay.remove();
    document.body.classList.remove('branding-open');
    previousFocus?.focus?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey, { once: false });
  const finish = async () => {
    document.removeEventListener('keydown', onKey);
    close();
    await onDone?.();
  };

  try {
    const token = await getAccessToken();
    if (!token) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
    const payload = await api(`/api/admin/stores/${store.tenantId}/branding`, token);
    overlay.replaceChildren(
      buildExperience({
        store,
        profile: payload.profile,
        themes: payload.themes || [],
        token,
        onDone: finish,
        close: () => {
          document.removeEventListener('keydown', onKey);
          close();
        }
      })
    );
    overlay.querySelector('input, button')?.focus();
  } catch (error) {
    const retry = el('button', { className: 'secondary-button', type: 'button', text: 'Fechar' });
    retry.addEventListener('click', () => {
      document.removeEventListener('keydown', onKey);
      close();
    });
    overlay.replaceChildren(
      el('div', { className: 'brand-loading brand-loading--error' }, [
        el('strong', { text: 'Não conseguimos abrir a aparência agora.' }),
        el('p', { text: portalApiErrorMessage(error.code) }),
        retry
      ])
    );
  }
}
