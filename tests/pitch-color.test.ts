import { describe, expect, it } from 'vitest';

import {
  PITCH_HUES,
  hueForName,
  hueForPitchClass,
  hueStyle,
  parsePitchClass,
  wheelPosition,
} from '@/components/PitchColor';

describe('the wheel', () => {
  it('has twelve hues, one per pitch class', () => {
    expect(PITCH_HUES).toHaveLength(12);
  });

  it('keeps every hue inside a single turn', () => {
    for (const hue of PITCH_HUES) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('gives every pitch class a distinct hue', () => {
    const hues = Array.from({ length: 12 }, (_, pc) => hueForPitchClass(pc));
    expect(new Set(hues).size).toBe(12);
  });

  it('carries the brand accents as the anchor hues', () => {
    // marigold, lime, cyan, violet, magenta
    for (const hue of [41, 76, 184, 252, 331]) {
      expect(PITCH_HUES).toContain(hue);
    }
  });
});

describe('wheelPosition — circle of fifths, not chromatic', () => {
  it('walks by fifths, so C G D A land next to each other', () => {
    expect(wheelPosition(0)).toBe(0); // C
    expect(wheelPosition(7)).toBe(1); // G
    expect(wheelPosition(2)).toBe(2); // D
    expect(wheelPosition(9)).toBe(3); // A
  });

  it('puts semitone neighbours far apart so they stay distinguishable', () => {
    // C and C# are one semitone apart but seven steps around the wheel.
    const distance = Math.abs(wheelPosition(0) - wheelPosition(1));
    expect(Math.min(distance, 12 - distance)).toBeGreaterThanOrEqual(5);
  });

  it('is a bijection over the twelve pitch classes', () => {
    const positions = Array.from({ length: 12 }, (_, pc) => wheelPosition(pc));
    expect(new Set(positions).size).toBe(12);
  });

  it('handles negative and out-of-range input', () => {
    expect(wheelPosition(-1)).toBe(wheelPosition(11));
    expect(wheelPosition(12)).toBe(wheelPosition(0));
  });
});

describe('parsePitchClass', () => {
  it.each([
    ['C', 0],
    ['C major', 0],
    ['C#', 1],
    ['C♯ minor', 1],
    ['Db', 1],
    ['D', 2],
    ['E-flat major', 3],
    ['Eb', 3],
    ['E', 4],
    ['F', 5],
    ['F#m', 6],
    ['G', 7],
    ['A-sharp', 10],
    ['Bb', 10],
    ['B', 11],
  ])('reads %s as pitch class %i', (name, pitchClass) => {
    expect(parsePitchClass(name)).toBe(pitchClass);
  });

  it.each([
    ['Cmaj7', 0],
    ['A7b9', 9],
    ['Dm7/G', 2],
    ['F#m7b5', 6],
    ['Bbsus4', 10],
    ['G13', 7],
  ])('reads the root out of the chord symbol %s', (chord, pitchClass) => {
    expect(parsePitchClass(chord)).toBe(pitchClass);
  });

  it('is case-insensitive about the letter', () => {
    expect(parsePitchClass('c minor')).toBe(0);
    expect(parsePitchClass('bb')).toBe(10);
  });

  it.each([['', 'empty'], ['   ', 'whitespace'], ['H', 'not a note letter'], ['unknown', 'prose']])(
    'returns null for %s (%s)',
    (input) => {
      expect(parsePitchClass(input)).toBeNull();
    },
  );

  it('returns null rather than guessing for null or undefined', () => {
    expect(parsePitchClass(null)).toBeNull();
    expect(parsePitchClass(undefined)).toBeNull();
  });

  it('wraps around the octave rather than going out of range', () => {
    expect(parsePitchClass('Cb')).toBe(11);
    expect(parsePitchClass('B#')).toBe(0);
  });
});

describe('hueForName', () => {
  it('gives enharmonics the same hue — they are the same pitch class', () => {
    expect(hueForName('C#')).toBe(hueForName('Db'));
    expect(hueForName('A#')).toBe(hueForName('Bb'));
  });

  it('gives a chord and its key the same hue when the root matches', () => {
    expect(hueForName('Cmaj7')).toBe(hueForName('C major'));
  });

  it('returns null for a name it cannot read, so it goes uncoloured', () => {
    expect(hueForName('N.C.')).toBeNull();
    expect(hueForName('')).toBeNull();
  });
});

describe('hueStyle', () => {
  it('sets the custom property the CSS reads', () => {
    expect(hueStyle(184)).toEqual({ '--hue': '184' });
  });

  it('rounds fractional hues', () => {
    expect(hueStyle(183.6)).toEqual({ '--hue': '184' });
  });

  it('emits nothing for an unknown hue, leaving the inherited accent alone', () => {
    expect(hueStyle(null)).toEqual({});
    expect(hueStyle(undefined)).toEqual({});
  });
});
