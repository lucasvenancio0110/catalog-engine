function frozenClaim(value, confidence, evidenceSources = []) {
  return Object.freeze({
    value,
    confidence: Number(confidence || 0),
    evidenceSources: Object.freeze([...new Set((evidenceSources || []).filter(Boolean).map(String))])
  });
}

export function createSportsClaims(classified, intelligence) {
  const season = intelligence?.season || null;
  return Object.freeze({
    team: frozenClaim(classified?.team?.id || null, intelligence?.fieldConfidence?.team || 0),
    league: frozenClaim(classified?.league?.id || null, intelligence?.fieldConfidence?.league || 0),
    facets: frozenClaim(
      [...new Set((classified?.facets || []).map((facet) => facet.id).filter(Boolean))],
      intelligence?.fieldConfidence?.facets || 0
    ),
    season: frozenClaim(
      season
        ? Object.freeze({
            label: season.label,
            startYear: Number(season.startYear),
            endYear: Number(season.endYear)
          })
        : null,
      intelligence?.fieldConfidence?.season || 0,
      season?.evidenceSources || []
    )
  });
}
