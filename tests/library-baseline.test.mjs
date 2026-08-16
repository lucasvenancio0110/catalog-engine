import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import sharp from 'sharp';
import { z } from 'zod';

describe('approved JavaScript library baseline', () => {
  it('parses HTML with Cheerio', () => {
    const $ = cheerio.load('<main><article data-id="42">Produto</article></main>');
    expect($('article').attr('data-id')).toBe('42');
    expect($('article').text()).toBe('Produto');
  });

  it('validates structured data with Zod', () => {
    const schema = z.object({ id: z.string(), images: z.array(z.string()).min(1) });
    expect(schema.parse({ id: '42', images: ['./image.webp'] }).id).toBe('42');
  });

  it('limits asynchronous work with PQueue', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const order = [];

    const first = queue.add(async () => {
      order.push('first');
      return 1;
    });
    const second = queue.add(async () => {
      order.push('second');
      return 2;
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('processes images with Sharp', async () => {
    const buffer = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#ffffff'
      }
    }).webp({ quality: 80 }).toBuffer();

    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(32);
    expect(metadata.height).toBe(32);
  });
});
