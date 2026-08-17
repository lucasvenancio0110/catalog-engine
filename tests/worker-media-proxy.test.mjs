import { describe, expect, it } from 'vitest';
import {
  mediaCacheKey,
  normalizeMediaId,
  parseAllowedSourceHosts,
  publicMediaHeaders,
  safeRefererUrl,
  safeSourceUrl
} from '../worker/media-proxy.js';

describe('worker media proxy guards', () => {
  it('accepts only opaque media ids', () => {
    expect(normalizeMediaId('m_0123456789abcdefabcd')).toBe('m_0123456789abcdefabcd');
    expect(normalizeMediaId('https://photo.yupoo.com/image.jpg')).toBeNull();
    expect(normalizeMediaId('m_123')).toBeNull();
  });

  it('defaults to the Yupoo photo origin and supports explicit allowlists', () => {
    expect(parseAllowedSourceHosts('')).toEqual(['photo.yupoo.com']);
    expect(parseAllowedSourceHosts('photo.yupoo.com,*.example-cdn.com')).toEqual([
      'photo.yupoo.com',
      '*.example-cdn.com'
    ]);

    expect(safeSourceUrl('https://photo.yupoo.com/a/b.jpg')).toBeInstanceOf(URL);
    expect(safeSourceUrl('https://img.example-cdn.com/a.jpg', ['*.example-cdn.com'])).toBeInstanceOf(URL);
    expect(safeSourceUrl('https://evil.example/a.jpg')).toBeNull();
    expect(safeSourceUrl('http://photo.yupoo.com/a.jpg')).toBeNull();
  });

  it('only forwards safe Yupoo referers', () => {
    expect(safeRefererUrl('https://supplier.x.yupoo.com/albums/123')).toContain('supplier.x.yupoo.com');
    expect(safeRefererUrl('https://evil.example/albums/123')).toBeNull();
  });

  it('publishes only image-safe response headers', () => {
    const headers = publicMediaHeaders(
      new Headers({
        'content-type': 'image/webp',
        etag: 'abc',
        'set-cookie': 'private=1',
        server: 'origin'
      })
    );

    expect(headers.get('content-type')).toBe('image/webp');
    expect(headers.get('etag')).toBe('abc');
    expect(headers.get('set-cookie')).toBeNull();
    expect(headers.get('server')).toBeNull();
    expect(publicMediaHeaders(new Headers({ 'content-type': 'text/html' }))).toBeNull();
  });

  it('removes query strings from edge cache keys', () => {
    const key = mediaCacheKey(
      new Request('https://catalog.example/media/m_0123456789abcdefabcd?tracking=1')
    );
    expect(new URL(key.url).search).toBe('');
  });
});
