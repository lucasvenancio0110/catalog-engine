import './styles.css';
import { getProductMedia, productGalleryUrls } from './catalog/media.js';
import { createTaxonomyModel } from './catalog/taxonomy.js';
import { mountProductGallery } from './product/gallery.js';
import { revealCards, revealDialog } from './ui/motion.js';

const PAGE_SIZE = 15;

const state = {
  catalog: { store: {}, stats: {}, taxonomy: [] },
  taxonomy: null,
  products: [],
  query: '',
  categoryId: '',
  pagination: {
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasPrevious: false,
    hasMore: false
  },
  loading: false,
  requestSequence: 0,
  activeProduct: null,
  activeImageIndex: 0,
  gallery: null
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

function formatCount(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

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

function createCategoryButton(category, { label = category.name, active = category.id === state.categoryId } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'category-chip';
  button.dataset.categoryId = category.id;

  const name = document.createElement('span');
  name.className = 'category-chip-label';
  name.textContent = label;

  const badge = document.createElement('small');
  badge.textContent = formatCount(state.taxonomy?.count(category.id) || 0);

  const hasChildren = (state.taxonomy?.children(category.id) || []).length > 0;
  button.classList.toggle('has-children', hasChildren);
  button.classList.toggle('active', active);
  button.setAttribute('aria-current', active ? 'true' : 'false');
  button.append(name, badge);
  button.addEventListener('click', () => setCategory(category.id));
  return button;
}

function createAllCategoriesButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'category-chip category-all active';
  button.setAttribute('aria-current', 'true');

  const label = document.createElement('span');
  label.className = 'category-chip-label';
  label.textContent = 'Todos';

  const badge = document.createElement('small');
  badge.textContent = formatCount(state.catalog.stats?.products || state.pagination.total || 0);
  button.append(label, badge);
  button.addEventListener('click', () => setCategory(''));
  return button;
}

function renderCategoryTrail(selected) {
  els.categoryTrail.innerHTML = '';
  if (!selected || !state.taxonomy) {
    els.categoryTrail.hidden = true;
    return;
  }

  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.textContent = 'Todas';
  allButton.className = 'category-trail-item';
  allButton.addEventListener('click', () => setCategory(''));
  els.categoryTrail.appendChild(allButton);

  const trail = state.taxonomy.trail(selected.id);
  trail.forEach((category, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = category.name;
    button.className = 'category-trail-item';
    if (index === trail.length - 1) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => setCategory(category.id));
    els.categoryTrail.appendChild(button);
  });
  els.categoryTrail.hidden = false;
}

function renderCategoryBrowser() {
  const model = state.taxonomy;
  const roots = model?.roots() || [];
  if (!model || roots.length === 0) {
    els.categoryBrowser.hidden = true;
    return;
  }

  els.categoryBrowser.hidden = false;
  const selected = state.categoryId ? model.byId.get(state.categoryId) : null;
  const selectedCount = selected
    ? model.count(selected.id)
    : Number(state.catalog.stats?.products || state.pagination.total || 0);

  els.categoryTitle.textContent = selected ? selected.name : 'Categorias';
  els.categorySubtitle.textContent = `${formatCount(selectedCount)} produto${selectedCount === 1 ? '' : 's'}`;
  els.categoryBack.hidden = !selected;
  renderCategoryTrail(selected);
  els.categoryChips.innerHTML = '';

  if (!selected) {
    els.categoryChips.appendChild(createAllCategoriesButton());
    for (const category of roots) els.categoryChips.appendChild(createCategoryButton(category));
    return;
  }

  const children = model.children(selected.id);
  if (children.length) {
    els.categoryChips.appendChild(createCategoryButton(selected, { label: 'Todos', active: true }));
    for (const category of children) els.categoryChips.appendChild(createCategoryButton(category));
    return;
  }

  const siblings = selected.parentId ? model.children(selected.parentId) : roots;
  for (const category of siblings) els.categoryChips.appendChild(createCategoryButton(category));
}

function setCategory(categoryId = '') {
  state.categoryId = categoryId && state.taxonomy?.byId.has(categoryId) ? categoryId : '';
  renderCategoryBrowser();
  void loadProducts(1, { scroll: true });
}

function renderPagination() {
  const { page, totalPages, hasPrevious, hasMore } = state.pagination;
  els.pagination.hidden = state.loading || totalPages <= 1;
  els.pageInfo.textContent = totalPages ? `Página ${page} de ${totalPages}` : '';
  els.previousPage.disabled = !hasPrevious || state.loading;
  els.nextPage.disabled = !hasMore || state.loading;
}

async function openFromCard(imageWrap, product) {
  if (imageWrap.dataset.opening === 'true') return;
  imageWrap.dataset.opening = 'true';
  imageWrap.classList.add('is-loading');
  imageWrap.setAttribute('aria-busy', 'true');
  try {
    await openProduct(product);
  } finally {
    imageWrap.dataset.opening = 'false';
    imageWrap.classList.remove('is-loading');
    imageWrap.removeAttribute('aria-busy');
  }
}

function renderProducts() {
  const products = state.products;
  els.grid.innerHTML = '';

  const catalogTotal = Number(state.catalog.stats?.products || state.pagination.total || 0);
  els.productCount.textContent = formatCount(catalogTotal);

  if (state.loading) {
    els.status.textContent = 'Carregando produtos…';
    renderPagination();
    return;
  }

  if (products.length) {
    const start = (state.pagination.page - 1) * state.pagination.pageSize + 1;
    const end = start + products.length - 1;
    els.status.textContent = `Mostrando ${formatCount(start)}–${formatCount(end)} de ${formatCount(state.pagination.total)} produto${state.pagination.total === 1 ? '' : 's'}.`;
  } else {
    els.status.textContent = 'Nenhum produto encontrado com esses filtros.';
  }

  for (const [index, product] of products.entries()) {
    const node = els.template.content.cloneNode(true);
    const imageWrap = node.querySelector('.image-wrap');
    const image = node.querySelector('.product-image');
    const fallback = node.querySelector('.image-fallback');
    const media = getProductMedia(product);
    const firstImage = media[0]?.thumbnailUrl || media[0]?.url;

    imageWrap.setAttribute('aria-label', `Abrir ${product.name}`);

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
    const descriptionText = String(product.description || '').trim();
    description.textContent = descriptionText;
    description.hidden = !descriptionText;

    const prefetchHero = () => prefetchImage(media[0]?.url);
    imageWrap.addEventListener('pointerenter', prefetchHero, { once: true });
    imageWrap.addEventListener('focus', prefetchHero, { once: true });
    imageWrap.addEventListener('touchstart', prefetchHero, { once: true, passive: true });
    imageWrap.addEventListener('click', () => void openFromCard(imageWrap, product));
    imageWrap.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void openFromCard(imageWrap, product);
    });

    els.grid.appendChild(node);
  }

  renderPagination();
  revealCards(els.grid);
  scheduleInitialViewPrefetch(products);
}

async function loadProducts(page = 1, { scroll = false } = {}) {
  const requestSequence = ++state.requestSequence;
  state.loading = true;
  renderProducts();

  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE)
  });
  if (state.query.trim()) params.set('q', state.query.trim());
  if (state.categoryId) params.set('categoryId', state.categoryId);

  try {
    const response = await fetch(`/api/products?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
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

function syncActiveImage(index) {
  if (!state.activeProduct) return;
  state.activeImageIndex = index;
  [...els.dialogThumbs.querySelectorAll('button')].forEach((button, buttonIndex) => {
    const active = buttonIndex === index;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'true' : 'false');
  });
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
    img.fetchPriority = index === 0 ? 'high' : 'low';

    button.appendChild(img);
    button.addEventListener('click', () => state.gallery?.slideTo(index));
    els.dialogThumbs.appendChild(button);
  });
}

function showProduct(product) {
  state.gallery?.destroy();
  state.gallery = null;
  state.activeProduct = product;
  state.activeImageIndex = 0;

  const images = productGalleryUrls(product);
  els.dialogCategory.textContent = product.category || 'Catálogo';
  els.dialogName.textContent = product.name;

  const description = String(product.description || '').trim();
  els.dialogDescription.textContent = description;
  els.dialogDescription.hidden = !description;

  renderThumbs(product);

  if (images.length) {
    els.productSwiper.hidden = false;
    state.gallery = mountProductGallery(els.productSwiper, images, product.name, syncActiveImage);
    syncActiveImage(0);
  } else {
    els.productSwiper.hidden = true;
  }

  const phone = (state.catalog.store?.whatsapp || '').replace(/\D/g, '');
  if (phone) {
    const message = encodeURIComponent(`Olá! Tenho interesse em: ${product.name}`);
    els.whatsappButton.href = `https://wa.me/${phone}?text=${message}`;
    els.whatsappButton.hidden = false;
  } else {
    els.whatsappButton.hidden = true;
    els.whatsappButton.removeAttribute('href');
  }

  els.dialog.showModal();
  revealDialog(els.dialog);
}

async function openProduct(product) {
  let fullProduct = product;
  if ((product.media?.length || 0) < Number(product.imageCount || 0)) {
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
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
    const [metaResponse, productsResponse] = await Promise.all([
      fetch('/api/catalog/meta'),
      fetch(`/api/products?page=1&limit=${PAGE_SIZE}`)
    ]);
    if (!metaResponse.ok) throw new Error(`Meta HTTP ${metaResponse.status}`);
    if (!productsResponse.ok) throw new Error(`Products HTTP ${productsResponse.status}`);

    const [meta, productsPayload] = await Promise.all([
      metaResponse.json(),
      productsResponse.json()
    ]);

    state.catalog = {
      store: meta.store || {},
      stats: meta.stats || { products: productsPayload.total || 0 },
      taxonomy: meta.taxonomy || [],
      generatedAt: meta.generatedAt || null,
      storage: meta.storage || {}
    };
    state.products = productsPayload.items || [];
    state.pagination = {
      page: Number(productsPayload.page || 1),
      pageSize: Number(productsPayload.pageSize || PAGE_SIZE),
      total: Number(productsPayload.total || 0),
      totalPages: Number(productsPayload.totalPages || 0),
      hasPrevious: Boolean(productsPayload.hasPrevious),
      hasMore: Boolean(productsPayload.hasMore)
    };
    state.taxonomy = createTaxonomyModel(state.catalog.taxonomy, []);
    state.loading = false;

    applyStoreConfig();
    renderCategoryBrowser();
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
  searchTimer = setTimeout(() => {
    void loadProducts(1);
  }, 300);
});

els.categoryBack.addEventListener('click', () => {
  const selected = state.taxonomy?.byId.get(state.categoryId);
  setCategory(selected?.parentId || '');
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

init();
