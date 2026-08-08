'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';

import AnalysisPanel from '@/components/AnalysisPanel';
import FormTimeline from '@/components/FormTimeline';
import { hueForName, hueStyle } from '@/components/PitchColor';
import ThemeToggle from '@/components/ThemeToggle';
import type { SectionFocus } from '@/components/ScoreWorkspace';
import { mappingIsExact, sectionSpans, totalFormBars } from '@/lib/form';
import { loadResult, type StoredResult } from '@/lib/client/resultStore';
import type { AnalysisOnly, AnalysisResult } from '@/lib/gemini/schema';

function analysisOf(result: AnalysisResult): AnalysisOnly {
  const { scores, ...rest } = result;
  void scores;
  return rest;
}

/** abcjs is browser-only; ssr: false or the build dies on `window`. */
const ScoreWorkspace = dynamic(() => import('@/components/ScoreWorkspace'), {
  ssr: false,
  loading: () => <p className="text-sm text-neutral-600">Loading the notation engine…</p>,
});

/**
 * The results workspace: analysis rail on the left, score canvas on the right,
 * stacked on mobile. Selecting a section in the form timeline moves the score
 * and, optionally, loops that section during playback.
 */
export default function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [stored, setStored] = useState<StoredResult | null | undefined>(undefined);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [loopingSection, setLoopingSection] = useState<number | null>(null);
  const [scoreBars, setScoreBars] = useState<number | null>(null);

  // sessionStorage is not available until the client has mounted.
  useEffect(() => {
    setStored(loadResult(id));
  }, [id]);

  const spans = useMemo(
    () => (stored ? sectionSpans(stored.result.form) : []),
    [stored],
  );
  const formBars = useMemo(() => totalFormBars(spans), [spans]);

  const focus = useMemo<SectionFocus | null>(() => {
    if (activeSection === null) return null;
    const span = spans[activeSection];
    if (!span) return null;
    return { index: span.index, startBar: span.startBar, endBar: span.endBar, formBars };
  }, [activeSection, spans, formBars]);

  const onSelect = useCallback((index: number) => {
    setActiveSection(index);
  }, []);

  const onToggleLoop = useCallback((index: number) => {
    setLoopingSection((current) => (current === index ? null : index));
  }, []);

  /**
   * The harmonic centre of each section — the root of its first chord — which
   * is what the timeline tints by.
   */
  const sectionRoots = useMemo(() => {
    const roots: Record<string, string | undefined> = {};
    for (const entry of stored?.result.harmony ?? []) {
      roots[entry.section] = entry.chordSymbols[0];
    }
    return roots;
  }, [stored]);

  if (stored === undefined) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Loading the analysis…
        </p>
      </main>
    );
  }

  if (stored === null) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-14">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          That analysis is not in this tab
        </h1>
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Results are kept for the browser tab that ran them, so this link will not open an analysis
          someone else produced — or one from a tab you have since closed. Run it again and it will
          be here.
        </p>
        <Link
          href="/"
          className="cadence-solid w-fit rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          Analyse a link
        </Link>
      </main>
    );
  }

  const { result, accuracy } = stored;
  // The panel takes the analysis without the arrangements; the workspace owns
  // those.
  const analysis = analysisOf(result);

  return (
    // The detected key sets the page accent; everything below inherits --hue.
    <main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8"
      style={hueStyle(hueForName(result.musical.key))}
    >
      <nav className="print-hide flex items-center justify-between">
        <Link
          href="/"
          className="text-xs underline underline-offset-2"
          style={{ color: 'var(--ink-faint)' }}
        >
          ← Analyse another
        </Link>
        <ThemeToggle />
      </nav>

      <header className="flex flex-col gap-2">
        <div className="cadence-accent-bar max-w-32" />
        <h1 className="font-display text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
          {result.track.title}
        </h1>
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          {result.track.artist} · {result.track.genre} · {result.track.eraOrStyle}
        </p>
      </header>

      {/* Two columns on desktop, stacked on mobile. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside
          aria-label="Analysis"
          className="print-hide flex w-full flex-col gap-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:w-96 lg:shrink-0 lg:overflow-y-auto"
        >
          <AnalysisPanel
            analysis={analysis}
            timeline={
              <FormTimeline
                spans={spans}
                activeIndex={activeSection}
                onSelect={onSelect}
                loopingIndex={loopingSection}
                onToggleLoop={onToggleLoop}
                exactMapping={mappingIsExact(formBars, scoreBars ?? 0)}
                sectionRoots={sectionRoots}
              />
            }
          />
        </aside>

        <div className="min-w-0 flex-1">
          <ScoreWorkspace
            result={result}
            accuracy={accuracy}
            focus={focus}
            loopSection={loopingSection !== null && loopingSection === activeSection}
            onScoreBarsChange={setScoreBars}
          />
        </div>
      </div>

      <details className="print-hide">
        <summary className="cursor-pointer text-xs" style={{ color: 'var(--ink-faint)' }}>
          Raw analysis JSON
        </summary>
        <pre
          className="cadence-card mt-2 max-h-[32rem] overflow-auto font-mono text-xs whitespace-pre-wrap"
          style={{ color: 'var(--ink-soft)' }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </main>
  );
}
