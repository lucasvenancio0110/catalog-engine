import * as cheerio from 'cheerio';

const timeoutMs = 30000;
const attempts = 4;
const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function absolute(base, value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  try { return new URL(value, base).href; } catch { return null; }
}

function categoryIdFromHref(href) {
  return href?.match(/\/categories\/(\d+)/)?.[1] || null;
}

async function fetchText(url) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1200);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function findParentCategory($, element, ownId) {
  let current = $(element).parent();

  while (current.length && !current.is('body, html')) {
    if (current.is('li')) {
      const direct = current.children('a[href*="/categories/"]').first();
      if (direct.length) {
        const href = direct.attr('href') || '';
        const id = categoryIdFromHref(href);
        if (id && id !== ownId) return id;
      }
    }
    current = current.parent();
  }

  return null;
}

function inferDepth(id, byId, memo = new Map(), visiting = new Set()) {
  if (memo.has(id)) return memo.get(id);
  if (visiting.has(id)) return 0;

  visiting.add(id);
  const item = byId.get(id);
  const parentId = item?.parentId;
  const depth = parentId && byId.has(parentId)
    ? Math.min(8, inferDepth(parentId, byId, memo, visiting) + 1)
    : 0;
  visiting.delete(id);
  memo.set(id, depth);
  return depth;
}

function chooseEntry(previous, candidate) {
  if (!previous) return candidate;

  const previousScore = (previous.parentId ? 4 : 0) + (previous.name?.length ? 1 : 0);
  const candidateScore = (candidate.parentId ? 4 : 0) + (candidate.name?.length ? 1 : 0);

  if (candidateScore > previousScore) return candidate;
  return {
    ...candidate,
    ...previous,
    parentId: previous.parentId || candidate.parentId || null,
    name: previous.name || candidate.name
  };
}

export async function scanYupooTaxonomy(sourceUrl) {
  const source = new URL(sourceUrl);
  if (!source.hostname.endsWith('.x.yupoo.com')) {
    throw new Error('A fonte precisa ser um catálogo público do Yupoo (*.x.yupoo.com).');
  }

  const taxonomyUrl = new URL('/categories/', source.origin).href;
  const html = await fetchText(taxonomyUrl);
  const $ = cheerio.load(html);
  const byId = new Map();

  $('a[href*="/categories/"]').each((_, element) => {
    const rawHref = $(element).attr('href');
    const href = absolute(taxonomyUrl, rawHref);
    const id = categoryIdFromHref(href);
    if (!href || !id) return;

    const name = cleanText($(element).text()) || cleanText($(element).find('img').first().attr('alt'));
    if (!name || /^\d+$/.test(name) || /^(?:全部分类|all categories)$/i.test(name)) return;

    const parentId = findParentCategory($, element, id);
    const candidate = {
      id,
      type: 'category',
      name,
      parentId: parentId || null,
      sourceUrl: href
    };

    byId.set(id, chooseEntry(byId.get(id), candidate));
  });

  const depthMemo = new Map();
  const categories = [...byId.values()].map((item) => ({
    ...item,
    depth: inferDepth(item.id, byId, depthMemo)
  }));

  categories.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  const childrenByParent = new Map();
  for (const category of categories) {
    if (!category.parentId) continue;
    if (!childrenByParent.has(category.parentId)) childrenByParent.set(category.parentId, []);
    childrenByParent.get(category.parentId).push(category.id);
  }

  return {
    sourceUrl: taxonomyUrl,
    categories: categories.map((category) => ({
      ...category,
      childIds: childrenByParent.get(category.id) || []
    })),
    stats: {
      total: categories.length,
      roots: categories.filter((category) => !category.parentId).length,
      nested: categories.filter((category) => category.parentId).length,
      maxDepth: categories.reduce((max, category) => Math.max(max, category.depth), 0)
    }
  };
}
