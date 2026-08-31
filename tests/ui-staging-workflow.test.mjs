import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile('.github/workflows/deploy-ui-staging.yml', 'utf8');

describe('UI staging deployment workflow', () => {
  it('smokes and records the canonical extensionless portal route', () => {
    expect(workflow).toContain('"$PREVIEW_URL/app" > /tmp/preview-app.html');
    expect(workflow).toContain('"appUrl": "$PREVIEW_URL/app"');
    expect(workflow).not.toContain('"$PREVIEW_URL/app.html" > /tmp/preview-app.html');
  });

  it('keeps the isolated preview proof tied to the trusted main SHA', () => {
    expect(workflow).toContain('SOURCE_SHA: ${{ github.sha }}');
    expect(workflow).toContain('"sourceCommit": "$SOURCE_SHA"');
    expect(workflow).toContain('"productionDataTouched": false');
  });
});
