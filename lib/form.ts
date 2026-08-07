import type { FormSection } from '@/lib/gemini/schema';
import { parseTimestamp } from '@/lib/time';

/**
 * Turns the flat form list into spans the timeline can lay out and the score
 * can be scrolled by.
 *
 * Bar numbers here are 0-based and cumulative over the form, which describes
 * the *recording*. The arrangement is a condensation of that recording and can
 * legitimately have a different bar count, so mapping a form bar onto a score
 * bar is proportional rather than exact — see mapFormBarToScore.
 */

export type SectionSpan = {
  index: number;
  section: string;
  description: string;
  /** 0-based, cumulative over the form. */
  startBar: number;
  /** Exclusive. */
  endBar: number;
  bars: number;
  startSeconds: number | null;
  endSeconds: number | null;
  /** Seconds, when both timestamps parsed and are ordered sensibly. */
  durationSeconds: number | null;
};

export function sectionSpans(form: readonly FormSection[]): SectionSpan[] {
  let cursor = 0;
  return form.map((section, index) => {
    const bars = Number.isFinite(section.bars) && section.bars > 0 ? Math.round(section.bars) : 0;
    const startBar = cursor;
    cursor += bars;

    const startSeconds = parseTimestamp(section.startTime);
    const endSeconds = parseTimestamp(section.endTime);
    const durationSeconds =
      startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
        ? endSeconds - startSeconds
        : null;

    return {
      index,
      section: section.section,
      description: section.description,
      startBar,
      endBar: cursor,
      bars,
      startSeconds,
      endSeconds,
      durationSeconds,
    };
  });
}

export function totalFormBars(spans: readonly SectionSpan[]): number {
  return spans.reduce((sum, span) => sum + span.bars, 0);
}

/**
 * Widths for the timeline.
 *
 * Prefers real durations, because that is what a listener experiences. Falls
 * back to bar counts when the model's timestamps did not parse, and to equal
 * widths when neither is usable — a timeline with one section at 99% is worse
 * than an honest even split.
 */
export function sectionWeights(spans: readonly SectionSpan[]): number[] {
  if (spans.length === 0) return [];

  const durations = spans.map((s) => s.durationSeconds);
  if (durations.every((d): d is number => d !== null && d > 0)) return durations;

  const bars = spans.map((s) => s.bars);
  if (bars.every((b) => b > 0)) return bars;

  return spans.map(() => 1);
}

/**
 * Maps a bar in the form onto a bar in the rendered score.
 *
 * When the counts agree this is the identity. When they do not — the usual
 * case, since two hands cannot hold everything a full band plays — the
 * position is scaled proportionally. That is an approximation, and the
 * interface should not imply otherwise.
 */
export function mapFormBarToScore(formBar: number, formBars: number, scoreBars: number): number {
  if (scoreBars <= 0) return 0;
  if (formBars <= 0) return 0;

  const clampedForm = Math.max(0, Math.min(formBar, formBars));
  const scaled = formBars === scoreBars ? clampedForm : Math.round((clampedForm / formBars) * scoreBars);
  return Math.max(0, Math.min(scaled, scoreBars - 1));
}

/** True when the score's bar count matches the form's, so scrolling is exact. */
export function mappingIsExact(formBars: number, scoreBars: number): boolean {
  return formBars > 0 && formBars === scoreBars;
}
