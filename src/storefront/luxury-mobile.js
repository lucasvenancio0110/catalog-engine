import { bindPressFeedback } from '../ui/motion.js';

const grid = document.querySelector('#productGrid');
const showcase = document.querySelector('#heroShowcase');
const heroImage = document.querySelector('#heroProductImage');
const heroName = document.querySelector('#heroProductName');
const heroMeta = document.querySelector('#heroProductMeta');
const clearCatalogState = document.querySelector('#clearCatalogState');

function enhanceProductCards() {
  if (!grid) return;

  for (const card of grid.querySelectorAll('.card:not(.skeleton-card)')) {
    if (card.dataset.densityEnhanced === 'true') continue;

    const imageWrap = card.querySelector('.image-wrap');
    const openButton = card.querySelector('.card-open');
    const productName = card.querySelector('.product-name')?.textContent?.trim();
    if (!openButton || !productName) continue;

    imageWrap?.removeAttribute('role');
    imageWrap?.removeAttribute('tabindex');
    imageWrap?.removeAttribute('aria-label');

    openButton.setAttribute('aria-label', `Ver detalhes de ${productName}`);
    card.dataset.motionPress = '';
    card.dataset.densityEnhanced = 'true';
    bindPressFeedback(openButton, { pressedScale: 0.985, visualTarget: card });
  }
}

function syncHeroProduct() {
  if (!grid || !showcase || !heroImage || !heroName || !heroMeta) return;

  const firstCard = grid.querySelector('.card:not(.skeleton-card)');
  const productImage = firstCard?.querySelector('.product-image:not([hidden])');
  const productName = firstCard?.querySelector('.product-name')?.textContent?.trim();

  if (!firstCard || !productImage?.src || !productName) {
    showcase.hidden = true;
    return;
  }

  const team = firstCard.querySelector('.product-team')?.textContent?.trim();
  const category = firstCard.querySelector('.category:not([hidden])')?.textContent?.trim();
  const meta = [team, category].filter(Boolean).join(' · ');

  heroImage.src = productImage.currentSrc || productImage.src;
  heroImage.alt = productName;
  heroName.textContent = productName;
  heroMeta.textContent = meta || 'Da coleção';
  showcase.hidden = false;
}

function syncGridEnhancements() {
  enhanceProductCards();
  syncHeroProduct();
}

if (clearCatalogState) {
  clearCatalogState.setAttribute('aria-label', 'Limpar busca e filtros');
}

if (grid) {
  const observer = new MutationObserver(() => window.requestAnimationFrame(syncGridEnhancements));
  observer.observe(grid, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'hidden']
  });
  syncGridEnhancements();
}
