import { describe, expect, it } from 'vitest';
import {
  resolveYupooSourceUrl,
  subcategoryVariant
} from '../scripts/yupoo-source-resolver.mjs';

function response(status) {
  return {
    status,
    body: { cancel: async () => {} }
  };
}

describe('Yupoo source route resolver', () => {
  it('does not modify normal album routes', async () => {
    const resolved = await resolveYupooSourceUrl('https://supplier.x.yupoo.com/albums/');
    expect(resolved).toBe('https://supplier.x.yupoo.com/albums/');
  });

  it('keeps a root category when its normal route works', async () => {
    const calls = [];
    const resolved = await resolveYupooSourceUrl('https://supplier.x.yupoo.com/categories/490727', {
      fetchImpl: async (url) => {
        calls.push(url);
        return response(200);
      }
    });
    expect(calls).toHaveLength(1);
    expect(resolved).toBe('https://supplier.x.yupoo.com/categories/490727');
  });

  it('automatically switches a 404 category to the Yupoo subcategory route', async () => {
    const calls = [];
    const resolved = await resolveYupooSourceUrl('https://supplier.x.yupoo.com/categories/66243', {
      fetchImpl: async (url) => {
        calls.push(url);
        return response(url.includes('isSubCate=true') ? 200 : 404);
      }
    });
    expect(calls).toHaveLength(2);
    expect(resolved).toBe('https://supplier.x.yupoo.com/categories/66243?isSubCate=true');
  });

  it('does not duplicate the subcategory query', () => {
    expect(subcategoryVariant('https://supplier.x.yupoo.com/categories/66243?isSubCate=true'))
      .toBe('https://supplier.x.yupoo.com/categories/66243?isSubCate=true');
  });
});
