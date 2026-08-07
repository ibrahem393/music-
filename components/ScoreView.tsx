'use client';

import abcjs, { type AbcVisualParams, type TuneObject } from 'abcjs';
import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';

/**
 * The staff.
 *
 * abcjs paints into a real DOM node, so this component owns a div and drives
 * abcjs imperatively inside an effect. It is only ever reached through
 * next/dynamic with ssr: false — abcjs touches `window` during layout and the
 * build dies otherwise.
 *
 * renderAbc is wrapped in try/catch even though the ABC has already been
 * through the headless validator: parsing and engraving are separate stages in
 * abcjs, and a document that parses can still throw during layout.
 */

export type ScoreViewHandle = {
  /** The engraved tune, for the synth and the exporters. */
  tune: () => TuneObject | null;
  /** Scrolls a bar into view. Used by the form timeline in Phase 3. */
  scrollToBar: (bar: number) => void;
  container: () => HTMLDivElement | null;
};

export type ScoreViewProps = {
  abc: string;
  /** −6 to +6. Applied visually; downloads transpose the source instead. */
  visualTranspose?: number;
  onTune?: (tune: TuneObject) => void;
  onRenderError?: (message: string) => void;
  ref?: RefObject<ScoreViewHandle | null>;
  /** Print rendering drops interactive affordances. */
  print?: boolean;
};

export default function ScoreView({
  abc,
  visualTranspose = 0,
  onTune,
  onRenderError,
  ref,
  print = false,
}: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tuneRef = useRef<TuneObject | null>(null);

  useImperativeHandle(
    ref,
    (): ScoreViewHandle => ({
      tune: () => tuneRef.current,
      container: () => containerRef.current,
      scrollToBar: (bar: number) => {
        const container = containerRef.current;
        if (!container) return;
        /*
         * add_classes emits both abcjs-m<n> and abcjs-mm<n>. They are not
         * interchangeable: abcjs-m counts measures *within a system* and
         * restarts at zero on every line, while abcjs-mm is the absolute
         * measure number across the tune. Only the latter can find bar 33.
         * Both are 0-based.
         */
        const target = container.querySelector(`.abcjs-mm${bar}`);
        if (!target) return;
        target.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'center',
        });
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const draw = (width: number) => {
      /*
       * `wrap` is what makes this readable on a phone. Without it abcjs breaks
       * systems where the *source* breaks them, so an arrangement written as
       * one long line renders as one long system — which `responsive: 'resize'`
       * then scales down to fit, producing sixteen bars of unreadable specks.
       * Re-flowing to the measured width instead keeps the staff legible from
       * 375px up.
       */
      const staffwidth = Math.max(280, Math.min(width, 1100));
      const params: AbcVisualParams = {
        responsive: 'resize',
        add_classes: true,
        staffwidth,
        wrap: {
          preferredMeasuresPerLine: staffwidth < 480 ? 2 : staffwidth < 760 ? 3 : 4,
          minSpacing: 1.6,
          maxSpacing: 2.7,
          minSpacingLimit: 1.2,
        },
        paddingleft: 0,
        paddingright: 0,
        paddingtop: 8,
        paddingbottom: 12,
        visualTranspose,
        print,
        format: {
          titlefont: 'Georgia 18',
          subtitlefont: 'Georgia 14',
          composerfont: 'Georgia 12 italic',
          gchordfont: 'Helvetica 11 bold',
          vocalfont: 'Helvetica 11',
        },
      };

      try {
        const rendered = abcjs.renderAbc(container, abc, params);
        const tune = rendered[0];
        if (!tune) {
          onRenderError?.('The engraver produced no staff for this arrangement.');
          return;
        }
        tuneRef.current = tune;
        onTune?.(tune);
      } catch (e: unknown) {
        tuneRef.current = null;
        container.replaceChildren();
        onRenderError?.(e instanceof Error ? e.message : String(e));
      }
    };

    draw(container.clientWidth);

    // Re-flow on resize, but only when the width actually changes enough to
    // alter the layout — re-engraving is not cheap.
    let lastWidth = container.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(width - lastWidth) < 24) return;
      lastWidth = width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => draw(width));
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      container.replaceChildren();
    };
  }, [abc, visualTranspose, print, onTune, onRenderError]);

  return (
    <div
      ref={containerRef}
      // The score is always on white, in both themes — it is sheet music.
      className="cadence-score w-full overflow-x-auto rounded bg-white p-2 text-black"
      role="img"
      aria-label="Musical score"
    />
  );
}
