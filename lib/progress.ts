import type { AnalysisOnly, AnalysisResult } from '@/lib/gemini/schema';
import type { GeminiErrorKind } from '@/lib/gemini/client';

/**
 * The newline-delimited JSON protocol spoken by /api/analyze.
 *
 * One JSON object per line, no framing beyond the newline. The client reads it
 * with response.body.getReader() and splits on '\n'.
 */

export const STAGES = ['fetching', 'listening', 'mapping', 'arranging'] as const;
export type StageId = (typeof STAGES)[number];

/** Stage copy names real work, per the brief. */
export const STAGE_LABEL: Record<StageId, string> = {
  fetching: 'Fetching the video',
  listening: 'Listening for key and tempo',
  mapping: 'Mapping the form',
  arranging: 'Writing three arrangements',
};

export type ProgressEvent =
  | { type: 'stage'; stage: StageId; label: string; elapsedMs: number }
  | { type: 'heartbeat'; elapsedMs: number }
  /** The analysis, emitted before the arrangements finish. */
  | { type: 'analysis'; analysis: AnalysisOnly; elapsedMs: number }
  | { type: 'result'; id: string; result: AnalysisResult; elapsedMs: number }
  | { type: 'error'; kind: GeminiErrorKind | 'bad-request'; message: string; detail?: string };

export function encodeEvent(event: ProgressEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Splits an NDJSON byte stream into events. Tolerates chunk boundaries falling
 * mid-line, and skips blank lines.
 */
export function createEventParser(): (chunk: string) => ProgressEvent[] {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    const events: ProgressEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        events.push(JSON.parse(trimmed) as ProgressEvent);
      } catch {
        // A malformed line is not worth killing the run over; the terminal
        // 'result' or 'error' event is what the client actually needs.
      }
    }
    return events;
  };
}
