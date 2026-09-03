import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

describe('PB3 customer portal bootstrap', () => {
  it('loads the authenticated portal shell before the create-store enhancement', () => {
    const shell = html.indexOf('/src/app/main.js');
    const createStore = html.indexOf('/src/app/store-creation-bootstrap.js');
    expect(shell).toBeGreaterThan(-1);
    expect(createStore).toBeGreaterThan(shell);
  });

  it('keeps the portal non-indexable while enabling store creation', () => {
    expect(html).toContain('noindex,nofollow,noarchive');
    expect(html).toContain('name="referrer" content="no-referrer"');
  });
});
