import abcjs from 'abcjs';
import { describe, expect, it } from 'vitest';

import {
  MAX_TEMPO,
  MAX_TRANSPOSE,
  MIN_TEMPO,
  MIN_TRANSPOSE,
  clampTempo,
  clampTranspose,
  exportFileName,
  setTempo,
  toMidiBytes,
  transposeAbc,
} from '@/lib/abc/transform';
import { validateAbc } from '@/lib/abc/validate';

function arrangement(key = 'C', bars = 16): string {
  const treble = Array.from({ length: bars }, () => 'CDEF GABc').join(' | ');
  const bass = Array.from({ length: bars }, () => 'C,2 G,2 C,2 G,2').join(' | ');
  return [
    'X:1',
    'T:Test',
    'C:Nobody',
    'M:4/4',
    'L:1/8',
    'Q:1/4=96',
    `K:${key}`,
    '%%score {(1) (2)}',
    'V:1 clef=treble',
    'V:2 clef=bass',
    `[V:1] ${treble} |]`,
    `[V:2] ${bass} |]`,
  ].join('\n');
}

const keyOf = (abc: string): string => abcjs.parseOnly(abc)[0].getKeySignature().root ?? '';

describe('clampTranspose', () => {
  it('holds the −6 to +6 range from the brief', () => {
    expect(clampTranspose(-99)).toBe(MIN_TRANSPOSE);
    expect(clampTranspose(99)).toBe(MAX_TRANSPOSE);
    expect(MIN_TRANSPOSE).toBe(-6);
    expect(MAX_TRANSPOSE).toBe(6);
  });

  it('passes values inside the range through', () => {
    for (const n of [-6, -3, 0, 4, 6]) expect(clampTranspose(n)).toBe(n);
  });

  it('rounds fractional input and survives NaN', () => {
    expect(clampTranspose(2.4)).toBe(2);
    expect(clampTranspose(Number.NaN)).toBe(0);
    expect(clampTranspose(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('clampTempo', () => {
  it('holds the 40 to 200 range from the brief', () => {
    expect(clampTempo(1)).toBe(MIN_TEMPO);
    expect(clampTempo(10_000)).toBe(MAX_TEMPO);
    expect(MIN_TEMPO).toBe(40);
    expect(MAX_TEMPO).toBe(200);
  });

  it('survives NaN', () => {
    expect(clampTempo(Number.NaN)).toBe(MIN_TEMPO);
  });
});

describe('transposeAbc', () => {
  it('is a no-op at zero semitones', () => {
    const abc = arrangement();
    expect(transposeAbc(abc, 0)).toBe(abc);
  });

  it('rewrites the key signature in the source', () => {
    expect(keyOf(arrangement('C'))).toBe('C');
    expect(keyOf(transposeAbc(arrangement('C'), 2))).toBe('D');
    expect(keyOf(transposeAbc(arrangement('C'), -3))).toBe('A');
  });

  it('produces ABC that still validates as a two-staff arrangement', () => {
    for (const semitones of [-6, -5, -1, 1, 5, 6]) {
      const result = validateAbc(transposeAbc(arrangement('C'), semitones));
      expect(result.ok, `transpose by ${semitones} should stay valid`).toBe(true);
      if (!result.ok) continue;
      expect(result.stats.bars).toBe(16);
      expect(result.stats.staffCount).toBe(2);
    }
  });

  it('preserves the note count — transposing moves music, it does not lose it', () => {
    const before = validateAbc(arrangement('C'));
    const after = validateAbc(transposeAbc(arrangement('C'), 4));
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.stats.soundingNotes).toBe(before.stats.soundingNotes);
  });

  it('clamps out-of-range requests rather than transposing wildly', () => {
    expect(keyOf(transposeAbc(arrangement('C'), 99))).toBe(keyOf(transposeAbc(arrangement('C'), 6)));
  });

  it('round-trips back to the original key', () => {
    const there = transposeAbc(arrangement('C'), 5);
    expect(keyOf(transposeAbc(there, -5))).toBe('C');
  });
});

describe('setTempo', () => {
  it('replaces an existing Q: header', () => {
    const out = setTempo(arrangement(), 132);
    expect(out).toMatch(/^Q:1\/4=132$/m);
    expect(out.match(/^Q:/gm)).toHaveLength(1);
  });

  it('inserts a Q: header before K: when there is none', () => {
    const withoutTempo = arrangement().replace(/^Q:.*$/m, '').replace(/\n\n/, '\n');
    const out = setTempo(withoutTempo, 120);
    expect(out).toMatch(/^Q:1\/4=120$/m);
    expect(out.indexOf('Q:1/4=120')).toBeLessThan(out.indexOf('K:'));
  });

  it('clamps to the slider range', () => {
    expect(setTempo(arrangement(), 5)).toMatch(/Q:1\/4=40/);
    expect(setTempo(arrangement(), 9000)).toMatch(/Q:1\/4=200/);
  });

  it('is read back by the parser', () => {
    const out = setTempo(arrangement(), 144);
    expect(abcjs.parseOnly(out)[0].getBpm()).toBe(144);
  });
});

describe('toMidiBytes', () => {
  it('produces a standard MIDI file', () => {
    const result = toMidiBytes(arrangement());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "MThd" — the MIDI header chunk.
    expect(Array.from(result.bytes.slice(0, 4))).toEqual([77, 84, 104, 100]);
    expect(result.bytes.length).toBeGreaterThan(100);
  });

  it('reflects the transposition rather than exporting the original key', () => {
    const original = toMidiBytes(arrangement('C'));
    const moved = toMidiBytes(transposeAbc(arrangement('C'), 5));
    expect(original.ok && moved.ok).toBe(true);
    if (!original.ok || !moved.ok) return;
    expect(Buffer.from(moved.bytes).equals(Buffer.from(original.bytes))).toBe(false);
  });
});

describe('exportFileName', () => {
  it('builds a slug from title, artist and level', () => {
    expect(exportFileName('Weird Fishes', 'Radiohead', 'hard', 'musicxml')).toBe(
      'weird-fishes-radiohead-hard.musicxml',
    );
  });

  it('strips characters that break filesystems', () => {
    const name = exportFileName('A/B: "C"\\D*?', 'X|Y', 'easy', 'midi');
    expect(name).toMatch(/^[a-z0-9-]+\.mid$/);
  });

  it('folds accents rather than dropping the word', () => {
    expect(exportFileName('Café Tacvba', 'Años', 'medium', 'abc')).toBe(
      'cafe-tacvba-anos-medium.abc',
    );
  });

  it('falls back to a usable name when everything is stripped', () => {
    expect(exportFileName('///', '***', '', 'midi')).toBe('cadence-score.mid');
  });

  it('uses the right extension per format', () => {
    expect(exportFileName('t', 'a', 'easy', 'musicxml')).toMatch(/\.musicxml$/);
    expect(exportFileName('t', 'a', 'easy', 'midi')).toMatch(/\.mid$/);
    expect(exportFileName('t', 'a', 'easy', 'abc')).toMatch(/\.abc$/);
  });
});
