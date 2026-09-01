import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [html, source, styles, categoryStyles] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/main.js', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('src/category-browser.css', 'utf8')
]);

describe('M9A storefront commerce shell', () => {
  it('provides a responsive retail shell with landmark navigation and search', () => {
    expect(html).toContain('class="topbar-inner"');
    expect(html).toContain('aria-label="Navegação principal"');
    expect(html).toContain('id="searchForm"');
    expect(html).toContain('role="search"');
    expect(html).toContain('id="catalogo"');
    expect(html).toContain('id="explorar"');
    expect(styles).toContain('@media (max-width: 620px)');
    expect(styles).toContain('@media (max-width: 360px)');
  });

  it('keeps products near the first viewport with compact horizontal root discovery', () => {
    expect(categoryStyles).toContain('.discovery-group-items');
    expect(categoryStyles).toContain('overflow-x: auto');
    expect(source).toContain('els.categoryBrowser.dataset.view = view.kind');
  });

  it('renders structured loading, empty and retryable error states', () => {
    expect(html).toContain('id="productSkeletonTemplate"');
    expect(html).toContain('id="catalogState"');
    expect(source).toContain('function renderSkeletons()');
    expect(source).toContain("actionKind: 'retry'");
    expect(source).toContain("actionKind: refined ? 'clear' : 'retry'");
    expect(source).toContain("els.grid.setAttribute('aria-busy', String(state.loading))");
    expect(styles).toContain('@keyframes skeleton-sweep');
  });

  it('uses only the existing public store contact configuration', () => {
    expect(source).toContain("const phone = (store.whatsapp || '').replace(/\\D/g, '')");
    expect(source).toContain('els.headerContact.href = `https://wa.me/${phone}');
    expect(source).not.toContain('supplierUrl');
  });
});
