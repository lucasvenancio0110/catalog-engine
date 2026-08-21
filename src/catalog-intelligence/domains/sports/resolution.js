import { parseCatalogEvidence } from '../../core/evidence.js';
import {
  SPORTS_KNOWLEDGE_PACK,
  SPORTS_LEAGUES,
  SPORTS_TEAMS
} from './knowledge-pack.js';

const fold = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const bounded = (value) => Math.max(0, Math.min(0.99, Number(value || 0)));

function evidenceFields(evidence) {
  return [
    { key: 'title', text: evidence.title, weight: 0.96 },
    { key: 'source_category', text: evidence.sourceCategoryName, weight: 0.94 },
    ...evidence.categoryPathNames.map((text, index) => ({
      key: `category_path:${index}`,
      text,
      weight: 0.92
    }))
  ].filter((entry) => fold(entry.text));
}

function fieldMatches(entries, field, { genericAlias = () => false } = {}) {
  const normalized = fold(field.text);
  const padded = ` ${normalized} `;
  const matches = [];

  for (const entry of entries) {
    for (const alias of entry.aliases || []) {
      const token = fold(alias);
      if (token.length < 3) continue;
      const exact = normalized === token;
      if (!exact && genericAlias(entry, token)) continue;
      if (!exact && !padded.includes(` ${token} `)) continue;
      matches.push({
        id: entry.id,
        entry,
        token,
        source: field.key,
        score: bounded(field.weight + (exact ? 0.03 : 0))
      });
    }
  }

  matches.sort((a, b) => b.token.length - a.token.length || b.score - a.score);
  return matches.filter((candidate, index, all) => {
    return !all.slice(0, index).some(
      (stronger) =>
        stronger.id !== candidate.id &&
        stronger.token.length > candidate.token.length &&
        stronger.token.includes(candidate.token)
    );
  });
}

function aggregateMatches(matches) {
  const byId = new Map();
  for (const match of matches) {
    const current = byId.get(match.id) || {
      id: match.id,
      entry: match.entry,
      confidence: 0,
      evidenceSources: new Set()
    };
    current.confidence = Math.max(current.confidence, match.score);
    current.evidenceSources.add(match.source);
    byId.set(match.id, current);
  }
  return [...byId.values()]
    .map((candidate) => ({
      ...candidate,
      evidenceSources: [...candidate.evidenceSources].sort()
    }))
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

function teamCandidates(evidence) {
  return aggregateMatches(
    evidenceFields(evidence).flatMap((field) => fieldMatches(SPORTS_TEAMS, field))
  );
}

function isGenericLeagueAlias(entry, token) {
  return entry.id === 'serie-a-italia' && token === 'serie a';
}

function leagueCandidates(evidence) {
  return aggregateMatches(
    evidenceFields(evidence).flatMap((field) =>
      fieldMatches(SPORTS_LEAGUES, field, { genericAlias: isGenericLeagueAlias })
    )
  );
}

function facetConfidence(base) {
  if (!base.facets?.length) return 0;
  return 0.9;
}

function sportsDomainConfidence(base, teams, leagues) {
  if (teams.length) return Math.max(0.96, teams[0].confidence);
  if (leagues.length) return Math.max(0.94, leagues[0].confidence);
  if (base.facets?.length) return 0.86;
  const text = fold(
    [base.sourceName, base.sourceCategoryName, ...(base.categoryPathNames || [])].join(' ')
  );
  if (/\b(?:football|soccer|jersey|shirt|kit|league|team|goalkeeper|training)\b/.test(text)) {
    return 0.78;
  }
  return 0.25;
}

function inferShortSeasonYear(value, referenceStart = null) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 99) return null;
  if (referenceStart !== null) {
    const century = Math.floor(referenceStart / 100) * 100;
    let year = century + number;
    if (year < referenceStart) year += 100;
    return year;
  }
  return (number >= 70 ? 1900 : 2000) + number;
}

function normalizeSeason(startRaw, endRaw) {
  const startText = String(startRaw);
  const endText = String(endRaw);
  const start = startText.length === 2 ? inferShortSeasonYear(startText) : Number(startText);
  const end = endText.length === 2 ? inferShortSeasonYear(endText, start) : Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 1900 || start > 2099 || end < 1901 || end > 2100 || end !== start + 1) {
    return null;
  }
  return {
    label: `${start}/${String(end).slice(-2)}`,
    startYear: start,
    endYear: end
  };
}

function extractSeasonCandidates(evidence) {
  const candidates = [];
  const structured = evidence.structuredAttributes || {};
  const structuredKeys = ['season', 'seasonYear', 'season_year'];

  for (const key of structuredKeys) {
    const value = structured[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value);
    const full = text.match(/\b((?:19|20)\d{2})\s*[\/-]\s*((?:19|20)?\d{2})\b/);
    const short = text.match(/\b(\d{2})\s*\/\s*(\d{2})\b/);
    const normalized = full
      ? normalizeSeason(full[1], full[2])
      : short
        ? normalizeSeason(short[1], short[2])
        : null;
    if (normalized) {
      candidates.push({ ...normalized, confidence: 0.99, source: `attribute:${key}` });
    }
  }

  for (const field of evidenceFields(evidence)) {
    const text = String(field.text || '');
    const patterns = [
      /\b((?:19|20)\d{2})\s*[\/-]\s*((?:19|20)?\d{2})\b/g,
      /\b(\d{2})\s*\/\s*(\d{2})\b/g
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const normalized = normalizeSeason(match[1], match[2]);
        if (!normalized) continue;
        candidates.push({
          ...normalized,
          confidence:
            field.key === 'title' ? 0.96 : field.key === 'source_category' ? 0.91 : 0.88,
          source: field.key
        });
      }
    }
  }

  const byLabel = new Map();
  for (const candidate of candidates) {
    const current = byLabel.get(candidate.label) || {
      ...candidate,
      evidenceSources: new Set(),
      confidence: 0
    };
    current.confidence = Math.max(current.confidence, candidate.confidence);
    current.evidenceSources.add(candidate.source);
    byLabel.set(candidate.label, current);
  }

  return [...byLabel.values()]
    .map((candidate) => ({
      label: candidate.label,
      startYear: candidate.startYear,
      endYear: candidate.endYear,
      confidence: candidate.confidence,
      evidenceSources: [...candidate.evidenceSources].sort()
    }))
    .sort((a, b) => b.confidence - a.confidence || a.startYear - b.startYear);
}

function conflict(code, field, candidates) {
  return Object.freeze({
    code,
    field,
    candidateIds: Object.freeze(
      [...new Set(candidates.map((candidate) => candidate.id || candidate.label).filter(Boolean))].sort()
    )
  });
}

export function analyzeSportsEvidence(evidenceValue, baseClassification = {}) {
  const evidence = parseCatalogEvidence(evidenceValue);
  const teams = teamCandidates(evidence);
  const leagues = leagueCandidates(evidence);
  const seasons = extractSeasonCandidates(evidence);
  const conflicts = [];

  const strongTeams = teams.filter((candidate) => candidate.confidence >= 0.9);
  if (strongTeams.length > 1) {
    conflicts.push(conflict('sports_team_conflict', 'team', strongTeams));
  }

  const strongLeagues = leagues.filter((candidate) => candidate.confidence >= 0.9);
  const inferredLeagueId = baseClassification.team?.leagueId || baseClassification.league?.id || null;
  const teamLeagueIds = new Set(
    strongTeams.map((candidate) => candidate.entry?.leagueId).filter(Boolean)
  );
  const explicitLeagueIds = new Set(strongLeagues.map((candidate) => candidate.id));
  const supportedLeagueIds = new Set([...teamLeagueIds, ...explicitLeagueIds]);
  if (supportedLeagueIds.size > 1) {
    conflicts.push(
      conflict('sports_league_conflict', 'league', [
        ...strongLeagues,
        ...[...teamLeagueIds].map((id) => ({ id }))
      ])
    );
  }

  const strongSeasons = seasons.filter((candidate) => candidate.confidence >= 0.88);
  if (strongSeasons.length > 1) {
    conflicts.push(conflict('sports_season_conflict', 'season', strongSeasons));
  }

  const versionFacets = (baseClassification.facets || []).filter(
    (facet) => facet.type === 'version'
  );
  if (versionFacets.length > 1) {
    conflicts.push(
      conflict(
        'sports_version_conflict',
        'version',
        versionFacets.map((facet) => ({ id: facet.id }))
      )
    );
  }

  const domainConfidence = sportsDomainConfidence(baseClassification, teams, leagues);
  const teamConflict = conflicts.some((item) => item.field === 'team');
  const leagueConflict = conflicts.some((item) => item.field === 'league');
  const seasonConflict = conflicts.some((item) => item.field === 'season');
  const teamConfidence = teamConflict
    ? 0.45
    : baseClassification.team
      ? Math.max(
          0.84,
          teams.find((candidate) => candidate.id === baseClassification.team.id)?.confidence || 0
        )
      : 0;
  const leagueEvidenceConfidence =
    leagues.find((candidate) => candidate.id === inferredLeagueId)?.confidence || 0;
  const leagueConfidence = leagueConflict
    ? 0.45
    : inferredLeagueId
      ? Math.max(baseClassification.team ? 0.91 : 0.84, leagueEvidenceConfidence)
      : 0;
  const season = seasonConflict ? null : seasons[0] || null;

  return Object.freeze({
    domain: Object.freeze({
      id:
        domainConfidence >= SPORTS_KNOWLEDGE_PACK.reviewThresholds.needsReview
          ? 'sports'
          : 'unknown',
      confidence: bounded(domainConfidence),
      knowledgePackKey: SPORTS_KNOWLEDGE_PACK.key,
      knowledgePackVersion: SPORTS_KNOWLEDGE_PACK.version
    }),
    fieldConfidence: Object.freeze({
      team: bounded(teamConfidence),
      league: bounded(leagueConfidence),
      facets: bounded(facetConfidence(baseClassification)),
      season: bounded(season?.confidence || 0)
    }),
    season: season ? Object.freeze(season) : null,
    conflicts: Object.freeze(conflicts),
    reviewRequired: conflicts.length > 0
  });
}
