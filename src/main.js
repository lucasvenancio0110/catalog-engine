import './styles.css';
import { getProductMedia, productGalleryUrls } from './catalog/media.js';
import { mountProductGallery } from './product/gallery.js';
import { hydrateStorefrontIcons } from './ui/storefront-icons.js';
import { revealCards, revealDialog } from './ui/motion.js';

const PAGE_SIZE = 15;

const state = {
  catalog: { store: {}, stats: {}, navigation: [] },
  products: [],
  query: '',
  filters: { teamId: '', leagueId: '', facetId: '' },
  pagination: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0, hasPrevious: false, hasMore: false },
  loading: false,
  requestSequence: 0,
  activeProduct: null,
  gallery: null,
  leagues: null,
  facets: null,
  explorerStack: [{ kind: 'root', title: 'Explorar', subtitle: 'Escolha como navegar pelo catálogo.' }]
};

const prefetchedImages = new Map();
const els = {
  storeName: document.querySelector('#storeName'),
  storeLogo: document.querySelector('#storeLogo'),
  storeEyebrow: document.querySelector('#storeEyebrow'),
  heroEyebrow: document.querySelector('#heroEyebrow'),
  heroTitle: document.querySelector('#heroTitle'),
  productCount: document.querySelector('#productCount'),
  searchInput: document.querySelector('#searchInput'),
  categoryBrowser: document.querySelector('#categoryBrowser'),
  categoryTitle: document.querySelector('#categoryTitle'),
  categorySubtitle: document.querySelector('#categorySubtitle'),
  categoryBack: document.querySelector('#categoryBack'),
  categoryTrail: document.querySelector('#categoryTrail'),
  categoryChips: document.querySelector('#categoryChips'),
  status: document.querySelector('#status'),
  grid: document.querySelector('#productGrid'),
  pagination: document.querySelector('#pagination'),
  pageInfo: document.querySelector('#pageInfo'),
  previousPage: document.querySelector('#previousPage'),
  nextPage: document.querySelector('#nextPage'),
  template: document.querySelector('#productTemplate'),
  dialog: document.querySelector('#productDialog'),
  dialogClose: document.querySelector('#dialogClose'),
  productSwiper: document.querySelector('#productSwiper'),
  dialogThumbs: document.querySelector('#dialogThumbs'),
  dialogCategory: document.querySelector('#dialogCategory'),
  dialogName: document.querySelector('#dialogName'),
  dialogDescription: document.querySelector('#dialogDescription'),
  whatsappButton: document.querySelector('#whatsappButton'),
  themeToggle: document.querySelector('#themeToggle')
};

function prefetchImage(url) {
  if (!url || prefetchedImages.has(url)) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  prefetchedImages.set(url, image);
  const release = () => setTimeout(() => prefetchedImages.delete(url), 30_000);
  image.addEventListener('load', release, { once: true });
  image.addEventListener('error', release, { once: true });
}

function scheduleInitialViewPrefetch(products) {
  const urls = products.slice(0, 4).map((product) => getProductMedia(product)[0]?.url).filter(Boolean);
  const run = () => urls.forEach(prefetchImage);
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1800 });
  else setTimeout(run, 600);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function currentExplorer() {
  return state.explorerStack[state.explorerStack.length - 1];
}

function pushExplorer(view) {
  state.explorerStack.push(view);
  void renderExplorer();
}

function resetFilters() {
  state.filters = { teamId: '', leagueId: '', facetId: '' };
}

function setFilter(next) {
  state.filters = { teamId: '', leagueId: '', facetId: '', ...next };
  void loadProducts(1, { scroll: true });
}

function iconNode(name, className = '') {
  const node = document.createElement('i');
  if (className) node.className = className;
  node.dataset.lucide = name;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function navigationIconName(item) {
  if (item.kind === 'teams') return 'users';
  if (item.kind === 'national_teams') return 'flag';
  if (item.facetId === 'kits') return 'shirt';
  if (item.facetId === 'kids') return 'baby';
  if (item.facetId === 'women') return 'users';
  if (item.facetId === 'shoes') return 'footprints';
  if (item.facetId === 'retro') return 'history';
  return 'tag';
}

function cardButton({ title, count = null, subtitle = '', iconName = '', kind = '', onClick, initials = '', logoUrl = null, arrow = true }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `category-chip ${kind}`.trim();
  const lead = document.createElement('span');
  lead.className = 'category-card-lead';

  if (kind.includes('team')) {
    const mark = document.createElement('span');
    mark.className = 'team-mark';
    if (logoUrl) {
      const img = document.createElement('img');
      img.src = logoUrl;
      img.alt = '';
      img.loading = 'lazy';
      mark.appendChild(img);
    } else {
      mark.textContent = initials || title.slice(0, 3).toUpperCase();
    }
    lead.appendChild(mark);
  } else if (iconName) {
    const iconWrap = document.createElement('span');
    iconWrap.className = 'category-icon';
    iconWrap.appendChild(iconNode(iconName));
    lead.appendChild(iconWrap);
  }

  const copy = document.createElement('span');
  copy.className = 'category-card-copy';
  const strong = document.createElement('strong');
  strong.textContent = title;
  copy.appendChild(strong);
  if (subtitle) {
    const small = document.createElement('span');
    small.textContent = subtitle;
    copy.appendChild(small);
  }
  lead.appendChild(copy);
  button.appendChild(lead);

  if (count !== null && Number.isFinite(Number(count))) {
    const badge = document.createElement('small');
    badge.className = 'category-count';
    badge.textContent = Number(count).toLocaleString('pt-BR');
    button.appendChild(badge);
  }
  if (arrow) {
    button.appendChild(iconNode('chevron-right', 'category-arrow'));
  }
  button.addEventListener('click', onClick);
  return button;
}

function renderTrail() {
  els.categoryTrail.innerHTML = '';
  const items = state.explorerStack.slice(1);
  if (!items.length) {
    els.categoryTrail.hidden = true;
    return;
  }
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-trail-item';
    button.textContent = item.crumb || item.title;
    if (index === items.length - 1) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      state.explorerStack = state.explorerStack.slice(0, index + 2);
      void renderExplorer();
    });
    els.categoryTrail.appendChild(button);
  });
  els.categoryTrail.hidden = false;
}

async function getLeagues() {
  if (!state.leagues) state.leagues = (await fetchJson('/api/leagues')).items || [];
  return state.leagues;
}

async function getFacets() {
  if (!state.facets) state.facets = (await fetchJson('/api/facets')).items || [];
  return state.facets;
}

async function renderExplorer() {
  const view = currentExplorer();
  els.categoryTitle.textContent = view.title || 'Explorar';
  els.categorySubtitle.textContent = view.subtitle || '';
  els.categoryBack.hidden = state.explorerStack.length <= 1;
  renderTrail();
  els.categoryChips.innerHTML = '';

  try {
    if (view.kind === 'root') {
      for (const item of state.catalog.navigation || []) {
        els.categoryChips.appendChild(cardButton({
          title: item.name,
          count: item.count,
          iconName: navigationIconName(item),
          kind: 'root-card',
          onClick: () => {
            if (item.kind === 'teams') {
              pushExplorer({ kind: 'countries', title: 'Times', subtitle: 'Escolha o país ou região.' });
            } else if (item.kind === 'national_teams') {
              pushExplorer({ kind: 'national-teams', title: 'Seleções', subtitle: 'Seleções nacionais disponíveis.' });
            } else {
              setFilter({ facetId: item.facetId });
              pushExplorer({ kind: 'facet', title: item.name, subtitle: `${Number(item.count || 0).toLocaleString('pt-BR')} produtos`, facetId: item.facetId });
            }
          }
        }));
      }
    } else if (view.kind === 'countries') {
      const leagues = await getLeagues();
      const groups = new Map();
      for (const league of leagues.filter((entry) => entry.entity_type === 'club')) {
        const key = league.country_code;
        const current = groups.get(key) || { countryCode: key, countryName: league.country_name, count: 0, leagues: 0 };
        current.count += Number(league.product_count || 0);
        current.leagues += 1;
        groups.set(key, current);
      }
      for (const group of [...groups.values()].sort((a, b) => b.count - a.count || a.countryName.localeCompare(b.countryName))) {
        els.categoryChips.appendChild(cardButton({
          title: group.countryName,
          count: group.count,
          subtitle: `${group.leagues} liga${group.leagues === 1 ? '' : 's'}`,
          iconName: 'globe',
          kind: 'country-card',
          onClick: () => pushExplorer({ kind: 'leagues', title: group.countryName, crumb: group.countryName, subtitle: 'Escolha a competição.', countryCode: group.countryCode })
        }));
      }
    } else if (view.kind === 'leagues') {
      const leagues = (await getLeagues()).filter((league) => league.country_code === view.countryCode && league.entity_type === 'club');
      for (const league of leagues) {
        els.categoryChips.appendChild(cardButton({
          title: league.name,
          count: league.product_count,
          subtitle: league.country_name,
          iconName: 'trophy',
          kind: 'league-card',
          onClick: () => pushExplorer({ kind: 'teams', title: league.name, crumb: league.name, subtitle: 'Escolha o time.', leagueId: league.league_id })
        }));
      }
    } else if (view.kind === 'teams') {
      const teams = (await fetchJson(`/api/teams?leagueId=${encodeURIComponent(view.leagueId)}&entityType=club`)).items || [];
      if (!teams.length) setFilter({ leagueId: view.leagueId });
      for (const team of teams) {
        els.categoryChips.appendChild(cardButton({
          title: team.name,
          count: team.product_count,
          initials: team.initials,
          logoUrl: team.logo_url,
          kind: 'team-card',
          onClick: () => openTeam(team)
        }));
      }
    } else if (view.kind === 'national-teams') {
      const teams = (await fetchJson('/api/teams?entityType=national_team')).items || [];
      for (const team of teams) {
        els.categoryChips.appendChild(cardButton({
          title: team.name,
          count: team.product_count,
          initials: team.initials,
          logoUrl: team.logo_url,
          kind: 'team-card',
          onClick: () => openTeam(team)
        }));
      }
    } else if (view.kind === 'team') {
      const payload = await fetchJson(`/api/teams/${encodeURIComponent(view.teamId)}`);
      els.categorySubtitle.textContent = `${Number(payload.team.product_count || 0).toLocaleString('pt-BR')} produtos`;
      els.categoryChips.appendChild(cardButton({
        title: 'Todos',
        count: payload.team.product_count,
        kind: 'facet-card active',
        arrow: false,
        onClick: () => setFilter({ teamId: view.teamId })
      }));
      for (const facet of payload.facets || []) {
        els.categoryChips.appendChild(cardButton({
          title: facet.name,
          count: facet.product_count,
          kind: 'facet-card',
          arrow: false,
          onClick: () => setFilter({ teamId: view.teamId, facetId: facet.facet_id })
        }));
      }
    } else if (view.kind === 'facet') {
      const facets = await getFacets();
      const facet = facets.find((entry) => entry.facet_id === view.facetId);
      if (facet) els.categorySubtitle.textContent = `${Number(facet.product_count || 0).toLocaleString('pt-BR')} produtos`;
    }
  } catch (error) {
    console.error('explorer_failed', error);
    els.categorySubtitle.textContent = 'Não foi possível carregar esta seção.';
  }

  hydrateStorefrontIcons(els.categoryChips);
}

function openTeam(team) {
  setFilter({ teamId: team.team_id });
  pushExplorer({ kind: 'team', title: team.name, crumb: team.name, subtitle: `${Number(team.product_count || 0).toLocaleString('pt-BR')} produtos`, teamId: team.team_id });
}

function renderPagination() {
  const { page, totalPages, hasPrevious, hasMore } = state.pagination;
  els.pagination.hidden = state.loading || totalPages <= 1;
  els.pageInfo.textContent = totalPages ? `Página ${page} de ${totalPages}` : '';
  els.previousPage.disabled = !hasPrevious || state.loading;
  els.nextPage.disabled = !hasMore || state.loading;
}

function renderProducts() {
  els.grid.innerHTML = '';
  els.productCount.textContent = Number(state.catalog.stats?.products || 0).toLocaleString('pt-BR');
  if (state.loading) {
    els.status.textContent = 'Carregando produtos…';
    renderPagination();
    return;
  }
  if (state.products.length) {
    const start = (state.pagination.page - 1) * state.pagination.pageSize + 1;
    const end = start + state.products.length - 1;
    els.status.textContent = `Mostrando ${start}–${end} de ${state.pagination.total.toLocaleString('pt-BR')} produtos.`;
  } else {
    els.status.textContent = 'Nenhum produto encontrado com esses filtros.';
  }

  for (const [index, product] of state.products.entries()) {
    const node = els.template.content.cloneNode(true);
    const imageWrap = node.querySelector('.image-wrap');
    const image = node.querySelector('.product-image');
    const fallback = node.querySelector('.image-fallback');
    const media = getProductMedia(product);
    const firstImage = media[0]?.thumbnailUrl || media[0]?.url;
    if (firstImage) {
      image.loading = index < 4 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.fetchPriority = index < 4 ? 'high' : 'low';
      image.src = firstImage;
      image.alt = product.name;
      fallback.hidden = true;
      image.addEventListener('error', () => {
        image.hidden = true;
        fallback.hidden = false;
      });
    } else {
      image.hidden = true;
      fallback.hidden = false;
    }
    node.querySelector('.category').textContent = product.category || 'Catálogo';
    node.querySelector('.product-name').textContent = product.name;
    const description = node.querySelector('.description');
    description.textContent = product.description || '';
    description.hidden = !product.description;

    const prefetchHero = () => prefetchImage(media[0]?.url);
    imageWrap.addEventListener('pointerenter', prefetchHero, { once: true });
    imageWrap.addEventListener('focus', prefetchHero, { once: true });
    imageWrap.addEventListener('touchstart', prefetchHero, { once: true, passive: true });
    const open = () => void openProduct(product);
    imageWrap.addEventListener('click', open);
    imageWrap.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    els.grid.appendChild(node);
  }
  renderPagination();
  revealCards(els.grid);
  scheduleInitialViewPrefetch(state.products);
}

async function loadProducts(page = 1, { scroll = false } = {}) {
  const requestSequence = ++state.requestSequence;
  state.loading = true;
  renderProducts();
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (state.query.trim()) params.set('q', state.query.trim());
  for (const [key, value] of Object.entries(state.filters)) if (value) params.set(key, value);
  try {
    const payload = await fetchJson(`/api/products?${params}`);
    if (requestSequence !== state.requestSequence) return;
    state.products = payload.items || [];
    state.pagination = {
      page: Number(payload.page || 1),
      pageSize: Number(payload.pageSize || PAGE_SIZE),
      total: Number(payload.total || 0),
      totalPages: Number(payload.totalPages || 0),
      hasPrevious: Boolean(payload.hasPrevious),
      hasMore: Boolean(payload.hasMore)
    };
    state.loading = false;
    renderProducts();
    if (scroll) els.status.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (requestSequence !== state.requestSequence) return;
    console.error(error);
    state.loading = false;
    state.products = [];
    els.grid.innerHTML = '';
    els.status.textContent = 'Não foi possível carregar os produtos.';
    renderPagination();
  }
}

function renderThumbs(product) {
  const media = getProductMedia(product);
  els.dialogThumbs.innerHTML = '';
  media.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb-button';
    button.setAttribute('aria-label', `Abrir foto ${index + 1}`);
    const img = document.createElement('img');
    img.src = entry.thumbnailUrl || entry.url;
    img.alt = '';
    img.loading = index === 0 ? 'eager' : 'lazy';
    img.decoding = 'async';
    button.appendChild(img);
    button.addEventListener('click', () => state.gallery?.slideTo(index));
    els.dialogThumbs.appendChild(button);
  });
}

function showProduct(product) {
  state.gallery?.destroy();
  state.gallery = null;
  state.activeProduct = product;
  const images = productGalleryUrls(product);
  els.dialogCategory.textContent = product.category || 'Catálogo';
  els.dialogName.textContent = product.name;
  els.dialogDescription.textContent = product.description || '';
  els.dialogDescription.hidden = !product.description;
  renderThumbs(product);
  if (images.length) {
    els.productSwiper.hidden = false;
    state.gallery = mountProductGallery(els.productSwiper, images, product.name, (index) => {
      [...els.dialogThumbs.querySelectorAll('button')].forEach((button, buttonIndex) => {
        button.classList.toggle('active', buttonIndex === index);
      });
    });
  } else {
    els.productSwiper.hidden = true;
  }
  const phone = (state.catalog.store?.whatsapp || '').replace(/\D/g, '');
  if (phone) {
    els.whatsappButton.href = `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Tenho interesse em: ${product.name}`)}`;
    els.whatsappButton.hidden = false;
  } else {
    els.whatsappButton.hidden = true;
  }
  els.dialog.showModal();
  revealDialog(els.dialog);
}

async function openProduct(product) {
  let fullProduct = product;
  if ((product.media?.length || 0) < Number(product.imageCount || 0)) {
    try {
      const payload = await fetchJson(`/api/products/${encodeURIComponent(product.id)}`);
      if (payload.product) fullProduct = payload.product;
    } catch (error) {
      console.error('product_detail_failed', error);
    }
  }
  showProduct(fullProduct);
}

function closeProduct() {
  els.dialog.close();
  state.gallery?.destroy();
  state.gallery = null;
  state.activeProduct = null;
}

function applyStoreConfig() {
  const store = state.catalog.store || {};
  const name = store.name || 'Catálogo';
  els.storeName.textContent = name;
  els.storeEyebrow.textContent = store.eyebrow || 'CATÁLOGO DIGITAL';
  els.heroEyebrow.textContent = store.heroEyebrow || 'NOVIDADES';
  els.heroTitle.textContent = store.heroTitle || 'Encontre o produto certo.';
  document.title = name;
  if (store.logo) {
    els.storeLogo.src = store.logo;
    els.storeLogo.alt = `Logo ${name}`;
    els.storeLogo.hidden = false;
  } else {
    els.storeLogo.hidden = true;
    els.storeLogo.removeAttribute('src');
  }
  document.documentElement.classList.toggle('light', store.theme === 'light');
}

async function init() {
  try {
    const [meta, products] = await Promise.all([
      fetchJson('/api/catalog/meta'),
      fetchJson(`/api/products?page=1&limit=${PAGE_SIZE}`)
    ]);
    state.catalog = {
      store: meta.store || {},
      stats: meta.stats || { products: products.total || 0 },
      navigation: meta.navigation || [],
      normalization: meta.normalization || {}
    };
    state.products = products.items || [];
    state.pagination = {
      page: Number(products.page || 1),
      pageSize: Number(products.pageSize || PAGE_SIZE),
      total: Number(products.total || 0),
      totalPages: Number(products.totalPages || 0),
      hasPrevious: Boolean(products.hasPrevious),
      hasMore: Boolean(products.hasMore)
    };
    state.loading = false;
    applyStoreConfig();
    await renderExplorer();
    renderProducts();
  } catch (error) {
    console.error(error);
    state.loading = false;
    els.status.textContent = 'Não foi possível carregar o catálogo.';
  }
}

let searchTimer;
els.searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadProducts(1), 300);
});
els.categoryBack.addEventListener('click', () => {
  if (state.explorerStack.length <= 1) return;
  state.explorerStack.pop();
  const view = currentExplorer();
  if (['root', 'countries', 'leagues', 'teams', 'national-teams'].includes(view.kind)) {
    resetFilters();
    void loadProducts(1);
  }
  void renderExplorer();
});
els.previousPage.addEventListener('click', () => {
  if (state.pagination.hasPrevious) void loadProducts(state.pagination.page - 1, { scroll: true });
});
els.nextPage.addEventListener('click', () => {
  if (state.pagination.hasMore) void loadProducts(state.pagination.page + 1, { scroll: true });
});
els.dialogClose.addEventListener('click', closeProduct);
els.dialog.addEventListener('click', (event) => {
  if (event.target === els.dialog) closeProduct();
});
els.themeToggle.addEventListener('click', () => document.documentElement.classList.toggle('light'));

hydrateStorefrontIcons(document);
init();
