import { defineKnowledgePack } from '../../core/knowledge-pack.js';
import { defineMerchandising } from '../../core/merchandising.js';

export const SPORTS_LEAGUES = [
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

export const SPORTS_TEAMS = [
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
  id,
  name,
  shortName,
  leagueId,
  aliases: [name, ...(aliases || [])],
  entityType,
  countryCode: SPORTS_LEAGUES.find((league) => league.id === leagueId)?.countryCode || null,
  logoUrl: null,
  initials: shortName,
  sortOrder: 100
}));

export const SPORTS_FACETS = [
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

const SPORTS_NAVIGATION_FACETS = [
  'shirts',
  'kits',
  'retro',
  'kids',
  'training',
  'women',
  'shoes',
  'player-version',
  'long-sleeve',
  'shorts',
  'jackets'
];

export const SPORTS_MERCHANDISING = defineMerchandising({
  navigation: [
    { id: 'teams', name: 'Times', kind: 'teams', entityType: 'club', sortOrder: 10 },
    { id: 'national-teams', name: 'Seleções', kind: 'national_teams', entityType: 'national_team', sortOrder: 20 },
    ...SPORTS_NAVIGATION_FACETS.map((id, index) => {
      const facet = SPORTS_FACETS.find((entry) => entry.id === id);
      return { id: `facet:${id}`, name: facet.name, kind: 'facet', facetId: id, sortOrder: 30 + index };
    }),
    { id: 'other-sports', name: 'Outros Esportes', kind: 'facet', facetId: 'other-sports', sortOrder: 900 }
  ]
});

export const SPORTS_KNOWLEDGE_PACK = defineKnowledgePack({
  key: 'sports-v1',
  domain: 'sports',
  version: 1,
  competitions: SPORTS_LEAGUES,
  entities: SPORTS_TEAMS,
  facets: SPORTS_FACETS,
  reviewThresholds: {
    automatic: 0.75,
    needsReview: 0.51
  },
  merchandising: SPORTS_MERCHANDISING
});
