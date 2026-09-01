const teams = [
  {
    team_id: 'real-madrid',
    name: 'Real Madrid',
    initials: 'RMA',
    league_id: 'laliga',
    entity_type: 'club',
    product_count: 4
  },
  {
    team_id: 'barcelona',
    name: 'Barcelona',
    initials: 'BAR',
    league_id: 'laliga',
    entity_type: 'club',
    product_count: 3
  },
  {
    team_id: 'flamengo',
    name: 'Flamengo',
    initials: 'FLA',
    league_id: 'brasileirao',
    entity_type: 'club',
    product_count: 4
  },
  {
    team_id: 'brasil',
    name: 'Brasil',
    initials: 'BRA',
    league_id: 'national',
    entity_type: 'national_team',
    product_count: 3
  }
];

const leagues = [
  {
    league_id: 'laliga',
    name: 'La Liga',
    country_code: 'ES',
    country_name: 'Espanha',
    entity_type: 'club',
    product_count: 7
  },
  {
    league_id: 'brasileirao',
    name: 'Brasileirão',
    country_code: 'BR',
    country_name: 'Brasil',
    entity_type: 'club',
    product_count: 4
  }
];

const facets = [
  { facet_id: 'kits', name: 'Camisas', product_count: 10 },
  { facet_id: 'retro', name: 'Retrô', product_count: 4 },
  { facet_id: 'kids', name: 'Infantil', product_count: 2 },
  { facet_id: 'women', name: 'Feminino', product_count: 2 }
];

function art(label, a = '#111827', b = '#2563eb') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1200" viewBox="0 0 960 1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="960" height="1200" rx="80" fill="#f4f4f5"/><path d="M285 255 390 195h180l105 60 130 45-60 190-95-35v500H310V455l-95 35-60-190 130-45Z" fill="url(#g)"/><path d="M390 195c10 70 170 70 180 0" fill="none" stroke="#fff" stroke-width="24" opacity=".9"/><text x="480" y="620" text-anchor="middle" font-family="Arial,sans-serif" font-size="54" font-weight="700" fill="#fff">${label}</text><text x="480" y="1090" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#18181b">CATALOG ENGINE UI PREVIEW</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const products = [
  [
    'p01',
    'Real Madrid 26/27 Home',
    'Real Madrid',
    'real-madrid',
    'laliga',
    'kits',
    'RMA HOME',
    '#f8fafc',
    '#c4b5fd'
  ],
  [
    'p02',
    'Real Madrid Black Special',
    'Real Madrid',
    'real-madrid',
    'laliga',
    'kits',
    'RMA BLACK',
    '#111827',
    '#475569'
  ],
  [
    'p03',
    'Real Madrid Retro 1998',
    'Real Madrid',
    'real-madrid',
    'laliga',
    'retro',
    'RMA 98',
    '#f8fafc',
    '#818cf8'
  ],
  [
    'p04',
    'Real Madrid Infantil',
    'Real Madrid',
    'real-madrid',
    'laliga',
    'kids',
    'RMA KIDS',
    '#f8fafc',
    '#60a5fa'
  ],
  [
    'p05',
    'Barcelona Home',
    'Barcelona',
    'barcelona',
    'laliga',
    'kits',
    'BAR HOME',
    '#7f1d1d',
    '#1d4ed8'
  ],
  [
    'p06',
    'Barcelona Away',
    'Barcelona',
    'barcelona',
    'laliga',
    'kits',
    'BAR AWAY',
    '#facc15',
    '#1e40af'
  ],
  [
    'p07',
    'Barcelona Retro',
    'Barcelona',
    'barcelona',
    'laliga',
    'retro',
    'BAR RETRO',
    '#991b1b',
    '#1e3a8a'
  ],
  [
    'p08',
    'Flamengo Home',
    'Flamengo',
    'flamengo',
    'brasileirao',
    'kits',
    'FLA HOME',
    '#7f1d1d',
    '#18181b'
  ],
  [
    'p09',
    'Flamengo Away',
    'Flamengo',
    'flamengo',
    'brasileirao',
    'kits',
    'FLA AWAY',
    '#fafafa',
    '#dc2626'
  ],
  [
    'p10',
    'Flamengo Retro 1981',
    'Flamengo',
    'flamengo',
    'brasileirao',
    'retro',
    'FLA 81',
    '#dc2626',
    '#18181b'
  ],
  [
    'p11',
    'Flamengo Feminino',
    'Flamengo',
    'flamengo',
    'brasileirao',
    'women',
    'FLA WOMEN',
    '#ef4444',
    '#18181b'
  ],
  ['p12', 'Brasil Home', 'Brasil', 'brasil', 'national', 'kits', 'BRA HOME', '#facc15', '#16a34a'],
  ['p13', 'Brasil Away', 'Brasil', 'brasil', 'national', 'kits', 'BRA AWAY', '#2563eb', '#16a34a'],
  [
    'p14',
    'Brasil Retro 2002',
    'Brasil',
    'brasil',
    'national',
    'retro',
    'BRA 02',
    '#facc15',
    '#15803d'
  ]
].map(([id, name, category, teamId, leagueId, facetId, label, a, b]) => {
  const image = art(label, a, b);
  return {
    id,
    name,
    category,
    description:
      'Produto demonstrativo para validar design, responsividade e navegação do Catalog Engine.',
    teamId,
    teamName: teams.find((team) => team.team_id === teamId)?.name || category,
    leagueId,
    facetId,
    imageCount: 1,
    media: [{ url: image, thumbnailUrl: image }]
  };
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function filteredProducts(url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const teamId = url.searchParams.get('teamId') || '';
  const leagueId = url.searchParams.get('leagueId') || '';
  const facetId = url.searchParams.get('facetId') || '';
  const sort = ['name-asc', 'name-desc'].includes(url.searchParams.get('sort'))
    ? url.searchParams.get('sort')
    : 'catalog';
  const filtered = products.filter((product) => {
    if (teamId && product.teamId !== teamId) return false;
    if (leagueId && product.leagueId !== leagueId) return false;
    if (facetId && product.facetId !== facetId) return false;
    if (
      q &&
      !`${product.name} ${product.category} ${product.description}`.toLowerCase().includes(q)
    )
      return false;
    return true;
  });
  if (sort === 'name-asc') return filtered.toSorted((a, b) => a.name.localeCompare(b.name));
  if (sort === 'name-desc') return filtered.toSorted((a, b) => b.name.localeCompare(a.name));
  return filtered;
}

function teamDetail(team) {
  const teamProducts = products.filter((product) => product.teamId === team.team_id);
  return {
    team: { ...team, product_count: teamProducts.length },
    facets: facets
      .map((facet) => ({
        ...facet,
        product_count: teamProducts.filter((product) => product.facetId === facet.facet_id).length
      }))
      .filter((facet) => facet.product_count > 0)
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'preview_read_only' }, 405);

    if (url.pathname === '/api/health')
      return json({ ok: true, preview: true, environment: 'ui-staging' });
    if (url.pathname === '/api/catalog/meta') {
      return json({
        store: {
          name: 'Estádio 90 • UI PREVIEW',
          eyebrow: 'VITRINE OFICIAL',
          heroEyebrow: 'NOVA TEMPORADA',
          heroTitle: 'Sua paixão entra em campo.',
          whatsapp: '5541999999999',
          theme: 'dark'
        },
        stats: { products: products.length },
        navigation: [
          { kind: 'teams', name: 'Clubes', count: 11 },
          { kind: 'national_teams', name: 'Seleções', count: 3 },
          { kind: 'facet', facetId: 'kits', name: 'Camisas', count: 10 },
          { kind: 'facet', facetId: 'retro', name: 'Retrô', count: 4 },
          { kind: 'facet', facetId: 'kids', name: 'Infantil', count: 2 },
          { kind: 'facet', facetId: 'women', name: 'Feminino', count: 2 }
        ]
      });
    }
    if (url.pathname === '/api/leagues') return json({ items: leagues });
    if (url.pathname === '/api/facets') return json({ items: facets });
    if (url.pathname === '/api/teams') {
      const entityType = url.searchParams.get('entityType');
      const leagueId = url.searchParams.get('leagueId');
      const items = teams.filter(
        (team) =>
          (!entityType || team.entity_type === entityType) &&
          (!leagueId || team.league_id === leagueId)
      );
      return json({ items });
    }
    if (url.pathname.startsWith('/api/teams/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/teams/'.length));
      const team = teams.find((entry) => entry.team_id === id);
      return team ? json(teamDetail(team)) : json({ error: 'team_not_found' }, 404);
    }
    if (url.pathname === '/api/products') {
      const items = filteredProducts(url);
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 15)));
      const start = (page - 1) * pageSize;
      const pageItems = items.slice(start, start + pageSize);
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      return json({
        items: pageItems,
        page,
        pageSize,
        total: items.length,
        totalPages,
        hasPrevious: page > 1,
        hasMore: page < totalPages,
        sort: ['name-asc', 'name-desc'].includes(url.searchParams.get('sort'))
          ? url.searchParams.get('sort')
          : 'catalog'
      });
    }
    if (url.pathname.startsWith('/api/products/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/products/'.length));
      const product = products.find((entry) => entry.id === id);
      return product ? json({ product }) : json({ error: 'product_not_found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
