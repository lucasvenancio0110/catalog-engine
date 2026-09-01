const grid = document.querySelector('#productGrid');
const showcase = document.querySelector('#heroShowcase');
const heroImage = document.querySelector('#heroProductImage');
const heroName = document.querySelector('#heroProductName');
const heroMeta = document.querySelector('#heroProductMeta');

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

if (grid) {
  const observer = new MutationObserver(() => window.requestAnimationFrame(syncHeroProduct));
  observer.observe(grid, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'hidden']
  });
  syncHeroProduct();
}
