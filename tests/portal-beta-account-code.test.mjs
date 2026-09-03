import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPortalPrincipalId } from '../src/app/beta-account-code.js';

const appHtml = fs.readFileSync('app.html', 'utf8');
const helper = fs.readFileSync('src/app/beta-account-code.js', 'utf8');

describe('PB3 beta account code helper', () => {
  it('accepts only the opaque principal format already returned by the authenticated session', () => {
    expect(isPortalPrincipalId('prn_0123456789abcdefabcd')).toBe(true);
    expect(isPortalPrincipalId('user@example.com')).toBe(false);
    expect(isPortalPrincipalId('auth0|secret-subject')).toBe(false);
    expect(isPortalPrincipalId('t_00000000000000000001')).toBe(false);
  });

  it('loads only on the portal and shows a copyable account code without changing entitlement', () => {
    expect(appHtml).toContain('/src/app/beta-account-code.js');
    expect(helper).toContain("fetch('/api/admin/session'");
    expect(helper).toContain("document.querySelector('.portal-main .empty-state')");
    expect(helper).toContain("emptyState?.querySelector('.empty-helper')");
    expect(helper).toContain("text: 'Código da sua conta'");
    expect(helper).toContain("text: 'Copiar código'");
    expect(helper).toContain('navigator.clipboard?.writeText');
    expect(helper).not.toContain('/api/admin/stores');
    expect(helper).not.toContain('account_entitlements');
    expect(helper).not.toContain('tenant_memberships');
  });
});
