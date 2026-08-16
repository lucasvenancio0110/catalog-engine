import Fuse from 'fuse.js';

export function createProductSearch(products = []) {
  const source = Array.isArray(products) ? products : [];
  const fuse = new Fuse(source, {
    includeScore: true,
    threshold: 0.36,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'name', weight: 0.68 },
      { name: 'category', weight: 0.22 },
      { name: 'description', weight: 0.1 }
    ]
  });

  return function search(query = '') {
    const value = String(query).trim();
    if (!value) return source;
    return fuse.search(value).map((result) => result.item);
  };
}
