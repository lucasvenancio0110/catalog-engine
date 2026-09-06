import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const files = Promise.all([
  readFile(new URL('../src/app/private-preview.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/source-connection-bootstrap.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/storefront/private-preview.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/storefront/private-preview.css', import.meta.url), 'utf8'),
  readFile(new URL('../worker/private-preview-routing.js', import.meta.url), 'utf8')
]);

describe('PB9 portal private preview experience', () => {
  it('shows preview only after server readiness and creates the session with bearer auth', async () => {
    const [client, bootstrap] = await files;
    expect(client).toContain('/preview-status');
    expect(client).toContain('/preview-session');
    expect(client).toContain('authorization: `Bearer ${token}`');
    expect(bootstrap).toContain("card.dataset.catalogAction = 'preview'");
    expect(bootstrap).toContain('Visualizar loja');
    expect(bootstrap).toContain('preview.available');
    expect(bootstrap).toContain('window.location.assign(session.previewUrl)');
  });

  it('keeps preparation truth when preview readiness is absent instead of fabricating completion', async () => {
    const [, bootstrap] = await files;
    expect(bootstrap).toContain('Preparando catálogo');
    expect(bootstrap).toContain('Ver andamento');
    expect(bootstrap).toContain('previewReady = false');
    expect(bootstrap).not.toMatch(/\bETA\b|estimad[oa]|\bpercent\b/i);
  });

  it('labels preview as private on desktop and phone without exposing infrastructure language', async () => {
    const [, , notice, css] = await files;
    expect(notice).toContain('VISUALIZAÇÃO PRIVADA');
    expect(notice).toContain('Esta loja ainda não está publicada');
    expect(notice).toContain('Voltar ao painel');
    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(':focus-visible');
    expect(`${notice}\n${css}`).not.toMatch(/\bD1\b|Worker|dispatch|Cloudflare|database ID/i);
  });

  it('keeps raw runtime locators server-side and returns only a fixed preview URL to the browser', async () => {
    const [client, , , , routing] = await files;
    expect(routing).toContain("{ previewUrl: '/preview', expiresAt: session.expiresAt }");
    expect(client).toContain("payload.previewUrl !== '/preview'");
    expect(client).not.toMatch(/workerScriptName|runtime_kind|runtime_status|TENANT_DISPATCH/);
  });
});
