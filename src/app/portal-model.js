const STORE_STATUS = {
  published: { label: 'Online', tone: 'success' },
  ready: { label: 'Pronta para preview', tone: 'success' },
  configuring: { label: 'Preparando loja', tone: 'progress' },
  provisioning: { label: 'Preparando loja', tone: 'progress' },
  draft: { label: 'Em preparação', tone: 'neutral' },
  attention: { label: 'Precisa de atenção', tone: 'warning' },
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
  if (!hostname) return 'Domínio será configurado antes da publicação';
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
    branding_temporarily_unavailable: 'Não foi possível carregar a aparência da loja agora. Tente novamente em instantes.',
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
    insufficient_role: 'Seu acesso não permite fazer essa alteração.',
    branding_invalid_store_name: 'Use um nome de loja entre 2 e 80 caracteres.',
    branding_theme_unavailable: 'Esse estilo não está disponível para a loja.',
    branding_invalid_primary_color: 'Revise a cor principal da marca.',
    branding_invalid_secondary_color: 'Revise a cor de apoio da marca.',
    branding_invalid_whatsapp: 'Informe o WhatsApp com código do país, por exemplo +55.',
    branding_invalid_instagram: 'Revise o perfil do Instagram.',
    brand_assets_unavailable: 'O envio de logo está temporariamente indisponível.',
    brand_asset_type_unsupported: 'Use uma logo em PNG, JPEG ou WebP.',
    brand_asset_too_large: 'A logo deve ter no máximo 2 MB.',
    brand_asset_invalid_image: 'Não conseguimos validar essa imagem. Escolha outro arquivo.',
    brand_asset_dimensions_invalid: 'Use uma logo entre 32 e 4096 pixels por lado.',
    brand_asset_storage_failed: 'Não foi possível salvar a logo agora. Sua configuração anterior foi preservada.',
    invalid_supplier_url: 'Cole um link HTTPS válido do seu catálogo Yupoo.',
    unsupported_supplier_host: 'Neste beta, conecte um catálogo no formato sualoja.x.yupoo.com.',
    unsupported_supplier_scope: 'Esse link do Yupoo não representa um catálogo ou categoria compatível. Use o link principal de álbuns.',
    supplier_source_unreachable: 'Não conseguimos acessar esse catálogo agora. Confira o link e tente novamente.',
    supplier_redirect_rejected: 'Esse link redirecionou para um endereço não permitido. Use o link original do catálogo Yupoo.',
    supplier_redirect_limit: 'Esse catálogo redirecionou muitas vezes. Tente usar o endereço principal do Yupoo.',
    supplier_source_not_found: 'O catálogo não foi encontrado nesse endereço. Confira o link antes de continuar.',
    supplier_source_unavailable: 'O catálogo respondeu com uma indisponibilidade temporária. Tente novamente em instantes.',
    source_change_requires_reset: 'Esse catálogo já possui dados importados. Trocar a fonte exige uma redefinição segura antes de continuar.',
    source_state_unavailable: 'Não foi possível consultar a fonte da loja agora. Tente novamente em instantes.',
    source_state_invalid: 'A fonte salva não pôde ser confirmada com segurança. Nenhuma alteração foi feita.',
    source_connection_failed: 'Não foi possível conectar o catálogo agora. Tente novamente em instantes.',
    source_connection_response_invalid: 'A fonte foi processada, mas o portal não conseguiu confirmar o resultado com segurança. Atualize a página antes de tentar novamente.',
    import_decision_temporarily_unavailable: 'Não foi possível consultar a decisão de importação agora. Sua loja continua preservada.',
    import_decision_state_unavailable: 'Não foi possível consultar a importação agora. Tente novamente em instantes.',
    import_decision_state_invalid: 'O estado da importação não pôde ser confirmado com segurança. Nenhuma alteração foi feita.',
    import_decision_source_required: 'Conecte uma fonte válida antes de definir a importação.',
    import_decision_source_invalid: 'A fonte conectada não pôde ser usada com segurança para esta importação.',
    import_decision_invalid: 'Essa opção de importação não está disponível neste beta.',
    import_decision_failed: 'Não foi possível confirmar a importação agora. Tente novamente em instantes.'
  };
  return messages[key] || 'Não foi possível concluir essa ação agora.';
}