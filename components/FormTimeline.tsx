'use client';

import { useMemo, type CSSProperties } from 'react';

import { hueForName, hueStyle } from '@/components/PitchColor';
import { sectionWeights, type SectionSpan } from '@/lib/form';
import { formatTimestamp } from '@/lib/time';

/**
 * The horizontal form map: every section, its timestamp and its bar count,
 * clickable to move the score.
 *
 * Each tick is tinted by its section's harmonic centre — the root of the first
 * chord the analysis gives for that section — so the shape of the harmony is
 * legible before you read a word of it. Sections whose harmony we do not have
 * stay uncoloured rather than borrowing a hue they have not earned.
 *
 * Sections are real buttons in a list rather than divs with click handlers, so
 * the whole timeline is reachable by keyboard and announced properly.
 */

export type FormTimelineProps = {
  spans: readonly SectionSpan[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  loopingIndex: number | null;
  onToggleLoop: (index: number) => void;
  /** False when the arrangement's bar count differs from the form's. */
  exactMapping: boolean;
  /** Section name -> first chord symbol, for the harmonic tint. */
  sectionRoots?: Record<string, string | undefined>;
};

export default function FormTimeline({
  spans,
  activeIndex,
  onSelect,
  loopingIndex,
  onToggleLoop,
  exactMapping,
  sectionRoots = {},
}: FormTimelineProps) {
  const weights = useMemo(() => sectionWeights(spans), [spans]);
  const total = useMemo(() => weights.reduce((a, b) => a + b, 0), [weights]);

  if (spans.length === 0) return null;

  return (
    <section aria-labelledby="form-heading" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="form-heading"
          className="font-mono text-[0.65rem] tracking-widest uppercase"
          style={{ color: 'var(--ink-faint)' }}
        >
          Form
        </h3>
      </div>

      <ol className="cadence-draw flex w-full gap-1 overflow-x-auto pb-1" role="list">
        {spans.map((span, index) => {
          const weight = weights[index] ?? 1;
          const share = total > 0 ? (weight / total) * 100 : 100 / spans.length;
          const active = index === activeIndex;
          const looping = index === loopingIndex;
          const hue = hueForName(sectionRoots[span.section]);

          return (
            <li
              key={`${span.section}-${index}`}
              style={
                {
                  flexGrow: share,
                  flexBasis: 0,
                  '--section-index': String(index),
                  ...hueStyle(hue),
                } as CSSProperties
              }
              className="min-w-18 shrink-0"
            >
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={active ? 'true' : undefined}
                className="flex w-full flex-col items-start gap-0.5 rounded-md border px-1.5 py-2 text-left transition-colors"
                style={{
                  borderColor: active
                    ? 'hsl(var(--hue) var(--fill-s) var(--fill-l))'
                    : hue === null
                      ? 'var(--line)'
                      : 'hsl(var(--hue) var(--edge-s) var(--edge-l))',
                  background: active
                    ? 'hsl(var(--hue) var(--wash-s) var(--wash-l))'
                    : 'transparent',
                }}
              >
                <span
                  aria-hidden="true"
                  className="mb-1 h-1 w-full rounded-full"
                  style={{
                    background:
                      hue === null
                        ? 'var(--line-strong)'
                        : 'hsl(var(--hue) var(--fill-s) var(--fill-l))',
                    opacity: active ? 1 : 0.65,
                  }}
                />
                <span className="w-full truncate text-xs font-semibold">{span.section}</span>
                <span
                  className="font-mono text-[0.65rem] tabular-nums"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  {span.startSeconds !== null ? formatTimestamp(span.startSeconds) : '—'}
                </span>
                {span.bars > 0 && (
                  <span
                    className="font-mono text-[0.65rem] tabular-nums"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    {span.bars} bars
                  </span>
                )}
              </button>

              {active && (
                <button
                  type="button"
                  onClick={() => onToggleLoop(index)}
                  aria-pressed={looping}
                  className={`mt-1 w-full rounded-md border px-2 py-1 text-[0.65rem] ${looping ? 'cadence-solid' : ''}`}
                  style={looping ? undefined : { borderColor: 'var(--line)', color: 'var(--ink-soft)' }}
                >
                  {looping ? 'Looping' : 'Loop'}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
        {exactMapping
          ? 'Select a section to jump the score there.'
          : 'Select a section to jump the score there — the arrangement condenses the record, so the landing bar is approximate.'}
      </p>

      {activeIndex !== null && spans[activeIndex]?.description && (
        <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
          {spans[activeIndex]?.description}
        </p>
      )}
    </section>
  );
}
