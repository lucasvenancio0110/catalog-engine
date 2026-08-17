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

export const LEAGUES = [
  { id: 'brasileirao-serie-a', name: 'Brasileirão Série A', countryCode: 'BR', countryName: 'Brasil', entityType: 'club', sortOrder: 10, aliases: ['Brazil Campeonato Brasileiro Série A', 'Campeonato Brasileiro Série A', 'Brasileirão Série A', 'Brasileirao Serie A'] },
  { id: 'premier-league', name: 'Premier League', countryCode: 'GB-ENG', countryName: 'Inglaterra', entityType: 'club', sortOrder: 20, aliases: ['Premier League', 'English Premier League', 'EPL'] },
  { id: 'la-liga', name: 'La Liga', countryCode: 'ES', countryName: 'Espanha', entityType: 'club', sortOrder: 30, aliases: ['La Liga', 'Liga Española', 'Spanish La Liga'] },
  { id: 'serie-a-italia', name: 'Serie A', countryCode: 'IT', countryName: 'Itália', entityType: 'club', sortOrder: 40, aliases: ['Serie A', 'Serie A Italy', 'Italian Serie A', 'Serie A Italiana'] },
  { id: 'bundesliga', name: 'Bundesliga', countryCode: 'DE', countryName: 'Alemanha', entityType: 'club', sortOrder: 50, aliases: ['Bundesliga', 'German Bundesliga'] },
  { id: 'ligue-1', name: 'Ligue 1', countryCode: 'FR', countryName: 'França', entityType: 'club', sortOrder: 60, aliases: ['Ligue 1', 'French Ligue 1'] },
  { id: 'mls', name: 'MLS', countryCode: 'US', countryName: 'Estados Unidos', entityType: 'club', sortOrder: 70, aliases: ['MLS Major League Soccer', 'Major League Soccer', 'MLS'] },
  { id: 'world-cup-2026', name: 'Copa do Mundo 2026', countryCode: 'INT', countryName: 'Seleções', entityType: 'national_team', sortOrder: 80, aliases: ['FIFA World Cup 2026 National team jersey', 'World Cup 2026', 'Copa do Mundo 2026', 'National team jersey'] },
  { id: 'other-leagues', name: 'Outras Ligas', countryCode: 'OTHER', countryName: 'Outros', entityType: 'club', sortOrder: 900, aliases: ['other team league', 'other leagues', 'outras ligas'] }
];

export const TEAMS = [
  ['flamengo','Flamengo','FLA','brasileirao-serie-a',['Clube de Regatas do Flamengo','CR Flamengo']],
  ['palmeiras','Palmeiras','PAL','brasileirao-serie-a',['Sociedade Esportiva Palmeiras','SE Palmeiras']],
  ['corinthians','Corinthians','COR','brasileirao-serie-a',['Sport Club Corinthians Paulista','SC Corinthians']],
  ['sao-paulo','São Paulo','SAO','brasileirao-serie-a',['Sao Paulo','São Paulo FC','Sao Paulo FC','SPFC']],
  ['santos','Santos','SAN','brasileirao-serie-a',['Santos FC']],
  ['botafogo','Botafogo','BOT','brasileirao-serie-a',['Botafogo FR','Botafogo de Futebol e Regatas']],
  ['fluminense','Fluminense','FLU','brasileirao-serie-a',['Fluminense FC']],
  ['vasco-da-gama','Vasco da Gama','VAS','brasileirao-serie-a',['Vasco','CR Vasco da Gama']],
  ['gremio','Grêmio','GRE','brasileirao-serie-a',['Gremio','Grêmio FBPA','Gremio FBPA']],
  ['internacional','Internacional','INT','brasileirao-serie-a',['Inter Porto Alegre','SC Internacional']],
  ['cruzeiro','Cruzeiro','CRU','brasileirao-serie-a',['Cruzeiro EC']],
  ['atletico-mineiro','Atlético Mineiro','CAM','brasileirao-serie-a',['Atletico Mineiro','Atlético-MG','Atletico MG','Galo']],
  ['bahia','Bahia','BAH','brasileirao-serie-a',['EC Bahia','Esporte Clube Bahia']],
  ['fortaleza','Fortaleza','FOR','brasileirao-serie-a',['Fortaleza EC']],
  ['vitoria','Vitória','VIT','brasileirao-serie-a',['Vitoria','EC Vitória','EC Vitoria']],
  ['athletico-paranaense','Athletico Paranaense','CAP','brasileirao-serie-a',['Atletico Paranaense','Athletico-PR','PARANAENSE']],
  ['bragantino','RB Bragantino','RBB','brasileirao-serie-a',['Red Bull Bragantino','Bragantino']],
  ['arsenal','Arsenal','ARS','premier-league',['Arsenal FC']],
  ['chelsea','Chelsea','CHE','premier-league',['Chelsea FC']],
  ['liverpool','Liverpool','LIV','premier-league',['Liverpool FC']],
  ['manchester-city','Manchester City','MCI','premier-league',['Man City','Manchester City FC']],
  ['manchester-united','Manchester United','MUN','premier-league',['Man United','Man Utd','Manchester United FC']],
  ['tottenham','Tottenham','TOT','premier-league',['Tottenham Hotspur','Spurs']],
  ['newcastle','Newcastle United','NEW','premier-league',['Newcastle','Newcastle Utd']],
  ['aston-villa','Aston Villa','AVL','premier-league',['Aston Villa FC']],
  ['barcelona','Barcelona','BAR','la-liga',['FC Barcelona','Barcelona FC','Barça','Barca']],
  ['real-madrid','Real Madrid','RMA','la-liga',['Real Madrid CF']],
  ['atletico-madrid','Atlético de Madrid','ATM','la-liga',['Atletico Madrid','Atlético Madrid','Atletico de Madrid']],
  ['sevilla','Sevilla','SEV','la-liga',['Sevilla FC']],
  ['real-betis','Real Betis','BET','la-liga',['Betis','Real Betis Balompie']],
  ['athletic-bilbao','Athletic Club','ATH','la-liga',['Athletic Bilbao','Athletic Club Bilbao']],
  ['juventus','Juventus','JUV','serie-a-italia',['Juventus FC','Juve']],
  ['milan','AC Milan','MIL','serie-a-italia',['Milan','ACM']],
  ['inter-milan','Inter','INT','serie-a-italia',['Inter Milan','Internazionale','FC Internazionale Milano']],
  ['napoli','Napoli','NAP','serie-a-italia',['SSC Napoli']],
  ['roma','Roma','ROM','serie-a-italia',['AS Roma']],
  ['lazio','Lazio','LAZ','serie-a-italia',['SS Lazio']],
  ['bayern-munich','Bayern de Munique','BAY','bundesliga',['Bayern Munich','Bayern München','FC Bayern','Bayern Munchen']],
  ['borussia-dortmund','Borussia Dortmund','BVB','bundesliga',['Dortmund','BVB']],
  ['bayer-leverkusen','Bayer Leverkusen','B04','bundesliga',['Leverkusen','Bayer 04 Leverkusen']],
  ['psg','Paris Saint-Germain','PSG','ligue-1',['Paris Saint Germain','Paris SG','PSG']],
  ['marseille','Olympique de Marseille','OM','ligue-1',['Marseille','Olympique Marseille']],
  ['monaco','Monaco','ASM','ligue-1',['AS Monaco']],
  ['lyon','Lyon','OL','ligue-1',['Olympique Lyonnais','OL Lyon']],
  ['inter-miami','Inter Miami','MIA','mls',['Inter Miami CF']],
  ['la-galaxy','LA Galaxy','LAG','mls',['Los Angeles Galaxy']],
  ['lafc','Los Angeles FC','LAFC','mls',['LAFC']],
  ['brazil-national','Brasil','BRA','world-cup-2026',['Brazil','Seleção Brasileira','Selecao Brasileira'], 'national_team'],
  ['argentina-national','Argentina','ARG','world-cup-2026',['Argentina National Team','Seleção Argentina','Selecao Argentina'], 'national_team'],
  ['portugal-national','Portugal','POR','world-cup-2026',['Portugal National Team','Seleção Portuguesa','Selecao Portuguesa'], 'national_team'],
  ['france-national','França','FRA','world-cup-2026',['France','France National Team','Seleção Francesa','Selecao Francesa'], 'national_team'],
  ['germany-national','Alemanha','GER','world-cup-2026',['Germany','Deutschland','Germany National Team'], 'national_team'],
  ['spain-national','Espanha','ESP','world-cup-2026',['Spain','Spain National Team','Seleção Espanhola','Selecao Espanhola'], 'national_team'],
  ['england-national','Inglaterra','ENG','world-cup-2026',['England','England National Team','Seleção Inglesa','Selecao Inglesa'], 'national_team']
].map(([id,name,shortName,leagueId,aliases,entityType = 'club']) => ({
  id, name, shortName, leagueId, aliases: [name, ...(aliases || [])], entityType,
  countryCode: LEAGUES.find((league) => league.id === leagueId)?.countryCode || null,
  logoUrl: null, initials: shortName, sortOrder: 100
}));

export const FACETS = [
  { id: 'shirts', type: 'product_type', name: 'Camisas', sortOrder: 10, aliases: ['jersey','shirt','camisa','soccer jersey','football jersey'] },
  { id: 'kits', type: 'product_type', name: 'Conjuntos', sortOrder: 20, aliases: ['adult soccer kit','soccer kit','football kit','set','conjunto'] },
  { id: 'player-version', type: 'version', name: 'Versão Jogador', sortOrder: 30, aliases: ['player version','authentic version','versão jogador','versao jogador'] },
  { id: 'fan-version', type: 'version', name: 'Versão Torcedor', sortOrder: 40, aliases: ['fan version','fans version','replica version','versão torcedor','versao torcedor'] },
  { id: 'retro', type: 'style', name: 'Retrô', sortOrder: 50, aliases: ['retro','retrô','classic jersey','vintage'] },
  { id: 'kids', type: 'audience', name: 'Infantil', sortOrder: 60, aliases: ['kids kit','kids','child','children','youth kit','infantil','size 16 28'] },
  { id: 'baby', type: 'audience', name: 'Bebê', sortOrder: 70, aliases: ['baby size','baby kit','bebê','bebe'] },
  { id: 'training', type: 'product_type', name: 'Treino', sortOrder: 80, aliases: ['training','training suit','pre match','pre-match','treino','pré-jogo','pre jogo'] },
  { id: 'women', type: 'audience', name: 'Feminino', sortOrder: 90, aliases: ['women','womens',"women's",'female','feminino'] },
  { id: 'long-sleeve', type: 'sleeve', name: 'Manga Longa', sortOrder: 100, aliases: ['long sleeve','long-sleeved','manga longa'] },
  { id: 'shorts', type: 'product_type', name: 'Shorts', sortOrder: 110, aliases: ['shorts','soccer shorts','football shorts'] },
  { id: 'jackets', type: 'product_type', name: 'Jaquetas', sortOrder: 120, aliases: ['windbreaker','jacket','coat','jaqueta','jaquetas'] },
  { id: 'shoes', type: 'product_type', name: 'Chuteiras', sortOrder: 130, aliases: ['football shoes','soccer shoes','football boots','chuteira','chuteiras'] },
  { id: 'new', type: 'collection', name: 'Novidades', sortOrder: 140, aliases: ['new product renew','new product','new arrival','novidade','novidades'] },
  { id: 'other-sports', type: 'collection', name: 'Outros Esportes', sortOrder: 900, aliases: ['nba','nfl','mlb','nhl','f1 racing','formula 1','basketball'] }
];

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
  let team = detectTeam({ sourceName, sourceCategoryName, categoryPathNames: path, leagueId: league?.id || null });
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
  return [
    { id: 'teams', name: 'Times', kind: 'teams', sortOrder: 10 },
    { id: 'national-teams', name: 'Seleções', kind: 'national_teams', sortOrder: 20 },
    ...['shirts','kits','retro','kids','training','women','shoes','player-version','long-sleeve','shorts','jackets'].map((id, index) => {
      const facet = FACETS.find((entry) => entry.id === id);
      return { id: `facet:${id}`, name: facet.name, kind: 'facet', facetId: id, sortOrder: 30 + index };
    }),
    { id: 'other-sports', name: 'Outros Esportes', kind: 'facet', facetId: 'other-sports', sortOrder: 900 }
  ];
}
