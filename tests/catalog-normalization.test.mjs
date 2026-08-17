import { describe, expect, it } from 'vitest';
import { normalizeCatalogProduct } from '../src/domain/catalog-normalization.js';

function classify(name, category, path = []) {
  return normalizeCatalogProduct({ name, category }, path);
}

describe('professional catalog normalization', () => {
  it.each([
    ['Barcelona 26/27 Home Player Version Jersey', '⚽ player version', ['⚽ La Liga'], 'barcelona', 'la-liga'],
    ['Real Madrid 26/27 Away Jersey', '⚽ La Liga', ['⚽ La Liga'], 'real-madrid', 'la-liga'],
    ['Arsenal 26/27 Home Jersey', '⚽ Premier League', ['⚽ Premier League'], 'arsenal', 'premier-league'],
    ['Manchester City 26/27 Third Jersey', '⚽ Premier League', ['⚽ Premier League'], 'manchester-city', 'premier-league'],
    ['Juventus 26/27 Home Jersey', '⚽ Serie A', ['⚽ Serie A'], 'juventus', 'serie-a-italia'],
    ['AC Milan 26/27 Home Jersey', '⚽ Serie A', ['⚽ Serie A'], 'milan', 'serie-a-italia'],
    ['Inter Milan 26/27 Home Jersey', '⚽ Serie A', ['⚽ Serie A'], 'inter-milan', 'serie-a-italia'],
    ['Bayern Munich 26/27 Home Jersey', '⚽ Bundesliga', ['⚽ Bundesliga'], 'bayern-munich', 'bundesliga'],
    ['PSG 26/27 Home Jersey', '⚽ Ligue 1', ['⚽ Ligue 1'], 'psg', 'ligue-1'],
    ['Flamengo 26/27 Home Jersey', 'Flamengo', ['⚽ Brazil Campeonato Brasileiro Série A','Flamengo'], 'flamengo', 'brasileirao-serie-a'],
    ['Palmeiras 26/27 Home Jersey', 'Palmeiras', ['⚽ Brazil Campeonato Brasileiro Série A','Palmeiras'], 'palmeiras', 'brasileirao-serie-a'],
    ['Corinthians 26/27 Home Jersey', 'Corinthians', ['⚽ Brazil Campeonato Brasileiro Série A','Corinthians'], 'corinthians', 'brasileirao-serie-a'],
    ['São Paulo 26/27 Home Jersey', 'sao paulo', ['⚽ Brazil Campeonato Brasileiro Série A','sao paulo'], 'sao-paulo', 'brasileirao-serie-a'],
    ['Santos 26/27 Home Jersey', 'Santos', ['⚽ Brazil Campeonato Brasileiro Série A','Santos'], 'santos', 'brasileirao-serie-a'],
    ['Brazil 2026 Home Player Version Jersey', '🏆⚽ FIFA World Cup 2026 National team jersey', ['🏆⚽ FIFA World Cup 2026 National team jersey'], 'brazil-national', 'world-cup-2026']
  ])('detects %s', (name, category, path, teamId, leagueId) => {
    const result = classify(name, category, path);
    expect(result.team?.id).toBe(teamId);
    expect(result.league?.id).toBe(leagueId);
  });

  it('disambiguates Brazilian Serie A from Italian Serie A by source context', () => {
    expect(classify('Flamengo Jersey', 'Flamengo', ['⚽ Brazil Campeonato Brasileiro Série A']).league?.id).toBe('brasileirao-serie-a');
    expect(classify('Juventus Jersey', '⚽ Serie A', ['⚽ Serie A']).league?.id).toBe('serie-a-italia');
  });

  it('detects commercial facets and translates controlled terms', () => {
    const result = classify('Barcelona 26/27 Away Player Version Long Sleeve Women Jersey', '⚽ player version', ['⚽ La Liga']);
    expect(result.facets.map((facet) => facet.id)).toEqual(expect.arrayContaining(['shirts','player-version','long-sleeve','women']));
    expect(result.displayName).toContain('Versão Jogador');
    expect(result.displayName).toContain('Manga Longa');
    expect(result.displayName).toContain('Feminino');
  });

  it('keeps original and translated aliases searchable', () => {
    const result = classify('Barcelona 26/27 Player Version Jersey', '⚽ player version', ['⚽ La Liga']);
    expect(result.searchText).toContain('player version');
    expect(result.searchText).toContain('versao jogador');
    expect(result.searchText).toContain('barca');
    expect(result.searchText).toContain('barcelona');
  });

  it.each([
    ['Kids Kit Barcelona', '⚽👦🏻kids kit size：16-28', 'kids'],
    ['Women Barcelona Jersey', '⚽👩‍⚕️ Women', 'women'],
    ['Barcelona Long Sleeve Jersey', '⚽ Long sleeve', 'long-sleeve'],
    ['Barcelona Retro 1999 Jersey', '⚽ Retro', 'retro'],
    ['Barcelona Training Suit', 'Youth Pre-Match Training Suit', 'training'],
    ['Football shoes model X', 'football shoes', 'shoes']
  ])('maps %s to %s facet', (name, category, facetId) => {
    expect(classify(name, category, [category]).facets.some((facet) => facet.id === facetId)).toBe(true);
  });
});
