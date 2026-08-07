import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventParser, type ProgressEvent } from '@/lib/progress';

/**
 * Drives the real route handler with a scripted model stream.
 *
 * This covers the parts of the pipeline that do not depend on a live key: the
 * NDJSON transport, stage transitions derived from actual output, the early
 * analysis emission, and the mapping of thrown SDK errors onto the typed union.
 * The live Gemini call still needs a real key to verify.
 */

type Script =
  | { kind: 'chunks'; chunks: string[]; finishReason?: string }
  | { kind: 'throw'; error: unknown };

let script: Script = { kind: 'chunks', chunks: [] };

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();

  class FakeGoogleGenAI {
    models = {
      generateContentStream: async () => {
        if (script.kind === 'throw') throw script.error;
        const { chunks, finishReason } = script;
        return (async function* () {
          for (let i = 0; i < chunks.length; i += 1) {
            const last = i === chunks.length - 1;
            yield {
              text: chunks[i],
              candidates: last && finishReason ? [{ finishReason }] : undefined,
            };
          }
        })();
      },
    };
  }

  return { ...actual, GoogleGenAI: FakeGoogleGenAI };
});

const VALID_ABC = [
  'X:1',
  'T:Test',
  'C:Nobody',
  'M:4/4',
  'L:1/8',
  'Q:1/4=96',
  'K:C',
  '%%score {(V1) (V2)}',
  'V:1 clef=treble',
  'V:2 clef=bass',
  '[V:1] CDEF GABc | cBAG FEDC |]',
  '[V:2] C,2 G,2 C,2 G,2 | C,2 G,2 C,4 |]',
].join('\n');

const score = (note: string) => ({
  abc: VALID_ABC,
  suggestedTempo: 96,
  difficultyNote: note,
  keyChanged: false,
});

/** Property order mirrors the responseSchema's propertyOrdering. */
const DOCUMENT = JSON.stringify({
  track: { title: 'Test', artist: 'Nobody', genre: 'Pop', eraOrStyle: 'Modern' },
  musical: {
    key: 'C major',
    keyConfidence: 0.9,
    mode: 'Ionian',
    modulations: [],
    tempoBpm: 96,
    timeSignature: '4/4',
    meterChanges: [],
    feel: 'Straight eights',
  },
  form: [
    { section: 'Verse 1', startTime: '0:00', endTime: '0:30', bars: 16, description: 'Piano and voice.' },
  ],
  harmony: [{ section: 'Verse 1', chordSymbols: ['C', 'Am'], romanNumerals: ['I', 'vi'] }],
  instrumentation: ['Piano'],
  texture: 'Homophonic',
  melody: { range: 'C4 to G5', contour: 'Arch', motifs: ['Rising fourth'], phraseLength: '4 bars' },
  productionNotes: ['Close-miked piano.'],
  arrangementDecisions: ['Strings condensed into the left hand.'],
  transcriptionConfidence: 0.8,
  confidenceReason: 'Clear mix.',
  scores: { easy: score('Melody only.'), medium: score('Broken chords.'), hard: score('Inner voices.') },
});

function chunked(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

async function post(body: unknown): Promise<{ status: number; events: ProgressEvent[] }> {
  const { POST } = await import('@/app/api/analyze/route');
  const response = await POST(
    new Request('https://cadence.test/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

  // Pre-stream failures come back as a single JSON object, not NDJSON.
  if (!response.body || !response.headers.get('Content-Type')?.includes('ndjson')) {
    return { status: response.status, events: [JSON.parse(await response.text()) as ProgressEvent] };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parse = createEventParser();
  const events: ProgressEvent[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(...parse(decoder.decode(value, { stream: true })));
  }
  events.push(...parse(decoder.decode()));
  return { status: response.status, events };
}

const SOURCE = 'https://www.youtube.com/watch?v=EAqLI8g_LMk';

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  script = { kind: 'chunks', chunks: chunked(DOCUMENT, 40) };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/analyze — happy path', () => {
  it('streams NDJSON with a 200', async () => {
    const { status, events } = await post({ source: SOURCE });
    expect(status).toBe(200);
    expect(events.length).toBeGreaterThan(0);
  });

  it('walks the four stages in order', async () => {
    const { events } = await post({ source: SOURCE });
    const stages = events.flatMap((e) => (e.type === 'stage' ? [e.stage] : []));
    expect(stages).toEqual(['fetching', 'listening', 'mapping', 'arranging']);
  });

  it('names real work in the stage labels', async () => {
    const { events } = await post({ source: SOURCE });
    const labels = events.flatMap((e) => (e.type === 'stage' ? [e.label] : []));
    expect(labels).toEqual([
      'Fetching the video',
      'Listening for key and tempo',
      'Mapping the form',
      'Writing three arrangements',
    ]);
  });

  it('emits the analysis before the scores are finished', async () => {
    const { events } = await post({ source: SOURCE });
    const analysisAt = events.findIndex((e) => e.type === 'analysis');
    const resultAt = events.findIndex((e) => e.type === 'result');
    expect(analysisAt).toBeGreaterThanOrEqual(0);
    expect(analysisAt).toBeLessThan(resultAt);
  });

  it('the early analysis carries the full panel payload but no scores', async () => {
    const { events } = await post({ source: SOURCE });
    const analysis = events.find((e) => e.type === 'analysis');
    expect(analysis?.type).toBe('analysis');
    if (analysis?.type !== 'analysis') return;
    expect(analysis.analysis.musical.key).toBe('C major');
    expect(analysis.analysis.form).toHaveLength(1);
    expect(analysis.analysis.arrangementDecisions.length).toBeGreaterThan(0);
    expect(analysis.analysis).not.toHaveProperty('scores');
  });

  it('ends with a validated result carrying all three levels', async () => {
    const { events } = await post({ source: SOURCE });
    const last = events.at(-1);
    expect(last?.type).toBe('result');
    if (last?.type !== 'result') return;
    expect(Object.keys(last.result.scores)).toEqual(['easy', 'medium', 'hard']);
    expect(last.result.track.artist).toBe('Nobody');
    expect(last.id).toMatch(/^[a-z0-9]+$/);
  });

  it.each([1, 17, 512, 100_000])('produces the same result at chunk size %i', async (size) => {
    script = { kind: 'chunks', chunks: chunked(DOCUMENT, size) };
    const { events } = await post({ source: SOURCE });
    const last = events.at(-1);
    expect(last?.type).toBe('result');
  });
});

describe('POST /api/analyze — failures', () => {
  it('rejects a body that is not JSON', async () => {
    const { POST } = await import('@/app/api/analyze/route');
    const response = await POST(
      new Request('https://cadence.test/api/analyze', { method: 'POST', body: 'not json' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a source we do not read, before opening a stream', async () => {
    const { status, events } = await post({ source: 'https://example.com/song.mp3' });
    expect(status).toBe(400);
    expect(events[0]?.type).toBe('error');
    if (events[0]?.type !== 'error') return;
    expect(events[0].message).toMatch(/YouTube links and audio files/);
  });

  it('maps a 429 onto the rate-limited error kind', async () => {
    script = { kind: 'throw', error: Object.assign(new Error('Too many requests'), { status: 429 }) };
    const { events } = await post({ source: SOURCE });
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type !== 'error') return;
    expect(last.kind).toBe('rate-limited');
  });

  it('maps an unreachable video onto a message naming the cause and the fix', async () => {
    script = { kind: 'throw', error: new Error('The video is private and cannot be accessed') };
    const { events } = await post({ source: SOURCE });
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type !== 'error') return;
    expect(last.kind).toBe('source-unavailable');
    expect(last.message).toMatch(/private, age-restricted, or region-blocked/);
    expect(last.message).toMatch(/upload the audio file/);
  });

  it('reports truncation rather than shipping half an arrangement', async () => {
    script = {
      kind: 'chunks',
      chunks: chunked(DOCUMENT.slice(0, 400), 40),
      finishReason: 'MAX_TOKENS',
    };
    const { events } = await post({ source: SOURCE });
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type !== 'error') return;
    expect(last.kind).toBe('truncated');
  });

  it('fails the zod gate on a shape-valid but musically impossible response', async () => {
    const nonsense = JSON.parse(DOCUMENT) as { musical: { tempoBpm: number } };
    nonsense.musical.tempoBpm = 0;
    script = { kind: 'chunks', chunks: chunked(JSON.stringify(nonsense), 200) };
    const { events } = await post({ source: SOURCE });
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type !== 'error') return;
    expect(last.kind).toBe('schema-mismatch');
    expect(last.detail).toMatch(/tempoBpm/);
  });

  it('surfaces a missing API key as a typed error, not a crash', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.resetModules();
    const { status, events } = await post({ source: SOURCE });
    expect(status).toBe(200);
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type !== 'error') return;
    expect(last.kind).toBe('missing-api-key');
    expect(last.message).toMatch(/GEMINI_API_KEY/);
  });
});
