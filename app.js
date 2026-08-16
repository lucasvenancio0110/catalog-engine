const state = { catalog: null, query: '', category: '', activeProduct: null, activeImageIndex: 0 };

const els = {
  storeName: document.querySelector('#storeName'),
  productCount: document.querySelector('#productCount'),
  searchInput: document.querySelector('#searchInput'),
  categorySelect: document.querySelector('#categorySelect'),
  status: document.querySelector('#status'),
  grid: document.querySelector('#productGrid'),
  template: document.querySelector('#productTemplate'),
  dialog: document.querySelector('#productDialog'),
  dialogClose: document.querySelector('#dialogClose'),
  dialogImage: document.querySelector('#dialogImage'),
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
    ? product.images.map((image) => typeof image === 'string' ? image : image?.url).filter(Boolean)
    : [];
}

function filteredProducts() {
  const query = normalize(state.query);
  return state.catalog.products.filter((product) => {
    const haystack = normalize(`${product.name} ${product.category} ${product.description}`);
    const matchQuery = !query || haystack.includes(query);
    const matchCategory = !state.category || product.category === state.category;
    return matchQuery && matchCategory;
  });
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
    node.querySelector('.description').textContent = product.description || `${images.length || 0} foto${images.length === 1 ? '' : 's'} disponíveis em alta qualidade.`;
    node.querySelector('.details').addEventListener('click', () => openProduct(product));
    els.grid.appendChild(node);
  }
}

function setActiveImage(index) {
  const product = state.activeProduct;
  if (!product) return;

  const images = getImages(product);
  const image = images[index];
  if (!image) return;

  state.activeImageIndex = index;
  els.dialogImage.src = image;
  els.dialogImage.alt = `${product.name} — foto ${index + 1}`;
  els.dialogImage.hidden = false;

  const extension = image.split('.').pop()?.split('?')[0] || 'jpg';
  els.downloadImageButton.href = image;
  els.downloadImageButton.download = `${slugify(product.name)}-${String(index + 1).padStart(2, '0')}.${extension}`;
  els.downloadImageButton.hidden = false;

  [...els.dialogThumbs.querySelectorAll('button')].forEach((button, buttonIndex) => {
    button.classList.toggle('active', buttonIndex === index);
    button.setAttribute('aria-current', buttonIndex === index ? 'true' : 'false');
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
    button.addEventListener('click', () => setActiveImage(index));
    els.dialogThumbs.appendChild(button);
  });
}

function openProduct(product) {
  state.activeProduct = product;
  state.activeImageIndex = 0;

  const images = getImages(product);
  els.dialogCategory.textContent = product.category || 'Catálogo';
  els.dialogName.textContent = product.name;
  els.dialogDescription.textContent = product.description || 'Fotos extraídas em alta qualidade do catálogo conectado.';
  els.dialogPhotoCount.textContent = images.length
    ? `${images.length} foto${images.length === 1 ? '' : 's'} em alta qualidade`
    : 'Sem fotos disponíveis';

  renderThumbs(product);

  if (images.length) {
    setActiveImage(0);
  } else {
    els.dialogImage.hidden = true;
    els.downloadImageButton.hidden = true;
  }

  const phone = (state.catalog.store?.whatsapp || '').replace(/\D/g, '');
  if (phone) {
    const message = encodeURIComponent(`Olá! Tenho interesse em: ${product.name}`);
    els.whatsappButton.href = `https://wa.me/${phone}?text=${message}`;
    els.whatsappButton.hidden = false;
  } else {
    // White-label: nunca expõe a URL do fornecedor como fallback.
    els.whatsappButton.hidden = true;
    els.whatsappButton.removeAttribute('href');
  }

  els.dialog.showModal();
}

async function init() {
  try {
    const response = await fetch('./data/catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.catalog = await response.json();
    els.storeName.textContent = state.catalog.store?.name || 'Catálogo';
    document.title = state.catalog.store?.name || 'Catálogo';

    const categories = [...new Set(state.catalog.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    for (const category of categories) {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      els.categorySelect.appendChild(option);
    }

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
  state.category = event.target.value;
  render();
});

els.dialogClose.addEventListener('click', () => els.dialog.close());
els.dialog.addEventListener('click', (event) => {
  if (event.target === els.dialog) els.dialog.close();
});
els.themeToggle.addEventListener('click', () => document.documentElement.classList.toggle('light'));

init();
