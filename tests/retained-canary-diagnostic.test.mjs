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
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('inputs.tenant_id');
    expect(workflow).toContain('t_877e74005a61fd5ce924');
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
    expect(script).toContain('readOnly: true');
    expect(script).toContain('PRAGMA foreign_key_check');
    expect(script).toContain('tenant_classification_jobs');
    expect(script).toContain('tenant_verification_jobs');
    expect(script).toContain('supplier_sync_stage_runs');
  });

  it('does not print private supplier URLs', () => {
    expect(script).not.toContain('source_url');
    expect(script).not.toContain('referer_url');
    expect(script).not.toContain('metadata_json');
    expect(script).not.toContain('findings_json');
  });
});
