import { validateAbc, type AbcProblem, type AbcProblemCode } from '@/lib/abc/validate';

/**
 * One arrangement's journey from model output to something we are willing to
 * put on a staff.
 *
 * Validate. If it fails, one repair call. Validate again. If it still fails the
 * level is marked unavailable and says why. There is no third attempt and no
 * rendering of a broken staff — a wrong score is worse than an absent one,
 * because a pianist will try to play it.
 */

export type ScoreState =
  | { status: 'validating' }
  | { status: 'repairing' }
  | {
      status: 'ready';
      abc: string;
      repaired: boolean;
      fixNote: string | null;
      bars: number;
    }
  | { status: 'unavailable'; reason: string; detail: string };

/** Plain-language cause, in the interface's voice. */
const REASON_FOR: Record<AbcProblemCode, string> = {
  threw: 'came back as notation the parser could not read',
  'no-tune': 'came back without a tune in it',
  'no-staves': 'came back with no staves',
  'wrong-staff-count': 'did not come back as a two-hand piano system',
  'inconsistent-staff-count': 'drops a hand partway through',
  'no-notes': 'came back with almost no notes in it',
  'too-few-bars': 'came back too short to be a real arrangement',
  'silent-staff': 'leaves one hand with nothing to play',
  'parser-warnings': 'came back with notation the parser rejected',
};

function reasonFrom(problems: AbcProblem[], level: string): string {
  const first = problems[0];
  const cause = first ? REASON_FOR[first.code] : 'could not be validated';
  return `The ${level} arrangement ${cause}, and a repair pass did not fix it. The other levels are unaffected.`;
}

export type RepairResponse = { abc: string; fixNote: string };

export type PrepareOptions = {
  level: string;
  accuracy: 'fast' | 'accurate';
  onState: (state: ScoreState) => void;
  signal?: AbortSignal;
};

export async function prepareScore(rawAbc: string, options: PrepareOptions): Promise<ScoreState> {
  const { level, onState } = options;

  onState({ status: 'validating' });
  const first = validateAbc(rawAbc);

  if (first.ok) {
    const state: ScoreState = {
      status: 'ready',
      abc: first.abc,
      repaired: false,
      fixNote: null,
      bars: first.stats.bars,
    };
    onState(state);
    return state;
  }

  onState({ status: 'repairing' });

  let repaired: RepairResponse;
  try {
    const response = await fetch('/api/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        abc: rawAbc,
        error: first.parserError,
        accuracy: options.accuracy,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const state: ScoreState = {
        status: 'unavailable',
        reason: reasonFrom(first.problems, level),
        detail: `Repair failed (${response.status}). ${first.parserError}`,
      };
      onState(state);
      return state;
    }

    repaired = (await response.json()) as RepairResponse;
  } catch (e: unknown) {
    if (options.signal?.aborted) return { status: 'validating' };
    const state: ScoreState = {
      status: 'unavailable',
      reason: reasonFrom(first.problems, level),
      detail: `Repair could not be reached: ${e instanceof Error ? e.message : String(e)}`,
    };
    onState(state);
    return state;
  }

  const second = validateAbc(repaired.abc);
  if (second.ok) {
    const state: ScoreState = {
      status: 'ready',
      abc: second.abc,
      repaired: true,
      fixNote: repaired.fixNote?.trim() || null,
      bars: second.stats.bars,
    };
    onState(state);
    return state;
  }

  const state: ScoreState = {
    status: 'unavailable',
    reason: reasonFrom(second.problems, level),
    detail: `Before repair:\n${first.parserError}\n\nAfter repair:\n${second.parserError}`,
  };
  onState(state);
  return state;
}
