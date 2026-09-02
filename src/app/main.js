import './styles.css';
import './auth-styles.css';
import {
  portalApiErrorMessage,
  portalCanCreateStore,
  portalDomainLabel,
  portalInitials,
  portalStoreAllowance,
  portalStoreCountLabel,
  portalStoreStatus
} from './portal-model.js';
import { createPortalAuthAdapter, PortalAuthError } from './auth/auth0-adapter.js';
import { hydratePortalIcons } from '../ui/portal-icons.js';

const root = document.querySelector('#app');
const portalAuth = createPortalAuthAdapter();
window.__CATALOG_ENGINE_AUTH__ = portalAuth;

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.type) node.type = options.type;
  if (options.href) node.href = options.href;
  if (options.title) node.title = options.title;
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
  if (options.disabled) node.disabled = true;
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) node.dataset[key] = String(value);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function icon(name) {
  const iconNames = {
    stores: 'store',
    catalog: 'layout-grid',
    appearance: 'palette',
    domain: 'globe',
    billing: 'credit-card',
    account: 'user-round',
    arrow: 'arrow-right',
    shield: 'shield-check'
  };
  const node = element('i', {
    className: 'ce-icon',
    dataset: { lucide: iconNames[name] || 'layout-grid' }
  });
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function brand() {
  return element('a', { className: 'brand', href: '/', ariaLabel: 'Catalog Engine' }, [
    element('span', { className: 'brand-mark', text: 'CE' }),
    element('span', { className: 'brand-copy' }, [
      element('strong', { text: 'Catalog Engine' }),
      element('small', { text: 'Portal do cliente' })
    ])
  ]);
}

function topbar({ compact = false } = {}) {
  return element('header', { className: compact ? 'topbar topbar--compact' : 'topbar' }, [
    brand(),
    element('div', { className: 'topbar-side' }, [
      element('span', { className: 'system-pill' }, [
        element('span', { className: 'system-dot' }),
        element('span', { text: 'Catalog Engine' })
      ])
    ])
  ]);
}

function runAuthAction(action) {
  return async () => {
    try {
      await action();
    } catch (error) {
      const message =
        error instanceof PortalAuthError
          ? portalAuthMessage(error.code)
          : 'Não conseguimos abrir o acesso seguro agora. Tente novamente.';
      render(errorState(message));
    }
  };
}

function authState({ configured = false } = {}) {
  const shell = element('div', { className: 'auth-shell' });
  shell.append(topbar({ compact: true }));

  const hero = element('main', { className: 'auth-stage' });
  const copy = element('section', { className: 'auth-copy' }, [
    element('span', { className: 'eyebrow', text: 'Seu catálogo. Sua marca. Seu domínio.' }),
    element('h1', { text: 'Sua operação inteira em um só lugar.' }),
    element('p', {
      text: 'Crie lojas, acompanhe o catálogo, conecte suas fontes e deixe o Catalog Engine cuidar do trabalho repetitivo.'
    }),
    element('div', { className: 'auth-points' }, [
      element('div', { className: 'auth-point' }, [
        element('b', { text: '01' }),
        element('span', { text: 'Catálogo organizado automaticamente' })
      ]),
      element('div', { className: 'auth-point' }, [
        element('b', { text: '02' }),
        element('span', { text: 'Cada loja isolada e independente' })
      ]),
      element('div', { className: 'auth-point' }, [
        element('b', { text: '03' }),
        element('span', { text: 'Atualizações controladas e seguras' })
      ])
    ])
  ]);

  const createAccount = element('button', {
    className: 'primary-button primary-button--full',
    text: 'Criar conta',
    type: 'button',
    disabled: !configured,
    title: configured ? 'Criar sua conta' : 'A autenticação segura ainda não foi configurada.'
  });
  const login = element('button', {
    className: 'secondary-button secondary-button--full',
    text: 'Entrar',
    type: 'button',
    disabled: !configured,
    title: configured ? 'Entrar na sua conta' : 'A autenticação segura ainda não foi configurada.'
  });

  if (configured) {
    createAccount.addEventListener('click', runAuthAction(() => portalAuth.login({ signup: true })));
    login.addEventListener('click', runAuthAction(() => portalAuth.login()));
  }

  const accessCard = element('section', { className: 'access-card' }, [
    element('div', { className: 'access-mark' }, [icon('shield')]),
    element('span', { className: 'eyebrow eyebrow--muted', text: 'Acesso seguro' }),
    element('h2', { text: configured ? 'Comece pelo seu acesso' : 'Acesso protegido' }),
    element('p', {
      text: configured
        ? 'Crie sua conta ou entre para acessar suas lojas e continuar de onde parou.'
        : 'O portal está pronto para autenticação OIDC, mas o provedor de identidade ainda não foi configurado.'
    }),
    element('div', { className: 'access-actions' }, [createAccount, login]),
    element('div', {
      className: configured ? 'auth-status' : 'auth-status auth-status--waiting',
      text: configured
        ? 'Autenticação OIDC ativa. O Catalog Engine não armazena sua senha.'
        : 'Configuração externa necessária antes de liberar contas.'
    }),
    element('small', {
      className: 'access-note',
      text: 'A senha e a recuperação da conta ficam no provedor de identidade. O Catalog Engine recebe apenas tokens OIDC assinados.'
    })
  ]);

  hero.append(copy, accessCard);
  shell.append(hero);
  return shell;
}

function navItem(label, iconName, active = false) {
  return element('button', {
    className: active ? 'nav-item is-active' : 'nav-item',
    type: 'button',
    disabled: !active
  }, [icon(iconName), element('span', { text: label })]);
}

function sidebar() {
  return element('aside', { className: 'sidebar' }, [
    brand(),
    element('nav', { className: 'sidebar-nav', ariaLabel: 'Navegação principal' }, [
      navItem('Minhas lojas', 'stores', true),
      navItem('Catálogo', 'catalog'),
      navItem('Aparência', 'appearance'),
      navItem('Domínio', 'domain')
    ]),
    element('div', { className: 'sidebar-spacer' }),
    element('nav', { className: 'sidebar-nav sidebar-nav--secondary', ariaLabel: 'Conta e cobrança' }, [
      navItem('Plano e cobrança', 'billing'),
      navItem('Conta', 'account')
    ]),
    element('div', { className: 'sidebar-foot' }, [
      element('span', { className: 'sidebar-foot-dot' }),
      element('span', { text: 'Operação automática' })
    ])
  ]);
}

function mobileNav() {
  return element('nav', { className: 'mobile-nav', ariaLabel: 'Navegação móvel' }, [
    navItem('Lojas', 'stores', true),
    navItem('Catálogo', 'catalog'),
    navItem('Domínio', 'domain'),
    navItem('Conta', 'account')
  ]);
}

function statusBadge(store) {
  const status = portalStoreStatus(store);
  return element('span', { className: `status-badge status-badge--${status.tone}` }, [
    element('span', { className: 'status-badge-dot' }),
    element('span', { text: status.label })
  ]);
}

function storeCard(store) {
  const initials = portalInitials(store.storeName);
  const card = element('article', { className: 'store-card' });

  const top = element('div', { className: 'store-card-top' }, [
    element('div', { className: 'store-avatar', text: initials }),
    statusBadge(store)
  ]);

  const body = element('div', { className: 'store-card-body' }, [
    element('h3', { text: store.storeName || 'Minha loja' }),
    element('p', { text: portalDomainLabel(store) })
  ]);

  const meta = element('div', { className: 'store-card-meta' }, [
    element('div', {}, [element('small', { text: 'Catálogo' }), element('strong', { text: 'Acompanhar no painel' })]),
    element('div', {}, [element('small', { text: 'Atualização' }), element('strong', { text: 'Sob controle' })])
  ]);

  const action = element('button', { className: 'store-card-action', type: 'button', disabled: true }, [
    element('span', { text: 'Abrir loja' }),
    icon('arrow')
  ]);

  card.append(top, body, meta, action);
  return card;
}

function emptyState(canCreate) {
  return element('section', { className: 'empty-state' }, [
    element('div', { className: 'empty-orbit' }, [
      element('div', { className: 'empty-core', text: 'CE' }),
      element('span', { className: 'orbit-dot orbit-dot--one' }),
      element('span', { className: 'orbit-dot orbit-dot--two' })
    ]),
    element('span', { className: 'eyebrow', text: 'Primeira loja' }),
    element('h2', { text: 'Vamos transformar seu catálogo em uma loja.' }),
    element('p', {
      text: 'Você informa sua marca e conecta a fonte dos produtos. O Catalog Engine prepara a estrutura, organiza o catálogo e acompanha o processo.'
    }),
    element('button', {
      className: 'primary-button',
      type: 'button',
      disabled: !canCreate,
      text: 'Criar minha primeira loja',
      title: canCreate ? 'Criar loja' : 'A criação será liberada pelo seu acesso à plataforma.'
    }),
    !canCreate
      ? element('small', {
          className: 'empty-helper',
          text: 'A criação será liberada quando sua conta receber autorização para criar uma loja.'
        })
      : null
  ]);
}

function authenticatedPortal(session) {
  const stores = Array.isArray(session.stores) ? session.stores : [];
  const canCreate = portalCanCreateStore(session);
  const allowance = portalStoreAllowance(session);

  const layout = element('div', { className: 'portal-layout' });
  layout.append(sidebar());

  const logout = element('button', {
    className: 'secondary-button logout-button',
    type: 'button',
    text: 'Sair',
    ariaLabel: 'Sair da conta'
  });
  logout.addEventListener('click', runAuthAction(() => portalAuth.logout()));

  const content = element('main', { className: 'portal-main' });
  const pageHeader = element('header', { className: 'page-header' }, [
    element('div', {}, [
      element('span', { className: 'eyebrow', text: 'Catalog Engine' }),
      element('h1', { text: stores.length ? 'Minhas lojas' : 'Bem-vindo ao Catalog Engine' }),
      element('p', {
        text: stores.length
          ? 'Acompanhe suas lojas e continue exatamente de onde parou.'
          : 'Seu acesso está confirmado. O próximo passo é liberar e criar sua primeira loja.'
      })
    ]),
    element('div', { className: 'page-header-actions' }, [
      element('div', { className: 'account-summary' }, [
        element('small', { text: allowance ? `Acesso · ${allowance.used}/${allowance.maximum} lojas` : 'Sua conta' }),
        element('strong', { text: portalStoreCountLabel(stores) })
      ]),
      stores.length
        ? element('button', {
            className: 'primary-button primary-button--small',
            type: 'button',
            disabled: !canCreate,
            text: 'Nova loja',
            title: canCreate ? 'Criar nova loja' : 'Sua conta não possui uma loja disponível.'
          })
        : null,
      logout
    ])
  ]);

  content.append(pageHeader);

  if (!stores.length) {
    content.append(emptyState(canCreate));
  } else {
    const grid = element('section', { className: 'stores-grid', ariaLabel: 'Suas lojas' });
    for (const store of stores) grid.append(storeCard(store));
    content.append(grid);
  }

  const valueStrip = element('section', { className: 'value-strip' }, [
    element('div', {}, [element('small', { text: 'Automação' }), element('strong', { text: 'Importação automatizada' })]),
    element('div', {}, [element('small', { text: 'Organização' }), element('strong', { text: 'Catalog Engine Intelligence' })]),
    element('div', {}, [element('small', { text: 'Publicação' }), element('strong', { text: 'Seu próprio domínio' })])
  ]);
  content.append(valueStrip);
  layout.append(content, mobileNav());
  return layout;
}

function loadingState() {
  return element('div', { className: 'loading-screen' }, [
    element('div', { className: 'loading-mark', text: 'CE' }),
    element('div', { className: 'loading-line' }),
    element('p', { text: 'Carregando seu portal…' })
  ]);
}

function errorState(message) {
  const shell = element('div', { className: 'auth-shell' });
  shell.append(topbar({ compact: true }));
  shell.append(
    element('main', { className: 'error-stage' }, [
      element('div', { className: 'error-card' }, [
        element('span', { className: 'eyebrow', text: 'Portal indisponível' }),
        element('h1', { text: 'Não conseguimos carregar sua conta.' }),
        element('p', { text: message }),
        element('button', {
          className: 'secondary-button',
          text: 'Tentar novamente',
          type: 'button'
        })
      ])
    ])
  );
  shell.querySelector('button')?.addEventListener('click', () => window.location.reload());
  return shell;
}

function portalAuthMessage(code) {
  const messages = {
    portal_auth_unconfigured: 'A autenticação segura ainda precisa ser configurada para este ambiente.',
    portal_auth_config_unavailable: 'Não conseguimos consultar a configuração de acesso agora.',
    portal_auth_misconfigured: 'A configuração de acesso está incompleta. O portal permaneceu bloqueado por segurança.',
    authentication_failed: 'O provedor não concluiu o acesso. Tente entrar novamente.',
    authentication_state_invalid: 'A tentativa de acesso expirou ou não corresponde a esta sessão. Comece novamente.',
    identity_provider_unavailable: 'O provedor de identidade está indisponível no momento.',
    identity_provider_invalid_token_response: 'O provedor retornou uma sessão inválida.',
    identity_provider_refresh_token_missing: 'A renovação segura da sessão não está habilitada no provedor.',
    identity_provider_refresh_rotation_required: 'A rotação segura da sessão não está habilitada no provedor.'
  };
  return messages[code] || 'Não conseguimos concluir o acesso seguro. Tente novamente.';
}

function render(node) {
  root.replaceChildren(node);
  hydratePortalIcons(root);
}

async function accessToken() {
  const provider = window.__CATALOG_ENGINE_AUTH__;
  if (!provider || typeof provider.getAccessToken !== 'function') return null;
  return provider.getAccessToken();
}

async function loadSession(token) {
  const response = await fetch('/api/admin/session', {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'admin_temporarily_unavailable');
    error.code = payload.error || 'admin_temporarily_unavailable';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function start() {
  render(loadingState());

  let authStatus;
  try {
    authStatus = await portalAuth.initialize();
  } catch (error) {
    const message =
      error instanceof PortalAuthError
        ? portalAuthMessage(error.code)
        : 'Não conseguimos iniciar o acesso seguro agora.';
    render(errorState(message));
    return;
  }

  let token;
  try {
    token = await accessToken();
  } catch (error) {
    const message =
      error instanceof PortalAuthError
        ? portalAuthMessage(error.code)
        : 'Não conseguimos renovar seu acesso agora.';
    render(errorState(message));
    return;
  }

  if (!token) {
    render(authState({ configured: authStatus.configured }));
    return;
  }

  try {
    const session = await loadSession(token);
    render(authenticatedPortal(session));
  } catch (error) {
    if (error.status === 401) {
      await portalAuth.handleUnauthorized();
      render(authState({ configured: authStatus.configured }));
      return;
    }
    render(errorState(portalApiErrorMessage(error.code)));
  }
}

start();
