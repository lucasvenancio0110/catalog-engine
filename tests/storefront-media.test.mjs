import { describe, expect, it } from 'vitest';
import { getProductMedia, productGalleryUrls } from '../src/catalog/media.js';

describe('storefront media compatibility', () => {
  it('uses optimized web/thumb while preserving original HD download URL', () => {
    const product = {
      images: ['./assets/media/web/hash.webp'],
      media: [{
        url: './assets/media/web/hash.webp',
        thumbnailUrl: './assets/media/thumb/hash.webp',
        downloadUrl: './assets/media/original/hash.jpg',
        width: 1600,
        height: 2133,
        bytes: 2500000,
        format: 'jpeg'
      }]
    };
    const [media] = getProductMedia(product);
    expect(media.url).toContain('/web/');
    expect(media.thumbnailUrl).toContain('/thumb/');
    expect(media.downloadUrl).toContain('/original/');
    expect(productGalleryUrls(product)).toEqual(['./assets/media/web/hash.webp']);
  });

  it('keeps legacy image strings working during migration', () => {
    const [media] = getProductMedia({ images: ['./assets/catalog/p_x/01.jpg'] });
    expect(media.url).toBe('./assets/catalog/p_x/01.jpg');
    expect(media.thumbnailUrl).toBe(media.url);
    expect(media.downloadUrl).toBe(media.url);
  });
});
