import './styles.css';
import {
  portalApiErrorMessage,
  portalCanCreateStore,
  portalDomainLabel,
  portalInitials,
  portalStoreAllowance,
  portalStoreCountLabel,
  portalStoreStatus
} from './portal-model.js';

const root = document.querySelector('#app');

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
  const glyphs = {
    stores: '▦',
    plus: '+',
    catalog: '◇',
    appearance: '◐',
    domain: '◎',
    billing: '◫',
    account: '○',
    arrow: '→',
    shield: '◆'
  };
  return element('span', { className: 'ce-icon', text: glyphs[name] || '•', ariaLabel: '' });
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

function authState() {
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
      element('div', { className: 'auth-point' }, [element('b', { text: '01' }), element('span', { text: 'Catálogo organizado automaticamente' })]),
      element('div', { className: 'auth-point' }, [element('b', { text: '02' }), element('span', { text: 'Cada loja isolada e independente' })]),
      element('div', { className: 'auth-point' }, [element('b', { text: '03' }), element('span', { text: 'Sincronização contínua e automática' })])
    ])
  ]);

  const accessCard = element('section', { className: 'access-card' }, [
    element('div', { className: 'access-mark' }, [icon('shield')]),
    element('span', { className: 'eyebrow eyebrow--muted', text: 'Acesso seguro' }),
    element('h2', { text: 'Entre no Catalog Engine' }),
    element('p', { text: 'Use sua conta para acessar suas lojas e continuar de onde parou.' }),
    element('button', {
      className: 'primary-button primary-button--full',
      text: 'Entrar',
      type: 'button',
      disabled: true,
      title: 'A autenticação do portal será conectada na próxima etapa.'
    }),
    element('small', {
      className: 'access-note',
      text: 'O acesso está sendo ativado com autenticação segura. Nenhuma credencial de cliente é armazenada pelo Catalog Engine.'
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
    element('div', {}, [element('small', { text: 'Sincronização' }), element('strong', { text: 'Automática' })])
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
      title: canCreate ? 'Criar loja' : 'A criação será liberada pela assinatura ativa.'
    }),
    !canCreate
      ? element('small', { className: 'empty-helper', text: 'A criação será liberada quando a assinatura da conta estiver ativa.' })
      : null
  ]);
}

function authenticatedPortal(session) {
  const stores = Array.isArray(session.stores) ? session.stores : [];
  const canCreate = portalCanCreateStore(session);
  const allowance = portalStoreAllowance(session);

  const layout = element('div', { className: 'portal-layout' });
  layout.append(sidebar());

  const content = element('main', { className: 'portal-main' });
  const pageHeader = element('header', { className: 'page-header' }, [
    element('div', {}, [
      element('span', { className: 'eyebrow', text: 'Catalog Engine' }),
      element('h1', { text: stores.length ? 'Minhas lojas' : 'Bem-vindo ao Catalog Engine' }),
      element('p', {
        text: stores.length
          ? 'Acompanhe suas lojas e continue exatamente de onde parou.'
          : 'Sua conta está pronta. O próximo passo é criar sua primeira loja.'
      })
    ]),
    element('div', { className: 'page-header-actions' }, [
      element('div', { className: 'account-summary' }, [
        element('small', { text: allowance ? `Plano · ${allowance.used}/${allowance.maximum} lojas` : 'Sua conta' }),
        element('strong', { text: portalStoreCountLabel(stores) })
      ]),
      stores.length
        ? element('button', {
            className: 'primary-button primary-button--small',
            type: 'button',
            disabled: !canCreate,
            text: 'Nova loja',
            title: canCreate ? 'Criar nova loja' : 'Seu plano não possui uma loja disponível.'
          })
        : null
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
    element('div', {}, [element('small', { text: 'Automação' }), element('strong', { text: 'Sincronização contínua' })]),
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

function render(node) {
  root.replaceChildren(node);
}

async function accessToken() {
  // Authentication remains provider-neutral. A future OIDC adapter owns token
  // acquisition and exposes it to the portal without persisting customer passwords.
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
  const token = await accessToken();
  if (!token) {
    render(authState());
    return;
  }

  try {
    const session = await loadSession(token);
    render(authenticatedPortal(session));
  } catch (error) {
    if (error.status === 401) {
      render(authState());
      return;
    }
    render(errorState(portalApiErrorMessage(error.code)));
  }
}

start();
