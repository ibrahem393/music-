import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareScore, type ScoreState } from '@/lib/client/prepareScore';

function arrangement(bars: number): string {
  const treble = Array.from({ length: bars }, () => 'CDEF GABc').join(' | ');
  const bass = Array.from({ length: bars }, () => 'C,2 G,2 C,2 G,2').join(' | ');
  return [
    'X:1',
    'T:Test',
    'C:Nobody',
    'M:4/4',
    'L:1/8',
    'Q:1/4=96',
    'K:C',
    '%%score {(1) (2)}',
    'V:1 clef=treble',
    'V:2 clef=bass',
    `[V:1] ${treble} |]`,
    `[V:2] ${bass} |]`,
  ].join('\n');
}

const VALID = arrangement(16);
const TOO_SHORT = arrangement(4);

type Call = { abc: string; error: string };

function stubRepair(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    return handler(body);
  });
  return calls;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function run(abc: string) {
  const states: ScoreState[] = [];
  return prepareScore(abc, {
    level: 'hard',
    accuracy: 'fast',
    onState: (state) => states.push(state),
  }).then((final) => ({ final, states }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prepareScore — valid notation', () => {
  it('goes straight to ready without calling repair', async () => {
    const calls = stubRepair(() => jsonResponse({}));
    const { final, states } = await run(VALID);

    expect(calls).toHaveLength(0);
    expect(final.status).toBe('ready');
    if (final.status !== 'ready') return;
    expect(final.repaired).toBe(false);
    expect(final.bars).toBe(16);
    expect(states.map((s) => s.status)).toEqual(['validating', 'ready']);
  });
});

describe('prepareScore — the repair loop', () => {
  it('sends the parser error to repair and accepts a corrected score', async () => {
    const calls = stubRepair(() => jsonResponse({ abc: VALID, fixNote: 'extended to 16 bars' }));
    const { final, states } = await run(TOO_SHORT);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.abc).toBe(TOO_SHORT);
    expect(calls[0]?.error).toMatch(/too-few-bars/);

    expect(final.status).toBe('ready');
    if (final.status !== 'ready') return;
    expect(final.repaired).toBe(true);
    expect(final.fixNote).toBe('extended to 16 bars');
    expect(states.map((s) => s.status)).toEqual(['validating', 'repairing', 'ready']);
  });

  it('never tries a second repair — one pass, then honesty', async () => {
    // Repair returns something still too short.
    const calls = stubRepair(() => jsonResponse({ abc: TOO_SHORT, fixNote: 'no change' }));
    const { final } = await run(TOO_SHORT);

    expect(calls).toHaveLength(1);
    expect(final.status).toBe('unavailable');
  });

  it('reports both attempts in the detail so the failure is inspectable', async () => {
    stubRepair(() => jsonResponse({ abc: TOO_SHORT, fixNote: 'no change' }));
    const { final } = await run(TOO_SHORT);

    expect(final.status).toBe('unavailable');
    if (final.status !== 'unavailable') return;
    expect(final.detail).toMatch(/Before repair:/);
    expect(final.detail).toMatch(/After repair:/);
  });

  it('names the cause and says the other levels are fine', async () => {
    stubRepair(() => jsonResponse({ abc: TOO_SHORT, fixNote: '' }));
    const { final } = await run(TOO_SHORT);

    expect(final.status).toBe('unavailable');
    if (final.status !== 'unavailable') return;
    expect(final.reason).toMatch(/hard arrangement/);
    expect(final.reason).toMatch(/too short/);
    expect(final.reason).toMatch(/other levels are unaffected/);
  });

  it('marks the level unavailable when repair returns an error status', async () => {
    stubRepair(() => jsonResponse({ error: 'Gemini is rate-limiting this key.' }, 429));
    const { final } = await run(TOO_SHORT);

    expect(final.status).toBe('unavailable');
    if (final.status !== 'unavailable') return;
    expect(final.detail).toMatch(/429/);
  });

  it('marks the level unavailable when repair cannot be reached at all', async () => {
    stubRepair(() => {
      throw new TypeError('fetch failed');
    });
    const { final } = await run(TOO_SHORT);

    expect(final.status).toBe('unavailable');
    if (final.status !== 'unavailable') return;
    expect(final.detail).toMatch(/could not be reached/);
  });

  it('repairs notation that is structurally wrong, not just short', async () => {
    const oneHand = [
      'X:1',
      'T:Lead sheet',
      'M:4/4',
      'L:1/8',
      'K:C',
      `${'CDEF GABc | '.repeat(20)}|]`,
    ].join('\n');
    const calls = stubRepair(() => jsonResponse({ abc: VALID, fixNote: 'added the bass staff' }));
    const { final } = await run(oneHand);

    expect(calls[0]?.error).toMatch(/staves|hand/i);
    expect(final.status).toBe('ready');
  });
});
