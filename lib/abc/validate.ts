import abcjs, { type TuneObject, type VoiceItem, type VoiceItemNote } from 'abcjs';

/**
 * Headless parse-check for ABC.
 *
 * abcjs.parseOnly needs no DOM, so this runs in Node and in the browser alike
 * and is directly testable. That matters, because abcjs is extremely forgiving:
 * unbalanced brackets, a missing K: header and outright prose all parse without
 * throwing and without a single warning. "It did not throw" is nowhere near
 * enough to conclude a staff is worth rendering.
 *
 * So the real gate is structural — does this parse into a two-staff piano
 * system with both hands carrying music across at least MIN_BARS bars?
 */

/** The brief's floor: at least 16 bars of actual music per level. */
export const MIN_BARS = 16;

/** Below this a "score" is a fragment, whatever the bar count claims. */
const MIN_SOUNDING_NOTES = 24;

/** Each hand must carry this much before we call it a two-hand arrangement. */
const MIN_NOTES_PER_STAFF = 6;

export type AbcProblemCode =
  | 'threw'
  | 'no-tune'
  | 'no-staves'
  | 'wrong-staff-count'
  | 'inconsistent-staff-count'
  | 'no-notes'
  | 'too-few-bars'
  | 'silent-staff'
  | 'parser-warnings';

export type AbcProblem = { code: AbcProblemCode; message: string };

export type AbcStats = {
  staffCount: number;
  bars: number;
  soundingNotes: number;
  notesPerStaff: number[];
  warnings: string[];
};

export type AbcValidation =
  | { ok: true; abc: string; tune: TuneObject; stats: AbcStats }
  | {
      ok: false;
      problems: AbcProblem[];
      /** The message handed to /api/repair. Plain text, no markup. */
      parserError: string;
      stats: AbcStats | null;
    };

/**
 * responseMimeType makes fences unlikely, not impossible, and abcjs happily
 * parses right past them — leaving the fence in the download.
 */
export function stripFences(abc: string): string {
  const trimmed = abc.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

/** abcjs warnings carry inline HTML to underline the offending character. */
export function plainWarning(warning: string): string {
  return warning
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNote(item: VoiceItem): item is VoiceItemNote {
  return item.el_type === 'note';
}

/** Rests and spacers are not material. A staff of rests is a silent staff. */
function isSounding(item: VoiceItem): boolean {
  return isNote(item) && !item.rest && (item.pitches?.length ?? 0) > 0;
}

export function collectStats(tune: TuneObject): AbcStats {
  const staffCounts: number[] = [];
  const notesPerStaff: number[] = [];
  let bars = 0;
  let soundingNotes = 0;

  for (const line of tune.lines) {
    if (!line.staff) continue;
    staffCounts.push(line.staff.length);

    line.staff.forEach((staff, staffIndex) => {
      let staffNotes = 0;
      let staffBars = 0;

      for (const voice of staff.voices ?? []) {
        for (const item of voice) {
          if (item.el_type === 'bar') staffBars += 1;
          if (isSounding(item)) {
            staffNotes += 1;
            soundingNotes += 1;
          }
        }
      }

      notesPerStaff[staffIndex] = (notesPerStaff[staffIndex] ?? 0) + staffNotes;
      // Bars are counted from the top staff only; the others run in parallel.
      if (staffIndex === 0) bars += staffBars;
    });
  }

  return {
    staffCount: staffCounts.length > 0 ? Math.max(...staffCounts) : 0,
    bars,
    soundingNotes,
    notesPerStaff,
    warnings: (tune.warnings ?? []).map(plainWarning),
  };
}

export type ValidateOptions = {
  minBars?: number;
  /** Number of staves the arrangement must have. Two, for a piano system. */
  staves?: number;
};

export function validateAbc(input: string, options: ValidateOptions = {}): AbcValidation {
  const minBars = options.minBars ?? MIN_BARS;
  const expectedStaves = options.staves ?? 2;
  const abc = stripFences(input);

  let tune: TuneObject | undefined;
  try {
    tune = abcjs.parseOnly(abc)[0];
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      stats: null,
      problems: [{ code: 'threw', message: `The parser threw: ${message}` }],
      parserError: `The ABC could not be parsed at all. The parser threw: ${message}`,
    };
  }

  if (!tune) {
    return {
      ok: false,
      stats: null,
      problems: [{ code: 'no-tune', message: 'The parser found no tune in the document.' }],
      parserError: 'The ABC produced no tune. Check that the X: header is present and first.',
    };
  }

  const stats = collectStats(tune);
  const problems: AbcProblem[] = [];

  if (stats.warnings.length > 0) {
    problems.push({
      code: 'parser-warnings',
      message: `The parser reported ${stats.warnings.length} warning(s): ${stats.warnings.join(' | ')}`,
    });
  }

  if (stats.staffCount === 0) {
    problems.push({ code: 'no-staves', message: 'The document contains no staves.' });
  } else if (stats.staffCount !== expectedStaves) {
    problems.push({
      code: 'wrong-staff-count',
      message: `Expected ${expectedStaves} staves in a piano brace, found ${stats.staffCount}.`,
    });
  }

  const perLineStaffCounts = tune.lines.filter((l) => l.staff).map((l) => l.staff?.length ?? 0);
  if (new Set(perLineStaffCounts).size > 1) {
    problems.push({
      code: 'inconsistent-staff-count',
      message: `Staff count changes between systems (${perLineStaffCounts.join(', ')}). Every system needs both hands.`,
    });
  }

  if (stats.soundingNotes < MIN_SOUNDING_NOTES) {
    problems.push({
      code: 'no-notes',
      message: `Only ${stats.soundingNotes} sounding notes. An arrangement needs at least ${MIN_SOUNDING_NOTES}.`,
    });
  }

  if (stats.bars < minBars) {
    problems.push({
      code: 'too-few-bars',
      message: `Only ${stats.bars} bars. Each level needs at least ${minBars}.`,
    });
  }

  for (let i = 0; i < expectedStaves; i += 1) {
    const notes = stats.notesPerStaff[i] ?? 0;
    if (notes < MIN_NOTES_PER_STAFF) {
      problems.push({
        code: 'silent-staff',
        message: `Staff ${i + 1} (${i === 0 ? 'right hand' : 'left hand'}) carries only ${notes} notes. Both hands must play.`,
      });
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems, stats, parserError: describeProblems(problems) };
  }

  return { ok: true, abc, tune, stats };
}

/** The repair prompt gets a numbered list, not a blob. */
export function describeProblems(problems: AbcProblem[]): string {
  return problems.map((p, i) => `${i + 1}. [${p.code}] ${p.message}`).join('\n');
}
