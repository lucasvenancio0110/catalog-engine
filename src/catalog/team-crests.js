import manifest from './team-crest-manifest.json';

const crestModules = import.meta.glob('../assets/team-crests/*.png', {
  eager: true,
  import: 'default',
  query: '?url'
});

const TEAM_ALIASES = Object.freeze({
  'inter-milan': 'inter',
  psg: 'paris-saint-germain',
  'bayern-munich': 'bayern-munchen',
  'athletic-bilbao': 'athletic-club',
  'brazil-national': 'brazil-national-team',
  'argentina-national': 'argentina-national-team',
  'germany-national': 'germany-national-team',
  'portugal-national': 'portuguese-football-federation',
  'spain-national': 'spain-national-team',
  'england-national': 'england-national-team',
  'france-national': 'france-national-team'
});

const urlByAssetId = new Map(
  Object.entries(crestModules).map(([path, url]) => {
    const assetId =
      path
        .split('/')
        .pop()
        ?.replace(/\.png$/, '') || '';
    return [assetId, url];
  })
);

export function normalizeTeamCrestSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function teamCrestCandidates(team = {}) {
  const direct = [team.team_id, team.teamId, team.name, team.short_name, team.shortName]
    .map(normalizeTeamCrestSlug)
    .filter(Boolean);
  const candidates = [];
  for (const slug of direct) {
    candidates.push(slug);
    if (TEAM_ALIASES[slug]) candidates.push(TEAM_ALIASES[slug]);
  }
  return [...new Set(candidates)];
}

export function resolveTeamCrest(team) {
  for (const slug of teamCrestCandidates(team)) {
    const assetId = manifest.assets?.[slug];
    if (!/^tc_[a-f0-9]{20}$/.test(String(assetId || ''))) continue;
    const url = urlByAssetId.get(assetId);
    if (typeof url === 'string' && url) return { assetId, slug, url };
  }
  return null;
}

export const teamCrestRegistryInfo = Object.freeze({
  schemaVersion: manifest.schemaVersion,
  masterSize: manifest.masterSize,
  teamCount: manifest.teamCount,
  assetCount: manifest.assetCount
});
