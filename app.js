const state = { catalog: null, query: '', category: '' };

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
  dialogCategory: document.querySelector('#dialogCategory'),
  dialogName: document.querySelector('#dialogName'),
  dialogDescription: document.querySelector('#dialogDescription'),
  whatsappButton: document.querySelector('#whatsappButton'),
  themeToggle: document.querySelector('#themeToggle')
};

function normalize(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
    const firstImage = product.images?.[0];

    if (firstImage) {
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
    node.querySelector('.description').textContent = product.description || 'Confira as fotos e fale com a loja para mais detalhes.';
    node.querySelector('.details').addEventListener('click', () => openProduct(product));
    els.grid.appendChild(node);
  }
}

function openProduct(product) {
  const image = product.images?.[0];
  els.dialogImage.hidden = !image;
  if (image) {
    els.dialogImage.src = image;
    els.dialogImage.alt = product.name;
  }
  els.dialogCategory.textContent = product.category || 'Catálogo';
  els.dialogName.textContent = product.name;
  els.dialogDescription.textContent = product.description || 'Entre em contato para consultar detalhes, disponibilidade e valores.';

  const phone = (state.catalog.store?.whatsapp || '').replace(/\D/g, '');
  const message = encodeURIComponent(`Olá! Tenho interesse em: ${product.name}`);
  els.whatsappButton.href = phone ? `https://wa.me/${phone}?text=${message}` : product.sourceUrl;
  els.whatsappButton.textContent = phone ? 'Pedir no WhatsApp' : 'Ver referência';
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
els.themeToggle.addEventListener('click', () => document.documentElement.classList.toggle('light'));

init();
