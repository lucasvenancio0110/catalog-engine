import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile('src/main.js', 'utf8');

describe('storefront server-backed search contract', () => {
  it('sends the trimmed user query to the products API', () => {
    expect(source).toContain("if (state.query.trim()) params.set('q', state.query.trim());");
    expect(source).toContain('fetchJson(`/api/products?${params}`)');
  });

  it('debounces interactive search requests', () => {
    expect(source).toContain("els.searchInput.addEventListener('input'");
    expect(source).toContain('clearTimeout(searchTimer)');
    expect(source).toContain('setTimeout(() => void loadProducts(1), 300)');
  });

  it('keeps page and active catalog filters in the same API query', () => {
    expect(source).toContain("new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })");
    expect(source).toContain("for (const [key, value] of Object.entries(state.filters)) if (value) params.set(key, value);");
  });
});
