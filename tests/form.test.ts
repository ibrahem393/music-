import { describe, expect, it } from 'vitest';

import {
  mapFormBarToScore,
  mappingIsExact,
  sectionSpans,
  sectionWeights,
  totalFormBars,
} from '@/lib/form';
import { formatTimestamp, parseTimestamp } from '@/lib/time';
import type { FormSection } from '@/lib/gemini/schema';

const section = (
  name: string,
  startTime: string,
  endTime: string,
  bars: number,
  description = '',
): FormSection => ({ section: name, startTime, endTime, bars, description });

const FORM: FormSection[] = [
  section('Intro', '0:00', '0:16', 8, 'Piano alone.'),
  section('Verse 1', '0:16', '0:48', 16),
  section('Chorus', '0:48', '1:20', 16),
];

describe('parseTimestamp', () => {
  it.each([
    ['0:00', 0],
    ['0:30', 30],
    ['1:23', 83],
    ['10:05', 605],
    ['1:02:03', 3723],
    [' 2:00 ', 120],
  ])('reads %s as %i seconds', (input, seconds) => {
    expect(parseTimestamp(input)).toBe(seconds);
  });

  it.each([['', 'empty'], ['abc', 'prose'], ['90', 'bare number'], ['1:2:3:4', 'too many parts'], ['-1:00', 'negative']])(
    'rejects %s (%s)',
    (input) => {
      expect(parseTimestamp(input)).toBeNull();
    },
  );
});

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [605, '10:05'],
    [3723, '1:02:03'],
  ])('renders %i seconds as %s', (seconds, text) => {
    expect(formatTimestamp(seconds)).toBe(text);
  });

  it('does not produce a negative clock', () => {
    expect(formatTimestamp(-10)).toBe('0:00');
    expect(formatTimestamp(Number.NaN)).toBe('0:00');
  });
});

describe('sectionSpans', () => {
  it('accumulates bar numbers across sections', () => {
    const spans = sectionSpans(FORM);
    expect(spans.map((s) => [s.startBar, s.endBar])).toEqual([
      [0, 8],
      [8, 24],
      [24, 40],
    ]);
  });

  it('carries timestamps and durations through', () => {
    const spans = sectionSpans(FORM);
    expect(spans[0]?.startSeconds).toBe(0);
    expect(spans[0]?.durationSeconds).toBe(16);
    expect(spans[2]?.durationSeconds).toBe(32);
  });

  it('survives a section whose timestamps did not parse', () => {
    const spans = sectionSpans([section('Odd', 'later', 'even later', 8)]);
    expect(spans[0]?.startSeconds).toBeNull();
    expect(spans[0]?.durationSeconds).toBeNull();
    expect(spans[0]?.bars).toBe(8);
  });

  it('treats an end before the start as no duration rather than a negative one', () => {
    const spans = sectionSpans([section('Backwards', '2:00', '1:00', 8)]);
    expect(spans[0]?.durationSeconds).toBeNull();
  });

  it('totals the form bars', () => {
    expect(totalFormBars(sectionSpans(FORM))).toBe(40);
  });

  it('returns nothing for an empty form', () => {
    expect(sectionSpans([])).toEqual([]);
    expect(totalFormBars([])).toBe(0);
  });
});

describe('sectionWeights', () => {
  it('prefers real durations, because that is what a listener hears', () => {
    expect(sectionWeights(sectionSpans(FORM))).toEqual([16, 32, 32]);
  });

  it('falls back to bar counts when a timestamp did not parse', () => {
    const spans = sectionSpans([
      section('A', '0:00', '0:16', 8),
      section('B', 'unknown', 'unknown', 16),
    ]);
    expect(sectionWeights(spans)).toEqual([8, 16]);
  });

  it('falls back to an even split when neither is usable', () => {
    const spans = sectionSpans([section('A', 'x', 'y', 0), section('B', 'x', 'y', 0)]);
    expect(sectionWeights(spans)).toEqual([1, 1]);
  });
});

describe('mapFormBarToScore', () => {
  it('is the identity when the arrangement matches the form', () => {
    for (const bar of [0, 8, 24, 39]) expect(mapFormBarToScore(bar, 40, 40)).toBe(bar);
  });

  it('scales proportionally when the arrangement is shorter', () => {
    // The form runs 40 bars; the arrangement condensed it to 20.
    expect(mapFormBarToScore(0, 40, 20)).toBe(0);
    expect(mapFormBarToScore(20, 40, 20)).toBe(10);
    expect(mapFormBarToScore(40, 40, 20)).toBe(19);
  });

  it('scales proportionally when the arrangement is longer', () => {
    expect(mapFormBarToScore(10, 20, 40)).toBe(20);
  });

  it('never points past the end of the score', () => {
    for (const bar of [40, 100, 10_000]) {
      expect(mapFormBarToScore(bar, 40, 16)).toBeLessThanOrEqual(15);
    }
  });

  it('never points before the start', () => {
    expect(mapFormBarToScore(-5, 40, 16)).toBe(0);
  });

  it('returns bar zero rather than NaN when either count is missing', () => {
    expect(mapFormBarToScore(8, 0, 16)).toBe(0);
    expect(mapFormBarToScore(8, 40, 0)).toBe(0);
  });
});

describe('mappingIsExact', () => {
  it('is true only when the counts agree', () => {
    expect(mappingIsExact(40, 40)).toBe(true);
    expect(mappingIsExact(40, 20)).toBe(false);
    expect(mappingIsExact(0, 0)).toBe(false);
  });
});
