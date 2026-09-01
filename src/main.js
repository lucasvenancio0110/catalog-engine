import './styles.css';
import { getProductMedia, productGalleryUrls } from './catalog/media.js';
import { resolveTeamCrest } from './catalog/team-crests.js';
import { mountProductGallery } from './product/gallery.js';
import {
  canLoadNextCatalogPage,
  catalogFeedRange,
  mergeCatalogProductBatch
} from './storefront/catalog-feed.js';
import {
  buildCatalogUrl,
  hasCatalogRefinement,
  readCatalogUrlState
} from './storefront/catalog-url-state.js';
import { hydrateStorefrontIcons } from './ui/storefront-icons.js';
import { bindPressFeedback, revealCards, revealDialog } from './ui/motion.js';

const PAGE_SIZE = 15;
const initialUrlState = readCatalogUrlState(window.location.href);

const state = {
  catalog: { store: {}, stats: {}, navigation: [] },
  products: [],
  query: initialUrlState.query,
  sort: initialUrlState.sort,
  filters: initialUrlState.filters,
  pagination: {
    page: initialUrlState.page,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasPrevious: false,
    hasMore: false
  },
  feed: {
    startPage: initialUrlState.page,
    loadingMore: false,
    loadMoreError: null
  },
  loading: true,
  error: null,
  requestSequence: 0,
  activeProduct: null,
  gallery: null,
  leagues: null,
  teams: { club: null, national_team: null },
  facets: null,
  explorerStack: [
    { kind: 'root', title: 'Explorar', subtitle: 'Escolha como navegar pelo catálogo.' }
  ]
};

const supportsInfiniteScroll = 'IntersectionObserver' in window;
const prefetchedImages = new Map();
const els = {
  storeName: document.querySelector('#storeName'),
  storeLogo: document.querySelector('#storeLogo'),
  storeEyebrow: document.querySelector('#storeEyebrow'),
  headerContact: document.querySelector('#headerContact'),
  heroEyebrow: document.querySelector('#heroEyebrow'),
  heroTitle: document.querySelector('#heroTitle'),
  productCount: document.querySelector('#productCount'),
  searchForm: document.querySelector('#searchForm'),
  searchInput: document.querySelector('#searchInput'),
  clearSearch: document.querySelector('#clearSearch'),
  categoryBrowser: document.querySelector('#explorar'),
  categoryTitle: document.querySelector('#categoryTitle'),
  categorySubtitle: document.querySelector('#categorySubtitle'),
  categoryLogo: document.querySelector('#categoryLogo'),
  categoryBack: document.querySelector('#categoryBack'),
  categoryTrail: document.querySelector('#categoryTrail'),
  categoryChips: document.querySelector('#categoryChips'),
  status: document.querySelector('#status'),
  sortSelect: document.querySelector('#sortSelect'),
  clearCatalogState: document.querySelector('#clearCatalogState'),
  catalogState: document.querySelector('#catalogState'),
  catalogStateIcon: document.querySelector('#catalogStateIcon'),
  catalogStateTitle: document.querySelector('#catalogStateTitle'),
  catalogStateCopy: document.querySelector('#catalogStateCopy'),
  catalogStateAction: document.querySelector('#catalogStateAction'),
  grid: document.querySelector('#productGrid'),
  loadMore: document.querySelector('#catalogLoadMore'),
  loadMoreSkeletons: document.querySelector('#catalogLoadMoreSkeletons'),
  loadMoreStatus: document.querySelector('#catalogLoadMoreStatus'),
  loadMoreRetry: document.querySelector('#catalogLoadMoreRetry'),
  loadMoreSentinel: document.querySelector('#catalogLoadMoreSentinel'),
  template: document.querySelector('#productTemplate'),
  skeletonTemplate: document.querySelector('#productSkeletonTemplate'),
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
  const urls = products
    .slice(0, 4)
    .map((product) => getProductMedia(product)[0]?.url)
    .filter(Boolean);
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

function setFilter(next, { scroll = true } = {}) {
  state.filters = { teamId: '', leagueId: '', facetId: '', ...next };
  void loadProducts(1, { scroll, history: 'push' });
}

function catalogStateForUrl(page = state.feed.startPage) {
  return { query: state.query, sort: state.sort, filters: state.filters, page };
}

function normalizedCatalogState(page = state.feed.startPage) {
  const relativeUrl = buildCatalogUrl(window.location.href, catalogStateForUrl(page));
  return readCatalogUrlState(new URL(relativeUrl, window.location.origin));
}

function writeCatalogHistory(mode, page = state.feed.startPage) {
  if (mode === 'none') return;
  const nextUrl = buildCatalogUrl(window.location.href, catalogStateForUrl(page));
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (mode === 'push' && nextUrl === currentUrl) return;
  window.history[`${mode}State`]({ catalog: true }, '', nextUrl);
}

function applyUrlState() {
  const urlState = readCatalogUrlState(window.location.href);
  state.query = urlState.query;
  state.sort = urlState.sort;
  state.filters = urlState.filters;
  state.pagination.page = urlState.page;
  state.feed.startPage = urlState.page;
  state.feed.loadingMore = false;
  state.feed.loadMoreError = null;
  els.searchInput.value = state.query;
  els.sortSelect.value = state.sort;
}

function renderRefinementControls() {
  els.clearSearch.hidden = !state.query;
  els.clearCatalogState.hidden = !hasCatalogRefinement(catalogStateForUrl());
}

function resetExplorer() {
  state.explorerStack = [
    { kind: 'root', title: 'Explorar', subtitle: 'Escolha como navegar pelo catálogo.' }
  ];
  void renderExplorer();
}

function clearCatalogRefinements({ scroll = true } = {}) {
  state.query = '';
  resetFilters();
  els.searchInput.value = '';
  resetExplorer();
  void loadProducts(1, { scroll, history: 'push' });
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

function cardButton({
  title,
  count = null,
  subtitle = '',
  iconName = '',
  kind = '',
  onClick,
  initials = '',
  logoUrl = null,
  arrow = true,
  pressed = null
}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `category-chip ${kind}`.trim();
  if (pressed !== null) button.setAttribute('aria-pressed', String(pressed));
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
  bindPressFeedback(button, { pressedScale: kind.includes('facet-card') ? 0.96 : 0.985 });
  return button;
}

function syncTeamFacetSelection(selectedFacetId = '') {
  for (const button of els.categoryChips.querySelectorAll('.facet-card')) {
    const selected = (button.dataset.facetId || '') === selectedFacetId;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function selectTeamFacet(teamId, facetId = '') {
  syncTeamFacetSelection(facetId);
  setFilter({ teamId, facetId });
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

async function getTeams(entityType = 'club') {
  if (!['club', 'national_team'].includes(entityType)) return [];
  if (!state.teams[entityType]) {
    state.teams[entityType] =
      (await fetchJson(`/api/teams?entityType=${encodeURIComponent(entityType)}`)).items || [];
  }
  return state.teams[entityType];
}

function discoveryGroup({ eyebrow, title, subtitle, className }) {
  const section = document.createElement('section');
  section.className = `discovery-group ${className || ''}`.trim();
  const head = document.createElement('div');
  head.className = 'discovery-group-head';
  const kicker = document.createElement('span');
  kicker.className = 'eyebrow';
  kicker.textContent = eyebrow;
  const heading = document.createElement('strong');
  heading.textContent = title;
  const support = document.createElement('span');
  support.textContent = subtitle;
  head.append(kicker, heading, support);
  const items = document.createElement('div');
  items.className = 'discovery-group-items';
  section.append(head, items);
  return { section, items };
}

function navigationPriority(item) {
  if (item.kind === 'teams') return 0;
  if (item.kind === 'national_teams') return 1;
  if (item.facetId === 'kits') return 2;
  if (item.facetId === 'retro') return 3;
  if (item.facetId === 'kids') return 4;
  if (item.facetId === 'women') return 5;
  return 10;
}

function navigationTitle(item) {
  if (item.kind === 'teams') return 'Clubes';
  return item.name;
}

function navigationSubtitle(item) {
  if (item.kind === 'teams') return 'Escolha pelo escudo';
  if (item.kind === 'national_teams') return 'Países e seleções';
  if (item.facetId === 'retro') return 'Clássicos de outras épocas';
  if (item.facetId === 'kids') return 'Modelos infantis';
  return 'Explore a coleção';
}

function openNavigationItem(item) {
  if (item.kind === 'teams') {
    pushExplorer({ kind: 'countries', title: 'Clubes', subtitle: 'Escolha o país ou região.' });
  } else if (item.kind === 'national_teams') {
    pushExplorer({
      kind: 'national-teams',
      title: 'Seleções',
      subtitle: 'Seleções nacionais disponíveis.'
    });
  } else {
    setFilter({ facetId: item.facetId });
    pushExplorer({
      kind: 'facet',
      title: item.name,
      subtitle: `${Number(item.count || 0).toLocaleString('pt-BR')} produtos`,
      facetId: item.facetId
    });
  }
}

async function renderRootDiscovery() {
  const featured = discoveryGroup({
    eyebrow: 'COMPRE POR TIME',
    title: 'Explore por clube',
    subtitle: 'Toque no escudo para abrir a coleção.',
    className: 'featured-clubs'
  });
  els.categoryChips.appendChild(featured.section);

  try {
    const clubs = await getTeams('club');
    for (const team of clubs.slice(0, 12)) {
      featured.items.appendChild(
        cardButton({
          title: team.name,
          subtitle: `${Number(team.product_count || 0).toLocaleString('pt-BR')} produtos`,
          initials: team.initials,
          logoUrl: resolveTeamCrest(team)?.url || null,
          kind: 'team-card popular-team-card',
          arrow: false,
          onClick: () => openTeam(team)
        })
      );
    }
  } catch (error) {
    console.error('featured_teams_failed', error);
    featured.section.remove();
  }

  const categories = discoveryGroup({
    eyebrow: 'CATEGORIAS',
    title: 'Encontre do seu jeito',
    subtitle: 'Clubes, seleções e coleções organizadas.',
    className: 'commercial-categories'
  });
  els.categoryChips.appendChild(categories.section);
  const navigation = [...(state.catalog.navigation || [])].sort(
    (a, b) => navigationPriority(a) - navigationPriority(b)
  );
  for (const item of navigation) {
    categories.items.appendChild(
      cardButton({
        title: navigationTitle(item),
        count: item.count,
        subtitle: navigationSubtitle(item),
        iconName: navigationIconName(item),
        kind: 'root-card',
        onClick: () => openNavigationItem(item)
      })
    );
  }
}

async function renderExplorer() {
  const view = currentExplorer();
  els.categoryBrowser.dataset.view = view.kind;
  els.categoryTitle.textContent = view.title || 'Explorar';
  els.categorySubtitle.textContent = view.subtitle || '';
  els.categoryLogo.hidden = true;
  els.categoryLogo.removeAttribute('src');
  els.categoryBack.hidden = state.explorerStack.length <= 1;
  els.categoryChips.setAttribute(
    'aria-label',
    view.kind === 'team' ? `Filtrar produtos de ${view.title}` : 'Categorias disponíveis'
  );
  renderTrail();
  els.categoryChips.innerHTML = '';

  try {
    if (view.kind === 'root') {
      await renderRootDiscovery();
    } else if (view.kind === 'countries') {
      const leagues = await getLeagues();
      const groups = new Map();
      for (const league of leagues.filter((entry) => entry.entity_type === 'club')) {
        const key = league.country_code;
        const current = groups.get(key) || {
          countryCode: key,
          countryName: league.country_name,
          count: 0,
          leagues: 0
        };
        current.count += Number(league.product_count || 0);
        current.leagues += 1;
        groups.set(key, current);
      }
      for (const group of [...groups.values()].sort(
        (a, b) => b.count - a.count || a.countryName.localeCompare(b.countryName)
      )) {
        els.categoryChips.appendChild(
          cardButton({
            title: group.countryName,
            count: group.count,
            subtitle: `${group.leagues} liga${group.leagues === 1 ? '' : 's'}`,
            iconName: 'globe',
            kind: 'country-card',
            onClick: () =>
              pushExplorer({
                kind: 'leagues',
                title: group.countryName,
                crumb: group.countryName,
                subtitle: 'Escolha a competição.',
                countryCode: group.countryCode
              })
          })
        );
      }
    } else if (view.kind === 'leagues') {
      const leagues = (await getLeagues()).filter(
        (league) => league.country_code === view.countryCode && league.entity_type === 'club'
      );
      for (const league of leagues) {
        els.categoryChips.appendChild(
          cardButton({
            title: league.name,
            count: league.product_count,
            subtitle: league.country_name,
            iconName: 'trophy',
            kind: 'league-card',
            onClick: () =>
              pushExplorer({
                kind: 'teams',
                title: league.name,
                crumb: league.name,
                subtitle: 'Escolha o time.',
                leagueId: league.league_id
              })
          })
        );
      }
    } else if (view.kind === 'teams') {
      const teams =
        (
          await fetchJson(
            `/api/teams?leagueId=${encodeURIComponent(view.leagueId)}&entityType=club`
          )
        ).items || [];
      if (!teams.length) setFilter({ leagueId: view.leagueId });
      for (const team of teams) {
        els.categoryChips.appendChild(
          cardButton({
            title: team.name,
            count: team.product_count,
            initials: team.initials,
            logoUrl: resolveTeamCrest(team)?.url || null,
            kind: 'team-card',
            onClick: () => openTeam(team)
          })
        );
      }
    } else if (view.kind === 'national-teams') {
      const teams = await getTeams('national_team');
      for (const team of teams) {
        els.categoryChips.appendChild(
          cardButton({
            title: team.name,
            count: team.product_count,
            initials: team.initials,
            logoUrl: resolveTeamCrest(team)?.url || null,
            kind: 'team-card',
            onClick: () => openTeam(team)
          })
        );
      }
    } else if (view.kind === 'team') {
      const payload = await fetchJson(`/api/teams/${encodeURIComponent(view.teamId)}`);
      els.categorySubtitle.textContent = `${Number(payload.team.product_count || 0).toLocaleString('pt-BR')} produtos`;
      const crest = resolveTeamCrest(payload.team);
      if (crest) {
        els.categoryLogo.src = crest.url;
        els.categoryLogo.alt = `Escudo ${payload.team.name}`;
        els.categoryLogo.hidden = false;
      }
      const activeFacetId = state.filters.teamId === view.teamId ? state.filters.facetId || '' : '';
      const allButton = cardButton({
        title: 'Todos',
        count: payload.team.product_count,
        kind: `facet-card${activeFacetId ? '' : ' active'}`,
        arrow: false,
        pressed: !activeFacetId,
        onClick: () => selectTeamFacet(view.teamId)
      });
      allButton.dataset.facetId = '';
      els.categoryChips.appendChild(allButton);
      for (const facet of payload.facets || []) {
        const selected = activeFacetId === facet.facet_id;
        const facetButton = cardButton({
          title: facet.name,
          count: facet.product_count,
          kind: `facet-card${selected ? ' active' : ''}`,
          arrow: false,
          pressed: selected,
          onClick: () => selectTeamFacet(view.teamId, facet.facet_id)
        });
        facetButton.dataset.facetId = facet.facet_id;
        els.categoryChips.appendChild(facetButton);
      }
    } else if (view.kind === 'facet') {
      const facets = await getFacets();
      const facet = facets.find((entry) => entry.facet_id === view.facetId);
      if (facet)
        els.categorySubtitle.textContent = `${Number(facet.product_count || 0).toLocaleString('pt-BR')} produtos`;
    }
  } catch (error) {
    console.error('explorer_failed', error);
    els.categorySubtitle.textContent = 'Não foi possível carregar esta seção.';
  }

  hydrateStorefrontIcons(els.categoryChips);
}

function openTeam(team) {
  setFilter({ teamId: team.team_id }, { scroll: false });
  pushExplorer({
    kind: 'team',
    title: team.name,
    crumb: team.name,
    subtitle: `${Number(team.product_count || 0).toLocaleString('pt-BR')} produtos`,
    teamId: team.team_id
  });
}

function renderLoadMoreSkeletons() {
  els.loadMoreSkeletons.innerHTML = '';
  if (!state.feed.loadingMore) {
    els.loadMoreSkeletons.hidden = true;
    return;
  }
  for (let index = 0; index < 4; index += 1) {
    els.loadMoreSkeletons.appendChild(els.skeletonTemplate.content.cloneNode(true));
  }
  els.loadMoreSkeletons.hidden = false;
}

function renderLoadMore() {
  const { hasMore, page } = state.pagination;
  const { startPage, loadingMore, loadMoreError } = state.feed;
  const progressed = page > startPage;
  const reachedEnd = !hasMore && progressed;
  const visible =
    !state.loading &&
    !state.error &&
    state.products.length > 0 &&
    (hasMore || loadingMore || Boolean(loadMoreError) || reachedEnd);

  els.loadMore.hidden = !visible;
  els.loadMore.setAttribute('aria-busy', String(loadingMore));
  renderLoadMoreSkeletons();
  els.loadMoreRetry.hidden = true;
  els.loadMoreSentinel.hidden = true;

  if (!visible) {
    els.loadMoreStatus.textContent = '';
    return;
  }
  if (loadingMore) {
    els.loadMoreStatus.textContent = 'Carregando mais produtos…';
    return;
  }
  if (loadMoreError) {
    els.loadMoreStatus.textContent = 'Não foi possível carregar mais produtos.';
    els.loadMoreRetry.textContent = 'Tentar novamente';
    els.loadMoreRetry.hidden = false;
    return;
  }
  if (!hasMore) {
    els.loadMoreStatus.textContent = 'Você viu todos os produtos desta seleção.';
    return;
  }
  if (!supportsInfiniteScroll) {
    els.loadMoreStatus.textContent = 'Há mais produtos para explorar.';
    els.loadMoreRetry.textContent = 'Carregar mais produtos';
    els.loadMoreRetry.hidden = false;
    return;
  }

  els.loadMoreStatus.textContent = '';
  els.loadMoreSentinel.hidden = false;
}

function renderCatalogMessage({ icon, title, copy, action, actionKind }) {
  els.catalogStateIcon.innerHTML = '';
  els.catalogStateIcon.appendChild(iconNode(icon));
  els.catalogStateTitle.textContent = title;
  els.catalogStateCopy.textContent = copy;
  els.catalogStateAction.textContent = action;
  els.catalogStateAction.dataset.action = actionKind;
  els.catalogState.hidden = false;
  hydrateStorefrontIcons(els.catalogStateIcon);
}

function hideCatalogMessage() {
  els.catalogState.hidden = true;
  els.catalogStateAction.removeAttribute('data-action');
}

function renderSkeletons(target = els.grid, count = 10) {
  for (let index = 0; index < count; index += 1) {
    target.appendChild(els.skeletonTemplate.content.cloneNode(true));
  }
}

function scrollToCatalog() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  els.status.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function renderProductStatus() {
  const range = catalogFeedRange({
    startPage: state.feed.startPage,
    pageSize: state.pagination.pageSize,
    loadedCount: state.products.length,
    total: state.pagination.total
  });
  els.status.textContent = `Mostrando ${range.start}–${range.end} de ${range.total.toLocaleString('pt-BR')} produtos.`;
}

function productCardNode(product, index) {
  const node = els.template.content.cloneNode(true);
  const imageWrap = node.querySelector('.image-wrap');
  const image = node.querySelector('.product-image');
  const fallback = node.querySelector('.image-fallback');
  const photoCount = node.querySelector('.photo-count');
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
  imageWrap.setAttribute('aria-label', `Ver ${product.name}`);
  const teamLabel = node.querySelector('.product-team');
  const categoryLabel = node.querySelector('.category');
  teamLabel.textContent = product.teamName || product.category || 'Catálogo';
  categoryLabel.textContent = product.category || '';
  categoryLabel.hidden = !product.category || product.category === teamLabel.textContent;
  const imageCount = Number(product.imageCount || 0);
  if (imageCount > 1) {
    photoCount.querySelector('span').textContent = `${imageCount} fotos`;
    photoCount.hidden = false;
  }
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
  node.querySelector('.card-open').addEventListener('click', open);
  return node;
}

function appendProductCards(products, startIndex = 0) {
  if (!products.length) return;
  const fragment = document.createDocumentFragment();
  products.forEach((product, index) => {
    fragment.appendChild(productCardNode(product, startIndex + index));
  });
  els.grid.appendChild(fragment);
  hydrateStorefrontIcons(els.grid);
  revealCards(els.grid);
}

function renderProducts() {
  els.grid.innerHTML = '';
  els.grid.setAttribute('aria-busy', String(state.loading));
  els.productCount.textContent = Number(state.catalog.stats?.products || 0).toLocaleString('pt-BR');
  renderRefinementControls();
  if (state.loading) {
    els.status.textContent = state.pagination.total
      ? 'Atualizando produtos…'
      : 'Preparando a vitrine…';
    hideCatalogMessage();
    renderSkeletons();
    renderLoadMore();
    return;
  }
  if (state.error) {
    els.status.textContent = 'A vitrine não pôde ser atualizada.';
    renderCatalogMessage({
      icon: 'refresh-cw',
      title: 'Não foi possível carregar os produtos',
      copy: 'Tente novamente. Se o problema continuar, volte em alguns instantes.',
      action: 'Tentar novamente',
      actionKind: 'retry'
    });
    renderLoadMore();
    return;
  }
  if (state.products.length) {
    renderProductStatus();
    hideCatalogMessage();
  } else {
    const refined = hasCatalogRefinement(catalogStateForUrl());
    els.status.textContent = refined
      ? 'Nenhum produto corresponde à sua busca.'
      : 'Nenhum produto disponível no momento.';
    renderCatalogMessage({
      icon: refined ? 'search' : 'tag',
      title: refined ? 'Não encontramos esse produto' : 'A vitrine está sendo preparada',
      copy: refined
        ? 'Tente outro termo ou limpe a busca e os filtros para ver todo o catálogo.'
        : 'Novos produtos poderão aparecer aqui em breve.',
      action: refined ? 'Ver todos os produtos' : 'Atualizar vitrine',
      actionKind: refined ? 'clear' : 'retry'
    });
  }

  appendProductCards(state.products);
  renderLoadMore();
  scheduleInitialViewPrefetch(state.products);
}

function productsApiUrl(page) {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (state.query.trim()) params.set('q', state.query.trim());
  if (state.sort !== 'catalog') params.set('sort', state.sort);
  for (const [key, value] of Object.entries(state.filters)) if (value) params.set(key, value);
  return `/api/products?${params}`;
}

function paginationFromPayload(payload) {
  return {
    page: Number(payload.page || 1),
    pageSize: Number(payload.pageSize || PAGE_SIZE),
    total: Number(payload.total || 0),
    totalPages: Number(payload.totalPages || 0),
    hasPrevious: Boolean(payload.hasPrevious),
    hasMore: Boolean(payload.hasMore)
  };
}

async function loadProducts(page = 1, { scroll = false, history = 'none' } = {}) {
  const normalized = normalizedCatalogState(page);
  state.query = normalized.query;
  state.sort = normalized.sort;
  state.filters = normalized.filters;
  page = normalized.page;
  els.searchInput.value = state.query;
  els.sortSelect.value = state.sort;
  const requestSequence = ++state.requestSequence;
  state.pagination.page = page;
  state.feed.startPage = page;
  state.feed.loadingMore = false;
  state.feed.loadMoreError = null;
  state.loading = true;
  state.error = null;
  writeCatalogHistory(history, page);
  renderProducts();
  try {
    const payload = await fetchJson(productsApiUrl(page));
    if (requestSequence !== state.requestSequence) return;
    state.products = payload.items || [];
    state.pagination = paginationFromPayload(payload);
    state.loading = false;
    state.error = null;
    writeCatalogHistory('replace', state.feed.startPage);
    renderProducts();
    if (scroll) scrollToCatalog();
  } catch (error) {
    if (requestSequence !== state.requestSequence) return;
    console.error('catalog_products_failed', error);
    state.loading = false;
    state.error = error;
    state.products = [];
    renderProducts();
    if (scroll) scrollToCatalog();
  }
}

async function loadMoreProducts() {
  if (
    !canLoadNextCatalogPage({
      loading: state.loading,
      loadingMore: state.feed.loadingMore,
      error: state.error,
      loadMoreError: state.feed.loadMoreError,
      hasMore: state.pagination.hasMore
    })
  ) {
    return;
  }

  const nextPage = state.pagination.page + 1;
  const requestSequence = state.requestSequence;
  state.feed.loadingMore = true;
  state.feed.loadMoreError = null;
  renderLoadMore();

  try {
    const payload = await fetchJson(productsApiUrl(nextPage));
    if (requestSequence !== state.requestSequence) return;
    const previousCount = state.products.length;
    const merged = mergeCatalogProductBatch(state.products, payload.items || []);
    state.products = merged.items;
    state.pagination = paginationFromPayload(payload);
    state.feed.loadingMore = false;
    state.feed.loadMoreError = null;
    appendProductCards(merged.added, previousCount);
    renderProductStatus();
    renderLoadMore();
  } catch (error) {
    if (requestSequence !== state.requestSequence) return;
    console.error('catalog_load_more_failed', error);
    state.feed.loadingMore = false;
    state.feed.loadMoreError = error;
    renderLoadMore();
  }
}

function setupCatalogInfiniteScroll() {
  if (!supportsInfiniteScroll) return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreProducts();
    },
    { rootMargin: '600px 0px', threshold: 0 }
  );
  observer.observe(els.loadMoreSentinel);
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
  els.storeEyebrow.textContent = store.eyebrow || 'VITRINE DIGITAL';
  els.heroEyebrow.textContent = store.heroEyebrow || 'COLEÇÃO ATUAL';
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
  const phone = (store.whatsapp || '').replace(/\D/g, '');
  if (phone) {
    els.headerContact.href = `https://wa.me/${phone}?text=${encodeURIComponent('Olá! Vim pela vitrine e gostaria de ajuda.')}`;
    els.headerContact.hidden = false;
  } else {
    els.headerContact.hidden = true;
    els.headerContact.removeAttribute('href');
  }
  document.documentElement.classList.toggle('light', store.theme === 'light');
}

async function init() {
  applyUrlState();
  writeCatalogHistory('replace', state.feed.startPage);
  renderProducts();
  try {
    const [meta, products] = await Promise.all([
      fetchJson('/api/catalog/meta'),
      fetchJson(productsApiUrl(state.pagination.page))
    ]);
    state.catalog = {
      store: meta.store || {},
      stats: meta.stats || { products: products.total || 0 },
      navigation: meta.navigation || [],
      normalization: meta.normalization || {}
    };
    state.products = products.items || [];
    state.pagination = paginationFromPayload(products);
    state.feed.startPage = state.pagination.page;
    state.feed.loadingMore = false;
    state.feed.loadMoreError = null;
    state.loading = false;
    state.error = null;
    applyStoreConfig();
    await renderExplorer();
    writeCatalogHistory('replace', state.feed.startPage);
    renderProducts();
  } catch (error) {
    console.error('catalog_init_failed', error);
    state.loading = false;
    state.error = error;
    renderProducts();
  }
}

let searchTimer;
els.searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  renderRefinementControls();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadProducts(1, { history: 'push' }), 350);
});
els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  state.query = els.searchInput.value;
  void loadProducts(1, { scroll: true, history: 'push' });
});
els.clearSearch.addEventListener('click', () => {
  clearTimeout(searchTimer);
  state.query = '';
  els.searchInput.value = '';
  els.searchInput.focus();
  void loadProducts(1, { history: 'push' });
});
els.sortSelect.addEventListener('change', () => {
  state.sort = els.sortSelect.value;
  void loadProducts(1, { scroll: true, history: 'push' });
});
els.categoryBack.addEventListener('click', () => {
  if (state.explorerStack.length <= 1) return;
  state.explorerStack.pop();
  const view = currentExplorer();
  if (['root', 'countries', 'leagues', 'teams', 'national-teams'].includes(view.kind)) {
    resetFilters();
    void loadProducts(1, { history: 'push' });
  }
  void renderExplorer();
});
els.loadMoreRetry.addEventListener('click', () => {
  state.feed.loadMoreError = null;
  void loadMoreProducts();
});
els.clearCatalogState.addEventListener('click', () => clearCatalogRefinements());
els.catalogStateAction.addEventListener('click', () => {
  if (els.catalogStateAction.dataset.action === 'clear') clearCatalogRefinements();
  else void loadProducts(state.feed.startPage, { history: 'none' });
});
els.dialogClose.addEventListener('click', closeProduct);
els.dialog.addEventListener('click', (event) => {
  if (event.target === els.dialog) closeProduct();
});
els.themeToggle.addEventListener('click', () => document.documentElement.classList.toggle('light'));
window.addEventListener('popstate', () => {
  clearTimeout(searchTimer);
  applyUrlState();
  resetExplorer();
  void loadProducts(state.feed.startPage, { history: 'none' });
});

hydrateStorefrontIcons(document);
setupCatalogInfiniteScroll();
init();
