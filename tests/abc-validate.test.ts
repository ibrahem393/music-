import { describe, expect, it } from 'vitest';

import { MIN_BARS, plainWarning, stripFences, validateAbc } from '@/lib/abc/validate';

/** Builds a well-formed two-staff arrangement with `bars` bars. */
function arrangement(bars: number, options: { leftHand?: boolean; score?: string } = {}): string {
  const leftHand = options.leftHand ?? true;
  const treble = Array.from({ length: bars }, () => 'CDEF GABc').join(' | ');
  const bass = Array.from({ length: bars }, () => (leftHand ? 'C,2 G,2 C,2 G,2' : 'z8')).join(' | ');
  return [
    'X:1',
    'T:Test Arrangement',
    'C:Nobody',
    'M:4/4',
    'L:1/8',
    'Q:1/4=96',
    'K:C',
    options.score ?? '%%score {(1) (2)}',
    'V:1 clef=treble',
    'V:2 clef=bass',
    `[V:1] ${treble} |]`,
    `[V:2] ${bass} |]`,
  ].join('\n');
}

describe('validateAbc — accepts real arrangements', () => {
  it('accepts a 16-bar two-staff piano system', () => {
    const result = validateAbc(arrangement(16));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.staffCount).toBe(2);
    expect(result.stats.bars).toBe(16);
    expect(result.stats.warnings).toEqual([]);
  });

  it('reports per-staff note counts so a silent hand is visible', () => {
    const result = validateAbc(arrangement(16));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.notesPerStaff).toHaveLength(2);
    expect(result.stats.notesPerStaff[0]).toBeGreaterThan(0);
    expect(result.stats.notesPerStaff[1]).toBeGreaterThan(0);
  });
});

describe('validateAbc — catches what abcjs shrugs at', () => {
  /**
   * These are the cases that motivated a structural validator: abcjs parses
   * every one of them without throwing, and most without a single warning.
   */
  it.each([
    ['empty input', ''],
    ['prose instead of music', 'this is not music at all, it is a sentence'],
    ['headers with no music', 'X:1\nT:Nothing\nM:4/4\nL:1/8\nK:C\n'],
    ['unbalanced brackets', 'X:1\nT:T\nM:4/4\nK:C\n[V:1] CDEF ((( zzz |\n'],
    ['a single-staff lead sheet', 'X:1\nT:T\nM:4/4\nL:1/8\nK:C\n' + 'CDEF GABc | '.repeat(20) + '|]'],
  ])('rejects %s', (_label, abc) => {
    expect(validateAbc(abc).ok).toBe(false);
  });

  it('rejects an arrangement shorter than the 16-bar floor', () => {
    const result = validateAbc(arrangement(8));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toContain('too-few-bars');
    expect(result.parserError).toMatch(/at least 16/);
  });

  it('rejects an arrangement whose left hand is all rests', () => {
    const result = validateAbc(arrangement(16, { leftHand: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toContain('silent-staff');
    expect(result.parserError).toMatch(/left hand/);
  });

  it('catches the %%score id mismatch that the brief specified', () => {
    // %%score {(V1) (V2)} above voices declared V:1 and V:2 is a real abcjs
    // error. The prompt emits {(1) (2)} instead; this proves the guard works.
    const result = validateAbc(arrangement(16, { score: '%%score {(V1) (V2)}' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toContain('parser-warnings');
  });

  it('produces a parser error a repair prompt can act on', () => {
    const result = validateAbc(arrangement(4));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.parserError).toMatch(/^1\. \[/);
    expect(result.parserError.length).toBeGreaterThan(20);
  });
});

describe('stripFences', () => {
  it('removes a fenced block abcjs would otherwise keep', () => {
    const fenced = '```abc\n' + arrangement(16) + '\n```';
    expect(stripFences(fenced).startsWith('X:1')).toBe(true);
    expect(stripFences(fenced)).not.toMatch(/```/);
  });

  it('leaves unfenced input alone', () => {
    const abc = arrangement(16);
    expect(stripFences(abc)).toBe(abc);
  });

  it('validates fenced ABC once the fence is gone', () => {
    expect(validateAbc('```\n' + arrangement(16) + '\n```').ok).toBe(true);
  });
});

describe('plainWarning', () => {
  it('strips the inline markup abcjs puts in warnings', () => {
    const raw = 'Music Line:8:3: Bad thing:  V:<span style="font-weight:bold;">1</span> clef=treble';
    expect(plainWarning(raw)).toBe('Music Line:8:3: Bad thing: V:1 clef=treble');
    expect(plainWarning(raw)).not.toMatch(/[<>]/);
  });
});

describe('MIN_BARS', () => {
  it('matches the floor the prompt states', () => {
    expect(MIN_BARS).toBe(16);
  });
});
