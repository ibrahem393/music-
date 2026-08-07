'use client';

import { useMemo } from 'react';

import { sectionWeights, type SectionSpan } from '@/lib/form';
import { formatTimestamp } from '@/lib/time';

/**
 * The horizontal form map: every section, its timestamp and its bar count,
 * clickable to move the score.
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
};

export default function FormTimeline({
  spans,
  activeIndex,
  onSelect,
  loopingIndex,
  onToggleLoop,
  exactMapping,
}: FormTimelineProps) {
  const weights = useMemo(() => sectionWeights(spans), [spans]);
  const total = useMemo(() => weights.reduce((a, b) => a + b, 0), [weights]);

  if (spans.length === 0) return null;

  return (
    <section aria-labelledby="form-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="form-heading" className="text-sm font-semibold">
          Form
        </h3>
        <p className="text-xs text-neutral-500">
          {exactMapping
            ? 'Select a section to jump the score there.'
            : 'Select a section to jump the score there — the arrangement condenses the record, so the landing bar is approximate.'}
        </p>
      </div>

      <ol className="flex w-full gap-1 overflow-x-auto" role="list">
        {spans.map((span, index) => {
          const weight = weights[index] ?? 1;
          const share = total > 0 ? (weight / total) * 100 : 100 / spans.length;
          const active = index === activeIndex;
          const looping = index === loopingIndex;

          return (
            <li
              key={`${span.section}-${index}`}
              style={{ flexGrow: share, flexBasis: 0 }}
              className="min-w-24 shrink-0"
            >
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={active ? 'true' : undefined}
                className={[
                  'flex w-full flex-col items-start gap-0.5 rounded border p-2 text-left',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600',
                  active ? 'border-violet-700 bg-violet-50' : 'border-neutral-300 hover:bg-neutral-50',
                ].join(' ')}
              >
                <span className="w-full truncate text-xs font-medium">{span.section}</span>
                <span className="font-mono text-[0.65rem] text-neutral-600 tabular-nums">
                  {span.startSeconds !== null ? formatTimestamp(span.startSeconds) : '—'}
                </span>
                {span.bars > 0 && (
                  <span className="font-mono text-[0.65rem] text-neutral-500 tabular-nums">
                    {span.bars} bars
                  </span>
                )}
              </button>

              {active && (
                <button
                  type="button"
                  onClick={() => onToggleLoop(index)}
                  aria-pressed={looping}
                  className={[
                    'mt-1 w-full rounded border px-2 py-1 text-[0.65rem]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600',
                    looping ? 'border-violet-700 bg-violet-700 text-white' : 'border-neutral-300',
                  ].join(' ')}
                >
                  {looping ? 'Looping' : 'Loop'}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {activeIndex !== null && spans[activeIndex]?.description && (
        <p className="text-xs text-neutral-600">{spans[activeIndex]?.description}</p>
      )}
    </section>
  );
}
