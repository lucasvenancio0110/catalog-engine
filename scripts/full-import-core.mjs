import { publicCategoryId } from './catalog-sync.mjs';

const infoPattern = /\b(?:tutorial|how\s+to|notice|announcement|contact|call\s+me|facebook\s+group|logistics(?:\s+website)?(?:\s+query)?|website\s+query|order\s+guide|purchase\s+guide|size\s+(?:chart|table)|payment|shipping|freight|instruction|instructions)\b/i;
const taxonomyPattern = /^(?:product\s+category(?:\s+search)?|other\s+football\s+leagues?|(?:france\s+)?ligue\s*1|(?:italy\s+)?serie\s*a|(?:fa\s+)?premier\s+league|(?:spain\s+)?la\s+liga|bundesliga(?:\s+jersey)?|national\s+team(?:\s+jersey)?|player\s+version(?:\s+jersey)?|women(?:'s)?\s+jersey|kids?.*football(?:\s+team)?|retro\s+jersey|windbreaker|mls(?:\s+major\s+league)?(?:\s+jersey)?|nba(?:\s*[（(][^）)]*[）)])?|nfl\s*-\s*mlb\s*-\s*nhl|adult\s+training\s+suit|brazil\s+campeonato\s+brasileiro.*)$/i;

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function classifyCatalogItem({ name = '', description = '', sourceImageCount = 0 } = {}) {
  const cleanName = clean(name);
  const hasSeason = /\b(?:19|20)?\d{2}[\/-](?:19|20)?\d{2}\b|\b20\d{2}\b/.test(cleanName);
  const hasSize = /\b(?:size\s*)?(?:xs|s|m|l|xl|xxl|xxxl|\d{2})\s*[-–]\s*(?:xs|s|m|l|xl|xxl|xxxl|\d{2,3})\b/i.test(cleanName);
  const hasProductSignal = hasSeason || hasSize || /\b(?:home|away|third|goalkeeper|match|player\s+version|kids?\s+kit|crop|shirt|jersey|training|tracksuit|jacket|shorts?)\b/i.test(cleanName);

  if (infoPattern.test(`${cleanName} ${clean(description)}`)) {
    return { entityType: 'information', confidence: 'high', reason: 'informational-title' };
  }

  if (taxonomyPattern.test(cleanName) && sourceImageCount <= 2) {
    return { entityType: 'navigation', confidence: 'high', reason: 'taxonomy-shortcut' };
  }

  if (!hasProductSignal && sourceImageCount <= 1 && /\b(?:league|liga|team|category|size)\b/i.test(cleanName)) {
    return { entityType: 'navigation', confidence: 'medium', reason: 'generic-single-image' };
  }

  return {
    entityType: 'product',
    confidence: hasProductSignal || sourceImageCount > 1 ? 'high' : 'medium',
    reason: 'commercial-item'
  };
}

export function chooseCategoryAssignment(previous, candidate) {
  if (!candidate?.id) return previous || null;
  if (!previous?.id) return candidate;

  const previousDepth = Number.isInteger(previous.depth) ? previous.depth : 0;
  const candidateDepth = Number.isInteger(candidate.depth) ? candidate.depth : 0;
  if (candidateDepth > previousDepth) return candidate;
  return previous;
}

function ancestorIds(sourceCategoryId, rawById) {
  const output = [];
  const seen = new Set();
  let current = rawById.get(String(sourceCategoryId));

  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    output.unshift(String(current.id));
    current = current.parentId ? rawById.get(String(current.parentId)) : null;
  }

  return output;
}

export function buildUsedPublicTaxonomy({ provider = 'yupoo', rawTaxonomy = [], usedSourceCategoryIds = [] } = {}) {
  const rawById = new Map(
    rawTaxonomy
      .filter((category) => category?.id && clean(category.name))
      .map((category) => [String(category.id), category])
  );
  const includedSourceIds = new Set();

  for (const sourceId of usedSourceCategoryIds) {
    for (const ancestorId of ancestorIds(sourceId, rawById)) includedSourceIds.add(ancestorId);
  }

  const publicBySourceId = new Map();
  for (const sourceId of includedSourceIds) {
    const category = rawById.get(sourceId);
    if (!category) continue;
    publicBySourceId.set(sourceId, {
      id: publicCategoryId(provider, sourceId),
      type: 'category',
      name: clean(category.name),
      parentId: category.parentId && includedSourceIds.has(String(category.parentId))
        ? publicCategoryId(provider, String(category.parentId))
        : null,
      childIds: [],
      depth: 0
    });
  }

  const publicById = new Map([...publicBySourceId.values()].map((category) => [category.id, category]));
  for (const category of publicBySourceId.values()) {
    if (!category.parentId) continue;
    const parent = publicById.get(category.parentId);
    if (parent && !parent.childIds.includes(category.id)) parent.childIds.push(category.id);
  }

  function depthFor(category, visiting = new Set()) {
    if (!category?.parentId || visiting.has(category.id)) return 0;
    const parent = publicById.get(category.parentId);
    if (!parent) return 0;
    const next = new Set(visiting);
    next.add(category.id);
    return Math.min(8, depthFor(parent, next) + 1);
  }

  const taxonomy = [...publicBySourceId.values()].map((category) => ({
    ...category,
    childIds: [...category.childIds].sort(),
    depth: depthFor(category)
  }));
  taxonomy.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  return { taxonomy, rawById, publicBySourceId };
}

export function categoryPathFor(sourceCategoryId, rawById, provider = 'yupoo') {
  return ancestorIds(sourceCategoryId, rawById).map((sourceId) => publicCategoryId(provider, sourceId));
}
