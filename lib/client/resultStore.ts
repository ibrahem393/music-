import { AnalysisResultSchema, type AnalysisResult } from '@/lib/gemini/schema';

/**
 * Hands a finished analysis from the input page to the work page.
 *
 * sessionStorage, deliberately: an analysis is expensive enough that a reload
 * should not throw it away, but it belongs to the tab that ran it, not to the
 * browser forever. There is no server-side store yet, so a /work/<id> URL is
 * not shareable — the work page says so plainly rather than showing a spinner
 * that never resolves.
 *
 * Anything read back out goes through the same zod gate as the model's
 * original response. Storage is user-writable and a stale entry from an older
 * shape would otherwise crash the page.
 */

const PREFIX = 'cadence:result:';

export type StoredResult = { id: string; accuracy: 'fast' | 'accurate'; result: AnalysisResult };

export function saveResult(entry: StoredResult): void {
  try {
    sessionStorage.setItem(
      `${PREFIX}${entry.id}`,
      JSON.stringify({ accuracy: entry.accuracy, result: entry.result }),
    );
  } catch {
    // Private mode or a full quota. The work page falls back to its empty
    // state, which tells the reader to run the analysis again.
  }
}

export function loadResult(id: string): StoredResult | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(`${PREFIX}${id}`);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { accuracy?: unknown; result?: unknown };

  const result = AnalysisResultSchema.safeParse(record.result);
  if (!result.success) return null;

  const accuracy = record.accuracy === 'accurate' ? 'accurate' : 'fast';
  return { id, accuracy, result: result.data };
}
