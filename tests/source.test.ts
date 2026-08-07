import { describe, expect, it } from 'vitest';

import { parseSource, workId } from '@/lib/source';
import { createEventParser, encodeEvent, type ProgressEvent } from '@/lib/progress';

describe('parseSource — YouTube', () => {
  it.each([
    'https://www.youtube.com/watch?v=EAqLI8g_LMk',
    'https://youtube.com/watch?v=EAqLI8g_LMk&t=42s',
    'https://m.youtube.com/watch?v=EAqLI8g_LMk',
    'https://music.youtube.com/watch?v=EAqLI8g_LMk',
    'https://youtu.be/EAqLI8g_LMk',
    'https://youtu.be/EAqLI8g_LMk?si=abc',
    'https://www.youtube.com/shorts/EAqLI8g_LMk',
    'https://www.youtube.com/live/EAqLI8g_LMk',
    'https://www.youtube.com/embed/EAqLI8g_LMk',
  ])('canonicalises %s', (input) => {
    const parsed = parseSource(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source.kind).toBe('youtube');
    expect(parsed.source.videoId).toBe('EAqLI8g_LMk');
    expect(parsed.source.uri).toBe('https://www.youtube.com/watch?v=EAqLI8g_LMk');
    expect(parsed.source.mimeType).toBe('video/*');
  });

  it('rejects a YouTube link with no video id', () => {
    const parsed = parseSource('https://www.youtube.com/results?search_query=jazz');
    expect(parsed.ok).toBe(false);
  });

  it('rejects a malformed video id', () => {
    expect(parseSource('https://youtu.be/tooshort').ok).toBe(false);
  });
});

describe('parseSource — Blob uploads', () => {
  it('accepts an audio file on the Blob host', () => {
    const parsed = parseSource('https://abc123.public.blob.vercel-storage.com/take-1.mp3');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source.kind).toBe('blob');
    expect(parsed.source.mimeType).toBe('audio/mpeg');
  });

  it('rejects a non-audio file on the Blob host', () => {
    expect(parseSource('https://abc123.public.blob.vercel-storage.com/notes.pdf').ok).toBe(false);
  });
});

describe('parseSource — rejections', () => {
  it.each([
    ['empty input', ''],
    ['not a URL', 'weird fishes radiohead'],
    ['a host we do not read', 'https://example.com/song.mp3'],
    ['a host that merely contains the blob suffix', 'https://evil.com/x.public.blob.vercel-storage.com'],
    ['a file: URL', 'file:///etc/passwd'],
  ])('rejects %s', (_label, input) => {
    const parsed = parseSource(input);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message.length).toBeGreaterThan(0);
  });
});

describe('workId', () => {
  it('is stable for the same video across link forms', () => {
    const a = parseSource('https://youtu.be/EAqLI8g_LMk');
    const b = parseSource('https://www.youtube.com/watch?v=EAqLI8g_LMk&t=9s');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(workId(a.source)).toBe(workId(b.source));
  });

  it('differs between videos', () => {
    const a = parseSource('https://youtu.be/EAqLI8g_LMk');
    const b = parseSource('https://youtu.be/6sPKLZ0qKhY');
    if (!a.ok || !b.ok) throw new Error('fixture failed to parse');
    expect(workId(a.source)).not.toBe(workId(b.source));
  });
});

describe('NDJSON protocol', () => {
  const events: ProgressEvent[] = [
    { type: 'stage', stage: 'fetching', label: 'Fetching the video', elapsedMs: 0 },
    { type: 'heartbeat', elapsedMs: 5000 },
    { type: 'error', kind: 'rate-limited', message: 'Slow down.' },
  ];

  it('round-trips events through the parser', () => {
    const parse = createEventParser();
    const wire = events.map(encodeEvent).join('');
    expect(parse(wire)).toEqual(events);
  });

  it('reassembles events split across chunk boundaries', () => {
    const parse = createEventParser();
    const wire = events.map(encodeEvent).join('');
    const collected: ProgressEvent[] = [];
    for (const char of wire) collected.push(...parse(char));
    expect(collected).toEqual(events);
  });

  it('holds back a partial trailing line until it completes', () => {
    const parse = createEventParser();
    expect(parse('{"type":"heartbeat","elapsed')).toEqual([]);
    expect(parse('Ms":10}\n')).toEqual([{ type: 'heartbeat', elapsedMs: 10 }]);
  });

  it('skips a malformed line without dropping the rest', () => {
    const parse = createEventParser();
    expect(parse('not json\n{"type":"heartbeat","elapsedMs":1}\n')).toEqual([
      { type: 'heartbeat', elapsedMs: 1 },
    ]);
  });
});
