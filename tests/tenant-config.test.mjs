import { describe, expect, it } from 'vitest';
import {
  createTenantId,
  normalizeTenantProvisionRequest,
  normalizeTenantStoreProfile,
  toPublicStoreConfig
} from '../src/domain/tenant-config.js';

describe('tenant configuration', () => {
  it('creates opaque stable-shape tenant ids', () => {
    const tenantId = createTenantId();
    expect(tenantId).toMatch(/^t_[a-f0-9]{20}$/);
  });

  it('normalizes store branding and public contact fields', () => {
    const profile = normalizeTenantStoreProfile({
      tenantId: 't_00000000000000000001',
      storeName: ' Loja Arena ',
      logoPath: '/branding/t_00000000000000000001/logo.webp',
      whatsapp: '+55 (41) 99999-0000',
      instagram: '@Loja.Arena',
      currency: 'brl',
      themeKey: 'stadium',
      primaryColor: '#111827',
      secondaryColor: '#f9fafb',
      homeSections: ['new-arrivals', 'clubs', 'leagues'],
      setupStatus: 'ready'
    });

    expect(profile.storeName).toBe('Loja Arena');
    expect(profile.whatsapp).toBe('5541999990000');
    expect(profile.instagram).toBe('loja.arena');
    expect(profile.currency).toBe('BRL');
    expect(toPublicStoreConfig(profile)).toMatchObject({
      name: 'Loja Arena',
      instagram: '@loja.arena',
      theme: 'stadium'
    });
  });

  it('rejects remote logo hotlinks in tenant branding', () => {
    expect(() =>
      normalizeTenantStoreProfile({
        tenantId: 't_00000000000000000001',
        storeName: 'Loja Arena',
        logoPath: 'https://supplier.example/logo.png'
      })
    ).toThrow();
  });

  it('rejects duplicate home sections', () => {
    expect(() =>
      normalizeTenantStoreProfile({
        tenantId: 't_00000000000000000001',
        storeName: 'Loja Arena',
        homeSections: ['clubs', 'clubs']
      })
    ).toThrow();
  });

  it('validates tenant provisioning input without storing authentication secrets', () => {
    const request = normalizeTenantProvisionRequest({
      storeName: 'Minha Loja FC',
      slug: 'minha-loja-fc',
      themeKey: 'premium-dark'
    });

    expect(request).toEqual({
      storeName: 'Minha Loja FC',
      slug: 'minha-loja-fc',
      themeKey: 'premium-dark',
      currency: 'BRL'
    });
  });
});
