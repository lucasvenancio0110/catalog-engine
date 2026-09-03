const STORE_STATUS = {
  published: { label: 'Online', tone: 'success' },
  ready: { label: 'Pronta', tone: 'success' },
  configuring: { label: 'Configurando', tone: 'progress' },
  provisioning: { label: 'Configurando', tone: 'progress' },
  draft: { label: 'Rascunho', tone: 'neutral' },
  attention: { label: 'Atenção', tone: 'warning' },
  suspended: { label: 'Suspensa', tone: 'danger' }
};

function clean(value) {
  return String(value || '').trim();
}

export function portalStoreStatus(store = {}) {
  const candidates = [store.setupStatus, store.tenantStatus]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);

  for (const key of candidates) {
    if (STORE_STATUS[key]) return { key, ...STORE_STATUS[key] };
  }

  return { key: 'draft', ...STORE_STATUS.draft };
}

export function portalDomainLabel(store = {}) {
  const hostname = clean(store.domain?.hostname);
  if (!hostname) return 'Domínio ainda não conectado';
  if (store.domain?.status === 'active') return hostname;
  return `${hostname} · verificando`;
}

export function portalInitials(name = '') {
  const words = clean(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return 'CE';
  return words.map((word) => word[0]?.toUpperCase() || '').join('');
}

export function portalStoreCountLabel(stores = []) {
  const count = Array.isArray(stores) ? stores.length : 0;
  if (count === 0) return 'Nenhuma loja criada';
  if (count === 1) return '1 loja';
  return `${count} lojas`;
}

export function portalCanCreateStore(session = {}) {
  return session?.entitlements?.canCreateStore === true;
}

export function portalStoreAllowance(session = {}) {
  const maximum = Number(session?.entitlements?.maxStores);
  const used = Number(session?.entitlements?.usedStores ?? session?.stores?.length ?? 0);
  if (!Number.isFinite(maximum) || maximum < 1) return null;
  return {
    maximum,
    used: Number.isFinite(used) && used >= 0 ? used : 0,
    remaining: Math.max(0, maximum - (Number.isFinite(used) ? used : 0))
  };
}

export function portalApiErrorMessage(code = '') {
  const key = clean(code).toLowerCase();
  const messages = {
    unauthorized: 'Sua sessão terminou. Entre novamente para continuar.',
    admin_auth_unavailable: 'O acesso seguro do portal ainda não está configurado.',
    control_plane_database_unbound: 'O portal está temporariamente indisponível.',
    admin_temporarily_unavailable: 'Não foi possível carregar sua conta agora. Tente novamente em instantes.',
    invalid_request: 'Revise os dados da loja antes de continuar.',
    invalid_store_name: 'Informe um nome de loja com pelo menos 2 caracteres.',
    invalid_store_slug: 'Escolha um endereço curto com pelo menos 3 caracteres, usando letras, números e hífens.',
    invalid_store_currency: 'Escolha uma moeda válida para a loja.',
    invalid_store_creation_response: 'A loja foi processada, mas o portal não conseguiu confirmar o resultado. Atualize a página antes de tentar novamente.',
    store_slug_unavailable: 'Esse endereço de loja já está em uso. Escolha outro.',
    store_creation_not_entitled: 'Seu acesso beta ainda não está liberado para criar uma loja.',
    store_limit_reached: 'Sua conta já usou a quantidade de lojas disponível neste acesso.',
    store_entitlement_misconfigured: 'Seu acesso precisa de uma revisão antes de criar a loja.',
    store_not_found: 'Essa loja não está disponível para sua conta.',
    insufficient_role: 'Seu acesso não permite fazer essa alteração.'
  };
  return messages[key] || 'Não foi possível concluir essa ação agora.';
}
