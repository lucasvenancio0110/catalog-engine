import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/cloudflare-ic4b-detail-fanout.yml', 'utf8');

describe('IC4B production proof cleanup convergence', () => {
  it('retries teardown a bounded number of times without weakening the cleanup gate', () => {
    const cleanupStep = workflow
      .split('      - name: Delete all isolated IC4B proof resources')[1]
      .split('      - name: Finalize safe IC4B evidence after cleanup')[0];

    expect(cleanupStep).toContain('if: always()');
    expect(cleanupStep).toContain('cleanup_ok=0');
    expect(cleanupStep).toContain('for attempt in 1 2 3 4 5; do');
    expect(cleanupStep).toContain('node scripts/cloudflare-ic4b-detail-fanout.mjs cleanup');
    expect(cleanupStep).toContain('cleanup_ok=1');
    expect(cleanupStep).toContain('sleep $((attempt * 2))');
    expect(cleanupStep).toContain('if [ "$cleanup_ok" -ne 1 ]; then');
    expect(cleanupStep).toContain('proof remains red');
    expect(cleanupStep).toContain('exit 1');
  });

  it('still requires full cleanup evidence before publishing success', () => {
    expect(workflow).toContain('.cleanup.workerCleaned == true');
    expect(workflow).toContain('.cleanup.queueCleaned == true');
    expect(workflow).toContain('.cleanup.dlqCleaned == true');
    expect(workflow).toContain('.cleanup.databaseCleaned == true');
    expect(workflow).toContain('Publish successful IC4B production proof');
  });
});
