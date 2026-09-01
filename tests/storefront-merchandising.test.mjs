import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [html, source, styles, categoryStyles, worker, tenantRuntime] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/main.js', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('src/category-browser.css', 'utf8'),
  readFile('worker/index.js', 'utf8'),
  readFile('worker/tenant-catalog-runtime.js', 'utf8')
]);

describe('M9B product discovery and merchandising', () => {
  it('renders crest-led club discovery from safe public team entities', () => {
    expect(source).toContain("title: 'Clubes em destaque'");
    expect(source).toContain('clubs.slice(0, 12)');
    expect(source).toContain('resolveTeamCrest(team)?.url || null');
    expect(source).not.toContain('team.logo_url');
    expect(categoryStyles).toContain('.popular-team-card');
    expect(categoryStyles).toContain('.discovery-group-items');
  });

  it('provides touch-safe commercial categories and retail card actions', () => {
    expect(source).toContain("if (item.kind === 'teams') return 'Clubes';");
    expect(html).toContain('class="card-open"');
    expect(html).toContain('class="photo-count"');
    expect(styles).toContain('.card-open');
    expect(styles).toContain('.product-meta');
  });

  it('keeps sorting allowlisted in URL state and both serving runtimes', () => {
    expect(html).toContain('<option value="name-asc">');
    expect(worker).toContain("['name-asc', 'name-desc']");
    expect(worker).toContain('COLLATE NOCASE DESC');
    expect(tenantRuntime).toContain("['name-asc', 'name-desc']");
    expect(tenantRuntime).toContain('catalogOrderBy(sort)');
    expect(worker).not.toContain('ORDER BY ${url.searchParams');
    expect(tenantRuntime).not.toContain('ORDER BY ${url.searchParams');
  });

  it('adds only canonical public team and league labels to product cards', () => {
    for (const runtime of [worker, tenantRuntime]) {
      expect(runtime).toContain('t.name AS team_name');
      expect(runtime).toContain('l.name AS league_name');
    }
    expect(source).toContain('product.teamName || product.category');
    expect(source).not.toContain('supplier');
  });
});
