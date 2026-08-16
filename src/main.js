import './styles.css';
import { createProductSearch } from './catalog/search.js';
import { createTaxonomyModel } from './catalog/taxonomy.js';
import { mountProductGallery } from './product/gallery.js';
import { revealCards, revealDialog } from './ui/motion.js';

const state = {
  catalog: null,
  search: null,
  taxonomy: null,
  query: '',
  categoryId: '',
  activeProduct: null,
  activeImageIndex: 0,
  gallery: null
};

const els = {
  storeName: document.querySelector('#storeName'),
  storeLogo: document.querySelector('#storeLogo'),
  storeEyebrow: document.querySelector('#storeEyebrow'),
  heroEyebrow: document.querySelector('#heroEyebrow'),
  heroTitle: document.querySelector('#heroTitle'),
  productCount: document.querySelector('#productCount'),
  searchInput: document.querySelector('#searchInput'),
  categorySelect: document.querySelector('#categorySelect'),
  categoryBrowser: document.querySelector('#categoryBrowser'),
  categoryTitle: document.querySelector('#categoryTitle'),
  categoryBack: document.querySelector('#categoryBack'),
  categoryTrail: document.querySelector('#categoryTrail'),
  categoryChips: document.querySelector('#categoryChips'),
  status: document.querySelector('#status'),
  grid: document.querySelector('#productGrid'),
  template: document.querySelector('#productTemplate'),
  dialog: document.querySelector('#productDialog'),
  dialogClose: document.querySelector('#dialogClose'),
  productSwiper: document.querySelector('#productSwiper'),
  dialogThumbs: document.querySelector('#dialogThumbs'),
  dialogCategory: document.querySelector('#dialogCategory'),
  dialogName: document.querySelector('#dialogName'),
  dialogDescription: document.querySelector('#dialogDescription'),
  dialogPhotoCount: document.querySelector('#dialogPhotoCount'),
  downloadImageButton: document.querySelector('#downloadImageButton'),
  whatsappButton: document.querySelector('#whatsappButton'),
  themeToggle: document.querySelector('#themeToggle')
};

function normalize(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function slugify(value = 'produto') {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'produto';
}

function getImages(product) {
  return Array.isArray(product.images)
    ? product.images.map((image) => (typeof image === 'string' ? image : image?.url)).filter(Boolean)
    : [];
}

function filteredProducts() {
  const source = state.query.trim() && state.search ? state.search(state.query) : state.catalog.products;
  if (!state.categoryId || !state.taxonomy) return source;
  return source.filter((product) => state.taxonomy.productMatches(product, state.categoryId));
}

function categoryButton(category, selectedId = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'category-chip';
  button.dataset.categoryId = category.id;
  const count = state.taxonomy?.count(category.id) || 0;
  button.innerHTML = `<span>${category.name}</span><small>${count}</small>`;
  const active = category.id === selectedId;
  button.classList.toggle('active', active);
  button.setAttribute('aria-current', active ? 'true' : 'false');
  button.addEventListener('click', () => setCategory(category.id));
  return button;
}

function renderCategoryTrail(selected) {
  els.categoryTrail.innerHTML = '';
  if (!selected || !state.taxonomy) {
    els.categoryTrail.hidden = true;
    return;
  }

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
  els.categoryTrail.hidden = trail.length === 0;
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
  els.categoryTitle.textContent = selected
    ? `${selected.name} · ${model.count(selected.id)} produto${model.count(selected.id) === 1 ? '' : 's'}`
    : 'Todas as categorias';
  els.categoryBack.hidden = !selected;
  renderCategoryTrail(selected);
  els.categoryChips.innerHTML = '';

  let entries = roots;
  if (selected) {
    const children = model.children(selected.id);
    if (children.length) {
      entries = children;
    } else if (selected.parentId) {
      entries = model.children(selected.parentId);
    } else {
      entries = roots;
    }
  }

  for (const category of entries) {
    els.categoryChips.appendChild(categoryButton(category, state.categoryId));
  }
}

function renderCategorySelect() {
  els.categorySelect.innerHTML = '<option value="">Todas</option>';
  if (!state.taxonomy) return;

  const categories = [...state.taxonomy.byId.values()]
    .filter((category) => state.taxonomy.count(category.id) > 0)
    .sort((a, b) => (a.depth || 0) - (b.depth || 0) || a.name.localeCompare(b.name));

  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = `${'— '.repeat(Math.min(category.depth || 0, 4))}${category.name} (${state.taxonomy.count(category.id)})`;
    els.categorySelect.appendChild(option);
  }
  els.categorySelect.value = state.categoryId;
}

function syncCategoryControls() {
  els.categorySelect.value = state.categoryId;
  renderCategoryBrowser();
}

function setCategory(categoryId = '') {
  state.categoryId = categoryId && state.taxonomy?.byId.has(categoryId) ? categoryId : '';
  syncCategoryControls();
  render();
}

function renderCategoryControls() {
  renderCategorySelect();
  renderCategoryBrowser();
}

function render() {
  const products = filteredProducts();
  els.grid.innerHTML = '';
  els.productCount.textContent = state.catalog.products.length;
  els.status.textContent = products.length
    ? `${products.length} produto${products.length === 1 ? '' : 's'} encontrado${products.length === 1 ? '' : 's'}`
    : 'Nenhum produto encontrado com esses filtros.';

  for (const product of products) {
    const node = els.template.content.cloneNode(true);
    const image = node.querySelector('.product-image');
    const fallback = node.querySelector('.image-fallback');
    const photoCount = node.querySelector('.photo-count');
    const images = getImages(product);
    const firstImage = images[0];

    if (firstImage) {
      image.src = firstImage;
      image.alt = product.name;
      fallback.hidden = true;
      photoCount.hidden = false;
      photoCount.textContent = `${images.length} foto${images.length === 1 ? '' : 's'} HD`;
      image.addEventListener('error', () => {
        image.hidden = true;
        fallback.hidden = false;
      });
    } else {
      image.hidden = true;
      fallback.hidden = false;
      photoCount.hidden = true;
    }

    node.querySelector('.category').textContent = product.category || 'Catálogo';
    node.querySelector('.product-name').textContent = product.name;
    node.querySelector('.description').textContent =
      product.description || `${images.length || 0} foto${images.length === 1 ? '' : 's'} disponíveis em alta qualidade.`;
    node.querySelector('.details').addEventListener('click', () => openProduct(product));
    els.grid.appendChild(node);
  }

  revealCards(els.grid);
}

function syncActiveImage(index) {
  const product = state.activeProduct;
  if (!product) return;

  const images = getImages(product);
  const image = images[index];
  if (!image) return;

  state.activeImageIndex = index;
  const allowDownload = state.catalog.store?.showDownload !== false;
  if (allowDownload) {
    const extension = image.split('.').pop()?.split('?')[0] || 'jpg';
    els.downloadImageButton.href = image;
    els.downloadImageButton.download = `${slugify(product.name)}-${String(index + 1).padStart(2, '0')}.${extension}`;
    els.downloadImageButton.hidden = false;
  } else {
    els.downloadImageButton.hidden = true;
    els.downloadImageButton.removeAttribute('href');
  }

  [...els.dialogThumbs.querySelectorAll('button')].forEach((button, buttonIndex) => {
    const active = buttonIndex === index;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'true' : 'false');
  });
}

function renderThumbs(product) {
  const images = getImages(product);
  els.dialogThumbs.innerHTML = '';

  images.forEach((image, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb-button';
    button.setAttribute('aria-label', `Abrir foto ${index + 1}`);

    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    img.loading = 'lazy';

    button.appendChild(img);
    button.addEventListener('click', () => state.gallery?.slideTo(index));
    els.dialogThumbs.appendChild(button);
  });
}

function openProduct(product) {
  state.gallery?.destroy();
  state.gallery = null;
  state.activeProduct = product;
  state.activeImageIndex = 0;

  const images = getImages(product);
  els.dialogCategory.textContent = product.category || 'Catálogo';
  els.dialogName.textContent = product.name;
  els.dialogDescription.textContent = product.description || 'Fotos disponíveis em alta qualidade.';
  els.dialogPhotoCount.textContent = images.length
    ? `${images.length} foto${images.length === 1 ? '' : 's'} em alta qualidade`
    : 'Sem fotos disponíveis';

  renderThumbs(product);

  if (images.length) {
    els.productSwiper.hidden = false;
    state.gallery = mountProductGallery(els.productSwiper, images, product.name, syncActiveImage);
    syncActiveImage(0);
  } else {
    els.productSwiper.hidden = true;
    els.downloadImageButton.hidden = true;
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
    const response = await fetch('./data/catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.catalog = await response.json();
    state.search = createProductSearch(state.catalog.products || []);
    state.taxonomy = createTaxonomyModel(state.catalog.taxonomy || [], state.catalog.products || []);
    applyStoreConfig();
    renderCategoryControls();
    render();
  } catch (error) {
    console.error(error);
    els.status.textContent = 'Não foi possível carregar o catálogo.';
  }
}

els.searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  render();
});

els.categorySelect.addEventListener('change', (event) => {
  setCategory(event.target.value);
});

els.categoryBack.addEventListener('click', () => {
  const selected = state.taxonomy?.byId.get(state.categoryId);
  setCategory(selected?.parentId || '');
});

els.dialogClose.addEventListener('click', closeProduct);
els.dialog.addEventListener('click', (event) => {
  if (event.target === els.dialog) closeProduct();
});
els.themeToggle.addEventListener('click', () => document.documentElement.classList.toggle('light'));

init();
