import { describe, expect, it } from 'vitest';
import {
  portalApiErrorMessage,
  portalCanCreateStore,
  portalDomainLabel,
  portalInitials,
  portalStoreAllowance,
  portalStoreCountLabel,
  portalStoreStatus
} from '../src/app/portal-model.js';

describe('customer portal view model', () => {
  it('maps store lifecycle states to merchant-facing labels', () => {
    expect(portalStoreStatus({ setupStatus: 'published' })).toMatchObject({
      label: 'Online',
      tone: 'success'
    });
    expect(portalStoreStatus({ setupStatus: 'configuring' })).toMatchObject({
      label: 'Configurando',
      tone: 'progress'
    });
    expect(portalStoreStatus({ setupStatus: 'suspended' })).toMatchObject({
      label: 'Suspensa',
      tone: 'danger'
    });
  });

  it('uses safe merchant-facing domain labels', () => {
    expect(portalDomainLabel({})).toBe('Domínio ainda não conectado');
    expect(
      portalDomainLabel({ domain: { hostname: 'loja.example.com', status: 'pending' } })
    ).toBe('loja.example.com · verificando');
    expect(
      portalDomainLabel({ domain: { hostname: 'loja.example.com', status: 'active' } })
    ).toBe('loja.example.com');
  });

  it('does not invent store-creation entitlement', () => {
    expect(portalCanCreateStore({})).toBe(false);
    expect(portalCanCreateStore({ entitlements: { canCreateStore: false } })).toBe(false);
    expect(portalCanCreateStore({ entitlements: { canCreateStore: true } })).toBe(true);
  });

  it('computes allowance and concise labels without exposing tenant terminology', () => {
    const session = {
      stores: [{}, {}],
      entitlements: { maxStores: 3, usedStores: 2 }
    };
    expect(portalStoreAllowance(session)).toEqual({ maximum: 3, used: 2, remaining: 1 });
    expect(portalStoreCountLabel(session.stores)).toBe('2 lojas');
    expect(portalInitials('Fut Store')).toBe('FS');
  });

  it('translates control-plane errors into customer-facing copy', () => {
    expect(portalApiErrorMessage('insufficient_role')).toContain('acesso');
    expect(portalApiErrorMessage('admin_temporarily_unavailable')).not.toContain('D1');
  });
});
