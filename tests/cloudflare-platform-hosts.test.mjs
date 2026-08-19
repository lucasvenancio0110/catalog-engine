import { describe, expect, it } from 'vitest';
import { planPlatformHostRecord } from '../scripts/configure-cloudflare-platform-hosts.mjs';

describe('Cloudflare platform host DNS planning', () => {
  const host = 'app.catalogoengine.com';
  const target = 'origin.catalogoengine.com';

  it('creates the platform host when no DNS record exists', () => {
    expect(planPlatformHostRecord({ records: [], host, target })).toEqual({ action: 'create', recordId: null });
  });

  it('does nothing when the proxied CNAME is already correct', () => {
    expect(
      planPlatformHostRecord({
        host,
        target,
        records: [
          { id: 'dns_1', name: host, type: 'CNAME', content: `${target}.`, proxied: true, ttl: 1 }
        ]
      })
    ).toEqual({ action: 'noop', recordId: 'dns_1' });
  });

  it('updates a stale CNAME without replacing the record identity', () => {
    expect(
      planPlatformHostRecord({
        host,
        target,
        records: [{ id: 'dns_2', name: host, type: 'CNAME', content: 'old.example.com', proxied: false, ttl: 300 }]
      })
    ).toEqual({ action: 'update', recordId: 'dns_2' });
  });

  it('fails closed instead of deleting a conflicting DNS type', () => {
    expect(() =>
      planPlatformHostRecord({
        host,
        target,
        records: [{ id: 'dns_3', name: host, type: 'A', content: '192.0.2.10', proxied: true, ttl: 1 }]
      })
    ).toThrow('platform_host_conflicting_dns_type_a');
  });

  it('fails closed when multiple records claim the same platform hostname', () => {
    expect(() =>
      planPlatformHostRecord({
        host,
        target,
        records: [
          { id: 'dns_4', name: host, type: 'CNAME', content: target, proxied: true, ttl: 1 },
          { id: 'dns_5', name: host, type: 'CNAME', content: target, proxied: true, ttl: 1 }
        ]
      })
    ).toThrow('platform_host_multiple_dns_records');
  });
});
