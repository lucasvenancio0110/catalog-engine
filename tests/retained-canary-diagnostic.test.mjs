import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-retained-canary-diagnostic.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-retained-canary-diagnostic.mjs', 'utf8');

describe('retained automatic import canary diagnosis', () => {
  it('keeps pull-request validation secret-free', () => {
    const validateStart = workflow.indexOf('  validate:');
    const diagnoseStart = workflow.indexOf('  diagnose:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(diagnoseStart).toBeGreaterThan(validateStart);
    const validateBlock = workflow.slice(validateStart, diagnoseStart);
    expect(validateBlock).not.toContain('secrets.CLOUDFLARE');
    expect(workflow).toContain("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
  });

  it('is read-only across D1 and Queue APIs', () => {
    expect(script).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(script).not.toMatch(/\bUPDATE\s+[a-z_]/i);
    expect(script).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(script).not.toContain('/purge');
    expect(script).not.toContain('/messages');
    expect(script).toContain('last_error_code');
    expect(script).toContain('supplier_album_detail_state');
    expect(script).toContain('queueBacklogs');
  });

  it('does not print private supplier URLs', () => {
    expect(script).not.toContain('source_url');
    expect(script).not.toContain('referer_url');
  });
});
