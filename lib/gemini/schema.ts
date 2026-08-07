import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

/**
 * Single source of truth for the analysis payload.
 *
 * Two gates, deliberately:
 *  - `analysisResponseSchema` is handed to Gemini as `responseSchema`, which
 *    constrains decoding so the JSON *shape* is guaranteed.
 *  - `AnalysisResultSchema` (zod) re-validates on our side. A response can
 *    satisfy the wire schema and still be musically nonsense — empty ABC,
 *    a tempo of 0, a confidence of 4.2 — so we check ranges and emptiness too.
 */

const trimmed = z.string().trim();
const nonEmpty = trimmed.min(1);

/** Bar numbers are 1-indexed and integral; the model likes to emit floats. */
const barNumber = z.coerce.number().int().min(1);

/** 0–1 inclusive. The model sometimes emits percentages; rescale those. */
const confidence = z.coerce
  .number()
  .transform((n) => (n > 1 && n <= 100 ? n / 100 : n))
  .pipe(z.number().min(0).max(1));

/** Something a human could play. Rejects 0 and absurd values outright. */
const bpm = z.coerce.number().min(20).max(320);

export const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

export const TrackSchema = z.object({
  title: nonEmpty,
  artist: nonEmpty,
  genre: nonEmpty,
  eraOrStyle: nonEmpty,
});

export const ModulationSchema = z.object({
  toKey: nonEmpty,
  atBar: barNumber,
  note: trimmed,
});

export const MusicalSchema = z.object({
  key: nonEmpty,
  keyConfidence: confidence,
  mode: nonEmpty,
  modulations: z.array(ModulationSchema),
  tempoBpm: bpm,
  timeSignature: nonEmpty,
  meterChanges: z.array(nonEmpty),
  feel: trimmed,
});

export const FormSectionSchema = z.object({
  section: nonEmpty,
  startTime: nonEmpty,
  endTime: nonEmpty,
  bars: z.coerce.number().int().min(0),
  description: trimmed,
});

export const HarmonySchema = z.object({
  section: nonEmpty,
  chordSymbols: z.array(nonEmpty),
  romanNumerals: z.array(nonEmpty),
});

export const MelodySchema = z.object({
  range: trimmed,
  contour: trimmed,
  motifs: z.array(nonEmpty),
  phraseLength: trimmed,
});

/**
 * ABC bodies are checked structurally here — headers present, a treble and a
 * bass voice, at least one bar line. Real parse validation happens in
 * lib/abc/validate.ts against abcjs in the browser (Phase 2).
 */
export const ScoreSchema = z.object({
  abc: nonEmpty
    .refine((s) => /^X:/m.test(s), { message: 'ABC is missing its X: header' })
    .refine((s) => /^K:/m.test(s), { message: 'ABC is missing its K: header' })
    .refine((s) => /^V:\s*1/m.test(s) && /^V:\s*2/m.test(s), {
      message: 'ABC must declare two voices (V:1 treble, V:2 bass)',
    })
    .refine((s) => s.includes('|'), { message: 'ABC has no bar lines' }),
  suggestedTempo: bpm,
  difficultyNote: nonEmpty,
  keyChanged: z.coerce.boolean(),
});

export const ScoresSchema = z.object({
  easy: ScoreSchema,
  medium: ScoreSchema,
  hard: ScoreSchema,
});

export const AnalysisResultSchema = z.object({
  track: TrackSchema,
  musical: MusicalSchema,
  form: z.array(FormSectionSchema).min(1),
  harmony: z.array(HarmonySchema),
  instrumentation: z.array(nonEmpty),
  texture: trimmed,
  melody: MelodySchema,
  productionNotes: z.array(nonEmpty),
  /** The honest card. Always populated — that is the point of it. */
  arrangementDecisions: z.array(nonEmpty).min(1),
  transcriptionConfidence: confidence,
  confidenceReason: nonEmpty,
  scores: ScoresSchema,
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type ScoreLevel = z.infer<typeof ScoreSchema>;
export type FormSection = z.infer<typeof FormSectionSchema>;

/**
 * The analysis minus the scores. Emitted first so the panel can populate
 * while the arrangements are still being written.
 */
export const AnalysisOnlySchema = AnalysisResultSchema.omit({ scores: true });
export type AnalysisOnly = z.infer<typeof AnalysisOnlySchema>;

// ---------------------------------------------------------------------------
// Gemini wire schemas
// ---------------------------------------------------------------------------

const str = (description: string): Schema => ({ type: Type.STRING, description });
const strArray = (description: string): Schema => ({
  type: Type.ARRAY,
  description,
  items: { type: Type.STRING },
});

const trackWire: Schema = {
  type: Type.OBJECT,
  properties: {
    title: str('Song title as released.'),
    artist: str('Performing artist or band.'),
    genre: str('Primary genre.'),
    eraOrStyle: str('Era or stylistic lineage, e.g. "late-90s neo-soul".'),
  },
  required: ['title', 'artist', 'genre', 'eraOrStyle'],
  propertyOrdering: ['title', 'artist', 'genre', 'eraOrStyle'],
};

const musicalWire: Schema = {
  type: Type.OBJECT,
  properties: {
    key: str('Tonic and quality, e.g. "E-flat major".'),
    keyConfidence: {
      type: Type.NUMBER,
      description: 'Confidence in the key reading, 0 to 1.',
      minimum: 0,
      maximum: 1,
    },
    mode: str('Modal character, e.g. "Aeolian", "Dorian", "major".'),
    modulations: {
      type: Type.ARRAY,
      description: 'Key changes in order. Empty array if the track never modulates.',
      items: {
        type: Type.OBJECT,
        properties: {
          toKey: str('Key moved to.'),
          atBar: { type: Type.INTEGER, description: 'Bar number of the change, 1-indexed.' },
          note: str('How the modulation is prepared, one clause.'),
        },
        required: ['toKey', 'atBar', 'note'],
        propertyOrdering: ['toKey', 'atBar', 'note'],
      },
    },
    tempoBpm: { type: Type.NUMBER, description: 'Tempo in beats per minute.' },
    timeSignature: str('Primary time signature, e.g. "4/4".'),
    meterChanges: strArray('Meter changes with bar numbers. Empty array if none.'),
    feel: str('Rhythmic feel — straight, swung, halftime, shuffle, and the groove.'),
  },
  required: [
    'key',
    'keyConfidence',
    'mode',
    'modulations',
    'tempoBpm',
    'timeSignature',
    'meterChanges',
    'feel',
  ],
  propertyOrdering: [
    'key',
    'keyConfidence',
    'mode',
    'modulations',
    'tempoBpm',
    'timeSignature',
    'meterChanges',
    'feel',
  ],
};

const formWire: Schema = {
  type: Type.ARRAY,
  description: 'Sections in playing order, covering the whole track.',
  items: {
    type: Type.OBJECT,
    properties: {
      section: str('Section name, e.g. "Verse 1", "Pre-chorus", "Bridge".'),
      startTime: str('Start timestamp as m:ss.'),
      endTime: str('End timestamp as m:ss.'),
      bars: { type: Type.INTEGER, description: 'Length of the section in bars.' },
      description: str('What changes here, one sentence.'),
    },
    required: ['section', 'startTime', 'endTime', 'bars', 'description'],
    propertyOrdering: ['section', 'startTime', 'endTime', 'bars', 'description'],
  },
};

const harmonyWire: Schema = {
  type: Type.ARRAY,
  description: 'Chord progression per section. Section names must match the form list.',
  items: {
    type: Type.OBJECT,
    properties: {
      section: str('Section name, matching one in the form list.'),
      chordSymbols: strArray('Chords in order, e.g. ["Cmaj7", "A7b9", "Dm7", "G7"].'),
      romanNumerals: strArray('The same progression in Roman numerals, aligned index for index.'),
    },
    required: ['section', 'chordSymbols', 'romanNumerals'],
    propertyOrdering: ['section', 'chordSymbols', 'romanNumerals'],
  },
};

const melodyWire: Schema = {
  type: Type.OBJECT,
  properties: {
    range: str('Melodic range as pitch names, e.g. "G3 to D5".'),
    contour: str('Shape of the melodic line.'),
    motifs: strArray('Recurring motifs, described briefly.'),
    phraseLength: str('Typical phrase length in bars.'),
  },
  required: ['range', 'contour', 'motifs', 'phraseLength'],
  propertyOrdering: ['range', 'contour', 'motifs', 'phraseLength'],
};

const scoreWire = (level: string, guidance: string): Schema => ({
  type: Type.OBJECT,
  description: `${level} arrangement. ${guidance}`,
  properties: {
    abc: str(
      'The complete arrangement as a single ABC 2.1 string with escaped newlines. ' +
        'No markdown fences, no commentary.',
    ),
    suggestedTempo: { type: Type.NUMBER, description: 'Performance tempo in BPM for this level.' },
    difficultyNote: str('One sentence on what makes this level playable at its grade.'),
    keyChanged: {
      type: Type.BOOLEAN,
      description: 'True if this level was transposed away from the original key.',
    },
  },
  required: ['abc', 'suggestedTempo', 'difficultyNote', 'keyChanged'],
  propertyOrdering: ['abc', 'suggestedTempo', 'difficultyNote', 'keyChanged'],
});

const scoresWire: Schema = {
  type: Type.OBJECT,
  properties: {
    easy: scoreWire(
      'Easy',
      'Melody in the right hand, root-position or single-note left hand, at most two accidentals in the key.',
    ),
    medium: scoreWire(
      'Medium',
      'Original key, melody harmonised in thirds and sixths, broken-chord left hand.',
    ),
    hard: scoreWire(
      'Hard',
      'Countermelodies and inner voices, extended harmony, arpeggiated figuration.',
    ),
  },
  required: ['easy', 'medium', 'hard'],
  propertyOrdering: ['easy', 'medium', 'hard'],
};

/** Full payload: analysis + all three arrangements. */
export const analysisResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    track: trackWire,
    musical: musicalWire,
    form: formWire,
    harmony: harmonyWire,
    instrumentation: strArray('Instruments audible in the recording, most prominent first.'),
    texture: str('Textural description — homophonic, contrapuntal, layered, and how it is voiced.'),
    melody: melodyWire,
    productionNotes: strArray('Production and engineering observations, one per entry.'),
    arrangementDecisions: strArray(
      'What was condensed, voiced down, or cut to fit two hands. Be specific and honest.',
    ),
    transcriptionConfidence: {
      type: Type.NUMBER,
      description: 'Confidence in the transcription overall, 0 to 1.',
      minimum: 0,
      maximum: 1,
    },
    confidenceReason: str('One line explaining that confidence figure.'),
    scores: scoresWire,
  },
  required: [
    'track',
    'musical',
    'form',
    'harmony',
    'instrumentation',
    'texture',
    'melody',
    'productionNotes',
    'arrangementDecisions',
    'transcriptionConfidence',
    'confidenceReason',
    'scores',
  ],
  propertyOrdering: [
    'track',
    'musical',
    'form',
    'harmony',
    'instrumentation',
    'texture',
    'melody',
    'productionNotes',
    'arrangementDecisions',
    'transcriptionConfidence',
    'confidenceReason',
    'scores',
  ],
};

/** Repair route: corrected ABC only, nothing else. */
export const RepairResultSchema = z.object({
  abc: nonEmpty,
  fixNote: trimmed,
});

export type RepairResult = z.infer<typeof RepairResultSchema>;

export const repairResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    abc: str('The corrected ABC 2.1 document, complete and self-contained.'),
    fixNote: str('One clause naming what was wrong.'),
  },
  required: ['abc', 'fixNote'],
  propertyOrdering: ['abc', 'fixNote'],
};
