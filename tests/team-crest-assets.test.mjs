import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseCrestZipEntry } from '../scripts/import-team-crests.mjs';
import {
  normalizeTeamCrestSlug,
  resolveTeamCrest,
  teamCrestCandidates,
  teamCrestRegistryInfo
} from '../src/catalog/team-crests.js';

const manifest = JSON.parse(await readFile('src/catalog/team-crest-manifest.json', 'utf8'));

describe('M9B authorized team crest registry', () => {
  it('rejects unsafe archive entries and accepts only normalized PNG variants', () => {
    expect(parseCrestZipEntry('256x256/flamengo.football-logos.cc.png')).toEqual({
      size: '256x256',
      slug: 'flamengo',
      selected: true
    });
    expect(() => parseCrestZipEntry('../flamengo.png')).toThrow('path_rejected');
    expect(() => parseCrestZipEntry('256x256/flamengo.svg')).toThrow('entry_rejected');
  });

  it('ships a bounded opaque manifest without original archive paths', async () => {
    const files = (await readdir('src/assets/team-crests')).filter((name) => name.endsWith('.png'));
    expect(manifest.teamCount).toBeGreaterThan(300);
    expect(manifest.assetCount).toBe(files.length);
    expect(manifest.provenance.originalArchivesCommitted).toBe(false);
    expect(Object.values(manifest.assets).every((id) => /^tc_[a-f0-9]{20}$/.test(id))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('upload/');
    expect(teamCrestRegistryInfo.teamCount).toBe(manifest.teamCount);
  });

  it('resolves direct, localized and explicit aliases without trusting external URLs', () => {
    expect(normalizeTeamCrestSlug('São Paulo')).toBe('sao-paulo');
    expect(teamCrestCandidates({ team_id: 'psg', name: 'Paris Saint-Germain' })).toContain(
      'paris-saint-germain'
    );
    expect(resolveTeamCrest({ team_id: 'flamengo', name: 'Flamengo' })?.url).toMatch(/\.png$/);
    expect(resolveTeamCrest({ team_id: 'bayern-munich', name: 'Bayern de Munique' })?.slug).toBe(
      'bayern-munchen'
    );
    expect(
      resolveTeamCrest({
        team_id: 'unknown',
        name: 'Unknown',
        logo_url: 'https://evil.example/logo.svg'
      })
    ).toBeNull();
  });

  it('covers every crest in the initial featured-club and national-team experience', () => {
    const featuredTeams = [
      ['real-madrid', 'Real Madrid'],
      ['barcelona', 'Barcelona'],
      ['manchester-united', 'Manchester United'],
      ['arsenal', 'Arsenal'],
      ['flamengo', 'Flamengo'],
      ['manchester-city', 'Manchester City'],
      ['inter-milan', 'Inter de Milão'],
      ['chelsea', 'Chelsea'],
      ['corinthians', 'Corinthians'],
      ['psg', 'Paris Saint-Germain'],
      ['palmeiras', 'Palmeiras'],
      ['tottenham', 'Tottenham']
    ];
    const nationalTeams = [
      ['brazil-national', 'Brasil'],
      ['argentina-national', 'Argentina'],
      ['germany-national', 'Alemanha'],
      ['portugal-national', 'Portugal'],
      ['spain-national', 'Espanha'],
      ['england-national', 'Inglaterra'],
      ['france-national', 'França']
    ];

    for (const [teamId, name] of [...featuredTeams, ...nationalTeams]) {
      expect(resolveTeamCrest({ team_id: teamId, name }), teamId).not.toBeNull();
    }
  });
});
