import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const motionSource = await readFile('src/ui/motion.js', 'utf8');
const motionCss = await readFile('src/storefront/experience-motion.css', 'utf8');
const entrySource = await readFile('src/entry.js', 'utf8');
const libraryDoc = await readFile('docs/JAVASCRIPT_LIBRARIES.md', 'utf8');
const dependencyPolicy = JSON.parse(await readFile('config/dependency-policy.json', 'utf8'));

describe('M9B storefront experience stack foundation', () => {
  it('centralizes motion timing, reduced-motion handling and progressive View Transitions', () => {
    expect(motionSource).toContain('MOTION_DURATION');
    expect(motionSource).toContain('(prefers-reduced-motion: reduce)');
    expect(motionSource).toContain('document.startViewTransition');
    expect(motionSource).toContain('bindPressFeedback');
    expect(motionSource).toContain("event.key === 'Enter'");
    expect(motionSource).toContain("event.key === ' '");
  });

  it('loads shared storefront motion tokens with a reduced-motion branch', () => {
    expect(entrySource).toContain("./storefront/experience-motion.css");
    expect(motionCss).toContain('--ce-motion-press: 110ms');
    expect(motionCss).toContain('--ce-motion-page: 400ms');
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps new large UI libraries staged rather than silently adding competing runtime owners', () => {
    expect(dependencyPolicy.runtime).not.toContain('@awesome.me/webawesome');
    expect(dependencyPolicy.runtime).not.toContain('framework7');
    expect(dependencyPolicy.runtime).not.toContain('gsap');
    expect(dependencyPolicy.approvedFutureStorefront).toEqual(
      expect.arrayContaining(['@awesome.me/webawesome', 'framework7', 'gsap'])
    );

    expect(libraryDoc).toContain('Approved future storefront pilots');
    expect(libraryDoc).toContain('Benchmark-only libraries');
    expect(libraryDoc).toContain('UIkit, Ionic Core, Onsen UI and Bootstrap');
    expect(libraryDoc).toContain('not yet runtime dependencies');
  });
});
