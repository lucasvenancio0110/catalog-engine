import {
  SPORTS_FACETS,
  SPORTS_KNOWLEDGE_PACK,
  SPORTS_LEAGUES,
  SPORTS_TEAMS
} from '../catalog-intelligence/domains/sports/knowledge-pack.js';

export const LEAGUES = SPORTS_LEAGUES;
export const TEAMS = SPORTS_TEAMS;
export const FACETS = SPORTS_FACETS;

const fold = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[’'`´]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const phrase = (value) => ` ${fold(value)} `;
const includesAlias = (haystack, alias) => phrase(haystack).includes(` ${fold(alias)} `);

const NON_COMMERCIAL_PATTERNS = [/product category search/i, /purchase tutorial/i, /information shoes/i, /^size$/i, /product video/i, /patch/i];
const DISPLAY_REPLACEMENTS = [
  [/\bplayer\s+version\b/gi, 'Versão Jogador'], [/\bfan(?:s)?\s+version\b/gi, 'Versão Torcedor'],
  [/\blong[-\s]?sleeved?\b/gi, 'Manga Longa'], [/\bkids?\s+kit\b/gi, 'Kit Infantil'], [/\bwomen(?:'s)?\b/gi, 'Feminino'],
  [/\bpre[-\s]?match\b/gi, 'Pré-jogo'], [/\btraining\s+suit\b/gi, 'Conjunto de Treino'], [/\btraining\b/gi, 'Treino'],
  [/\bwindbreaker\b/gi, 'Jaqueta'], [/\bretro\b/gi, 'Retrô'], [/\bbaby\s+size\b/gi, 'Bebê'], [/\badult\s+soccer\s+kit\b/gi, 'Conjunto Adulto']
];

export function normalizeText(value = '') { return fold(value); }
export function displayNameFromSource(sourceName = '') {
  let output = String(sourceName).replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of DISPLAY_REPLACEMENTS) output = output.replace(pattern, replacement);
  return output.replace(/\s{2,}/g, ' ').trim();
}
function exactAliasMatch(value, aliases = []) { const normalized = fold(value); return aliases.some((alias) => fold(alias) === normalized); }

export function detectLeague(context = '') {
  const normalized = fold(context);
  if (!normalized) return null;
  if (normalized.includes('brazil campeonato brasileiro serie a') || normalized.includes('brasileirao serie a')) return LEAGUES.find((league) => league.id === 'brasileirao-serie-a');
  if (normalized.includes('fifa world cup 2026') || normalized.includes('national team jersey')) return LEAGUES.find((league) => league.id === 'world-cup-2026');
  for (const league of LEAGUES.filter((entry) => !['brasileirao-serie-a','world-cup-2026','serie-a-italia'].includes(entry.id))) {
    if (league.aliases.some((alias) => includesAlias(context, alias))) return league;
  }
  if (includesAlias(context, 'Serie A')) return LEAGUES.find((league) => league.id === 'serie-a-italia');
  return null;
}

export function detectTeam({ sourceName = '', sourceCategoryName = '', categoryPathNames = [], leagueId = null } = {}) {
  const categoryCandidates = [sourceCategoryName, ...categoryPathNames].filter(Boolean);
  for (const value of [...categoryCandidates].reverse()) {
    const exact = TEAMS.find((team) => team.aliases.some((alias) => exactAliasMatch(value, [alias])) && (!leagueId || team.leagueId === leagueId || team.entityType === 'national_team'));
    if (exact) return exact;
  }
  const context = [sourceName, sourceCategoryName, ...categoryPathNames].join(' ');
  const normalized = phrase(context);
  const candidates = TEAMS
    .filter((team) => !leagueId || team.leagueId === leagueId || team.entityType === 'national_team')
    .flatMap((team) => team.aliases.map((alias) => ({ team, token: fold(alias) })))
    .filter((entry) => entry.token.length >= 3 && normalized.includes(` ${entry.token} `))
    .sort((a, b) => b.token.length - a.token.length);
  return candidates[0]?.team || null;
}

export function detectFacets(context = '') {
  const normalized = phrase(context);
  const detected = FACETS.filter((facet) => facet.aliases.some((alias) => normalized.includes(` ${fold(alias)} `)));
  if (detected.some((facet) => ['player-version','fan-version','long-sleeve','retro'].includes(facet.id)) && !detected.some((facet) => facet.id === 'shirts')) detected.push(FACETS.find((facet) => facet.id === 'shirts'));
  return [...new Map(detected.filter(Boolean).map((facet) => [facet.id, facet])).values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function translatedCategoryName(sourceCategoryName = '', league, team, facets) {
  if (team) return team.name;
  if (league) return league.name;
  const normalized = fold(sourceCategoryName);
  if (normalized === 'album nao categorizado') return 'Outros';
  if (facets[0]) return facets[0].name;
  if (normalized.includes('new product renew')) return 'Novidades';
  if (normalized.includes('other team league')) return 'Outras Ligas';
  return sourceCategoryName || 'Catálogo';
}
export function isCommercialNavigationCategory(name = '') {
  if (!name || fold(name) === 'album nao categorizado') return false;
  return !NON_COMMERCIAL_PATTERNS.some((pattern) => pattern.test(String(name)));
}

export function buildSearchText(normalizedProduct) {
  const values = [normalizedProduct.sourceName, normalizedProduct.displayName, normalizedProduct.sourceCategoryName, normalizedProduct.displayCategoryName,
    ...(normalizedProduct.categoryPathNames || []), normalizedProduct.team?.name, ...(normalizedProduct.team?.aliases || []),
    normalizedProduct.league?.name, ...(normalizedProduct.league?.aliases || []),
    ...(normalizedProduct.facets || []).flatMap((facet) => [facet.name, ...(facet.aliases || [])]), ...(normalizedProduct.aliases || [])].filter(Boolean);
  return [...new Set(values.map(fold).filter(Boolean))].join(' ').slice(0, 4000);
}

export function normalizeCatalogProduct(product = {}, categoryPathNames = []) {
  const sourceName = String(product.sourceName || product.name || '').trim();
  const sourceCategoryName = String(product.sourceCategoryName || product.category || '').trim();
  const path = categoryPathNames.filter(Boolean).map(String);
  const context = [sourceName, sourceCategoryName, ...path].join(' ');
  let league = detectLeague([sourceCategoryName, ...path].join(' ')) || detectLeague(sourceName);
  const team = detectTeam({ sourceName, sourceCategoryName, categoryPathNames: path, leagueId: league?.id || null });
  if (!league && team) league = LEAGUES.find((entry) => entry.id === team.leagueId) || null;
  if (team?.entityType === 'national_team' && !league) league = LEAGUES.find((entry) => entry.id === 'world-cup-2026');
  const facets = detectFacets(context);
  const displayName = displayNameFromSource(sourceName) || sourceName;
  const displayCategoryName = translatedCategoryName(sourceCategoryName, league, team, facets);
  const navigationCommercial = isCommercialNavigationCategory(sourceCategoryName);
  const signals = [Boolean(team), Boolean(league), facets.length > 0, navigationCommercial].filter(Boolean).length;
  const classificationStatus = signals >= 2 ? 'automatic' : signals === 1 ? 'needs_review' : 'unknown';
  const classificationConfidence = Math.min(0.99, Number((0.35 + signals * 0.16 + (team ? 0.12 : 0)).toFixed(2)));
  const aliases = [...new Set([sourceName, displayName, sourceCategoryName, displayCategoryName, ...path, ...(team?.aliases || []), ...(league?.aliases || []), ...facets.flatMap((facet) => facet.aliases)].filter(Boolean))];
  const normalized = { sourceName, displayName, sourceCategoryName, displayCategoryName, categoryPathNames: path, team, league, facets, aliases, classificationStatus, classificationConfidence, navigationCommercial };
  normalized.searchText = buildSearchText(normalized);
  return normalized;
}

export function professionalNavigationDefinition() {
  return SPORTS_KNOWLEDGE_PACK.merchandising.navigation.map((item) => ({ ...item }));
}
