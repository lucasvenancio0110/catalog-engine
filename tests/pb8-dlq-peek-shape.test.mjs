import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizePeekShapes } from '../scripts/cloudflare-pb8-dlq-peek-shape.mjs';

describe('PB8 detail DLQ peek shape diagnosis', () => {
  it('reports only aggregate body and metadata shape', () => {
    const summary = summarizePeekShapes([
      { ref: 'opaque-a', body: '{"type":"detail"}', metadata: { 'CF-Content-Type': 'json' } },
      { ref: 'opaque-b', body: 'not-json-private-data', metadata: { 'CF-Content-Type': 'v8' } },
      { ref: 'opaque-c', body: '', metadata: { 'CF-Content-Type': 'text' } },
      { body: { private: true }, metadata: { other: 'value' } },
      { ref: 'opaque-d', body: null }
    ]);

    expect(summary).toEqual({
      peeked: 5,
      withRef: 4,
      bodyShapes: { string: 3, object: 1, null: 1 },
      metadataClasses: { json: 1, v8: 1, text: 1, 'metadata-other': 1, none: 1 },
      stringBodyJsonParseable: 1,
      stringBodyNotJson: 1,
      stringBodyEmpty: 1
    });
    expect(JSON.stringify(summary)).not.toContain('opaque-');
    expect(JSON.stringify(summary)).not.toContain('not-json-private-data');
  });

  it('does not perform destructive queue operations', () => {
    const source = fs.readFileSync('scripts/cloudflare-pb8-dlq-peek-shape.mjs', 'utf8');
    expect(source).toContain('/messages/peek');
    expect(source).not.toContain('/messages/pull');
    expect(source).not.toContain('/messages/ack');
    expect(source).not.toContain('/messages/purge');
  });
});
