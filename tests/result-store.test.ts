import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadResult, saveResult } from '@/lib/client/resultStore';
import type { AnalysisResult } from '@/lib/gemini/schema';

const VALID_ABC = [
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
  '[V:1] CDEF GABc | cBAG FEDC |]',
  '[V:2] C,2 G,2 C,2 G,2 | C,2 G,2 C,4 |]',
].join('\n');

const score = { abc: VALID_ABC, suggestedTempo: 96, difficultyNote: 'Fine.', keyChanged: false };

const RESULT: AnalysisResult = {
  track: { title: 'Test', artist: 'Nobody', genre: 'Pop', eraOrStyle: 'Modern' },
  musical: {
    key: 'C major',
    keyConfidence: 0.9,
    mode: 'Ionian',
    modulations: [],
    tempoBpm: 96,
    timeSignature: '4/4',
    meterChanges: [],
    feel: 'Straight',
  },
  form: [{ section: 'Verse', startTime: '0:00', endTime: '0:30', bars: 16, description: 'x' }],
  harmony: [],
  instrumentation: ['Piano'],
  texture: 'Homophonic',
  melody: { range: 'C4 to G5', contour: 'Arch', motifs: [], phraseLength: '4 bars' },
  productionNotes: [],
  arrangementDecisions: ['Condensed the strings.'],
  transcriptionConfidence: 0.8,
  confidenceReason: 'Clear mix.',
  scores: { easy: score, medium: score, hard: score },
};

/** Minimal sessionStorage stand-in; Node has none. */
function stubStorage(overrides: Partial<Storage> = {}): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
    ...overrides,
  } satisfies Storage);
  return store;
}

beforeEach(() => {
  stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resultStore', () => {
  it('round-trips a result', () => {
    saveResult({ id: 'abc', accuracy: 'accurate', result: RESULT });
    const loaded = loadResult('abc');
    expect(loaded?.id).toBe('abc');
    expect(loaded?.accuracy).toBe('accurate');
    expect(loaded?.result.track.title).toBe('Test');
    expect(Object.keys(loaded?.result.scores ?? {})).toEqual(['easy', 'medium', 'hard']);
  });

  it('returns null for an id that was never stored', () => {
    expect(loadResult('missing')).toBeNull();
  });

  it('keys entries by id so two analyses do not collide', () => {
    saveResult({ id: 'one', accuracy: 'fast', result: RESULT });
    saveResult({
      id: 'two',
      accuracy: 'fast',
      result: { ...RESULT, track: { ...RESULT.track, title: 'Second' } },
    });
    expect(loadResult('one')?.result.track.title).toBe('Test');
    expect(loadResult('two')?.result.track.title).toBe('Second');
  });

  it('rejects a stored entry that no longer matches the schema', () => {
    // A stale entry from an older shape, or anything a user pasted in.
    sessionStorage.setItem(
      'cadence:result:stale',
      JSON.stringify({ accuracy: 'fast', result: { track: { title: 'Half a record' } } }),
    );
    expect(loadResult('stale')).toBeNull();
  });

  it('rejects an entry that is not JSON at all', () => {
    sessionStorage.setItem('cadence:result:broken', 'not json');
    expect(loadResult('broken')).toBeNull();
  });

  it('defaults an unrecognised accuracy to fast rather than failing', () => {
    sessionStorage.setItem(
      'cadence:result:odd',
      JSON.stringify({ accuracy: 'turbo', result: RESULT }),
    );
    expect(loadResult('odd')?.accuracy).toBe('fast');
  });

  it('does not throw when storage is unavailable', () => {
    vi.unstubAllGlobals();
    stubStorage({
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
      getItem: () => {
        throw new DOMException('SecurityError');
      },
    });

    expect(() => saveResult({ id: 'x', accuracy: 'fast', result: RESULT })).not.toThrow();
    expect(loadResult('x')).toBeNull();
  });
});
