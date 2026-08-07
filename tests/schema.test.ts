import { describe, expect, it } from 'vitest';

import {
  AnalysisOnlySchema,
  AnalysisResultSchema,
  ScoreSchema,
  analysisResponseSchema,
} from '@/lib/gemini/schema';

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
  '[V:1] !mf! CDEF GABc | cBAG FEDC |]',
  '[V:2] C,2 G,2 C,2 G,2 | C,2 G,2 C,4 |]',
].join('\n');

function baseResult() {
  return {
    track: { title: 'Test', artist: 'Nobody', genre: 'Pop', eraOrStyle: 'Modern' },
    musical: {
      key: 'C major',
      keyConfidence: 0.9,
      mode: 'Ionian',
      modulations: [] as { toKey: string; atBar: number; note: string }[],
      tempoBpm: 96,
      timeSignature: '4/4',
      meterChanges: [],
      feel: 'Straight eights',
    },
    form: [
      {
        section: 'Verse 1',
        startTime: '0:00',
        endTime: '0:30',
        bars: 16,
        description: 'Piano and voice.',
      },
    ],
    harmony: [{ section: 'Verse 1', chordSymbols: ['C', 'Am'], romanNumerals: ['I', 'vi'] }],
    instrumentation: ['Piano', 'Voice'],
    texture: 'Homophonic',
    melody: { range: 'C4 to G5', contour: 'Arch', motifs: ['Rising fourth'], phraseLength: '4 bars' },
    productionNotes: ['Close-miked piano.'],
    arrangementDecisions: ['Strings condensed into the left hand.'],
    transcriptionConfidence: 0.8,
    confidenceReason: 'Clear mix, unambiguous harmony.',
    scores: {
      easy: { abc: VALID_ABC, suggestedTempo: 80, difficultyNote: 'Single-note melody.', keyChanged: false },
      medium: { abc: VALID_ABC, suggestedTempo: 96, difficultyNote: 'Broken chords.', keyChanged: false },
      hard: { abc: VALID_ABC, suggestedTempo: 96, difficultyNote: 'Inner voices.', keyChanged: false },
    },
  };
}

describe('AnalysisResultSchema', () => {
  it('accepts a well-formed result', () => {
    const parsed = AnalysisResultSchema.safeParse(baseResult());
    expect(parsed.success).toBe(true);
  });

  it('rescales confidence expressed as a percentage', () => {
    const input = baseResult();
    input.transcriptionConfidence = 85;
    const parsed = AnalysisResultSchema.parse(input);
    expect(parsed.transcriptionConfidence).toBeCloseTo(0.85);
  });

  it('rejects confidence outside 0 to 1 after rescaling', () => {
    const input = baseResult();
    input.transcriptionConfidence = 140;
    expect(AnalysisResultSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a tempo of zero', () => {
    const input = baseResult();
    input.musical.tempoBpm = 0;
    expect(AnalysisResultSchema.safeParse(input).success).toBe(false);
  });

  it('requires at least one form section', () => {
    const input = baseResult();
    input.form = [];
    expect(AnalysisResultSchema.safeParse(input).success).toBe(false);
  });

  it('requires arrangementDecisions to be populated — it is the honest card', () => {
    const input = baseResult();
    input.arrangementDecisions = [];
    expect(AnalysisResultSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a whitespace-only confidenceReason', () => {
    const input = baseResult();
    input.confidenceReason = '   ';
    expect(AnalysisResultSchema.safeParse(input).success).toBe(false);
  });

  it('requires all three difficulty levels', () => {
    const input: Record<string, unknown> = baseResult();
    const scores = input.scores as Record<string, unknown>;
    delete scores.hard;
    expect(AnalysisResultSchema.safeParse(input).success).toBe(false);
  });

  it('coerces integral bar numbers from floats', () => {
    const input = baseResult();
    input.musical.modulations = [{ toKey: 'A minor', atBar: 33, note: 'Pivot on vi.' }];
    const parsed = AnalysisResultSchema.parse(input);
    expect(parsed.musical.modulations[0]?.atBar).toBe(33);
  });

  it('trims incidental whitespace on strings', () => {
    const input = baseResult();
    input.track.title = '  Test  ';
    expect(AnalysisResultSchema.parse(input).track.title).toBe('Test');
  });
});

describe('ScoreSchema', () => {
  it('accepts a two-voice piano system', () => {
    expect(
      ScoreSchema.safeParse({
        abc: VALID_ABC,
        suggestedTempo: 96,
        difficultyNote: 'Fine.',
        keyChanged: false,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['missing X: header', VALID_ABC.replace('X:1\n', '')],
    ['missing K: header', VALID_ABC.replace('K:C\n', '')],
    ['only one voice', VALID_ABC.replace('V:2 clef=bass\n', '')],
    ['no bar lines', VALID_ABC.replaceAll('|', '')],
  ])('rejects ABC with %s', (_label, abc) => {
    expect(
      ScoreSchema.safeParse({ abc, suggestedTempo: 96, difficultyNote: 'Fine.', keyChanged: false })
        .success,
    ).toBe(false);
  });

  it('rejects an empty abc string', () => {
    expect(
      ScoreSchema.safeParse({ abc: '', suggestedTempo: 96, difficultyNote: 'Fine.', keyChanged: false })
        .success,
    ).toBe(false);
  });
});

describe('AnalysisOnlySchema', () => {
  it('validates the analysis without any scores present', () => {
    const { scores: _scores, ...rest } = baseResult();
    expect(AnalysisOnlySchema.safeParse(rest).success).toBe(true);
  });
});

describe('analysisResponseSchema', () => {
  it('declares every field the zod schema requires', () => {
    const zodKeys = Object.keys(AnalysisResultSchema.shape).sort();
    expect([...(analysisResponseSchema.required ?? [])].sort()).toEqual(zodKeys);
  });

  it('orders scores last so the analysis streams first', () => {
    const ordering = analysisResponseSchema.propertyOrdering ?? [];
    expect(ordering.at(-1)).toBe('scores');
  });

  it('declares all three difficulty levels on the wire', () => {
    expect(analysisResponseSchema.properties?.scores?.required).toEqual(['easy', 'medium', 'hard']);
  });
});
