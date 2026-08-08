'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { PitchBars } from '@/components/PitchColor';
import ThemeToggle from '@/components/ThemeToggle';
import { runAnalysis } from '@/lib/client/runAnalysis';
import { saveResult } from '@/lib/client/resultStore';
import { STAGES, STAGE_LABEL, type ProgressEvent, type StageId } from '@/lib/progress';
import type { AnalysisOnly } from '@/lib/gemini/schema';

/**
 * Full-bleed hero with the URL field as the single focal element. Twelve
 * coloured bars — one per pitch class — breathe while the page is idle, and
 * stop the moment there is real work to report.
 */

const EXAMPLES = [
  { label: 'Radiohead — Weird Fishes', url: 'https://www.youtube.com/watch?v=EAqLI8g_LMk' },
  { label: 'Bill Evans — Waltz for Debby', url: 'https://www.youtube.com/watch?v=OaCza2-Cs5Y' },
  { label: 'Stevie Wonder — Sir Duke', url: 'https://www.youtube.com/watch?v=6sPKLZ0qKhY' },
];

type RunState = 'idle' | 'running' | 'done' | 'failed';

export default function Home() {
  const [source, setSource] = useState('');
  const [accuracy, setAccuracy] = useState<'fast' | 'accurate'>('accurate');
  const [state, setState] = useState<RunState>('idle');
  const [stage, setStage] = useState<StageId | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisOnly | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);

  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const accuracyRef = useRef(accuracy);
  accuracyRef.current = accuracy;

  const onEvent = useCallback(
    (event: ProgressEvent) => {
      switch (event.type) {
        case 'stage':
          setStage(event.stage);
          setElapsedMs(event.elapsedMs);
          break;
        case 'heartbeat':
          setElapsedMs(event.elapsedMs);
          break;
        case 'analysis':
          setAnalysis(event.analysis);
          setElapsedMs(event.elapsedMs);
          break;
        case 'result':
          setElapsedMs(event.elapsedMs);
          setState('done');
          // Hand the analysis to the workspace. The store is per-tab, so this
          // survives a reload but does not make the URL shareable.
          saveResult({ id: event.id, accuracy: accuracyRef.current, result: event.result });
          router.push(`/work/${event.id}`);
          break;
        case 'error':
          setError(
            event.detail
              ? { message: event.message, detail: event.detail }
              : { message: event.message },
          );
          setState('failed');
          break;
      }
    },
    [router],
  );

  const start = useCallback(
    async (raw: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState('running');
      setStage(null);
      setElapsedMs(0);
      setAnalysis(null);
      setError(null);

      await runAnalysis({ source: raw, accuracy }, { onEvent }, controller.signal);

      setState((current) => (current === 'running' ? 'idle' : current));
    },
    [accuracy, onEvent],
  );

  const running = state === 'running';
  const currentIndex = stage ? STAGES.indexOf(stage) : -1;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-10 px-5 py-8 sm:py-14">
      <nav className="flex items-center justify-between">
        <span
          className="font-mono text-xs tracking-widest uppercase"
          style={{ color: 'var(--ink-faint)' }}
        >
          Cadence
        </span>
        <ThemeToggle />
      </nav>

      <header className="flex flex-col gap-5">
        <h1
          className="font-display text-5xl leading-[0.95] font-extrabold tracking-tight sm:text-7xl"
          style={{ letterSpacing: '-0.035em' }}
        >
          Hear it once.
          <br />
          <span
            style={{
              color: 'hsl(var(--hue) var(--fill-s) var(--fill-l))',
            }}
          >
            Play it tonight.
          </span>
        </h1>
        <p className="max-w-xl text-base sm:text-lg" style={{ color: 'var(--ink-soft)' }}>
          Paste a music video link. Cadence listens to the recording, writes out the analysis, and
          arranges it for piano at three difficulty levels.
        </p>
      </header>

      {/* The single focal element. */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start(source);
        }}
      >
        <label htmlFor="source" className="sr-only">
          Video link
        </label>
        <div
          className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"
          style={{
            borderColor: 'hsl(var(--hue) var(--edge-s) var(--edge-l))',
            background: 'var(--paper-raised)',
          }}
        >
          <input
            id="source"
            name="source"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://www.youtube.com/watch?v=…"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-base outline-none sm:text-lg"
            style={{ color: 'var(--ink)' }}
          />
          <button
            type="submit"
            disabled={running || source.trim().length === 0}
            className="cadence-solid rounded-lg px-5 py-3 text-sm font-semibold disabled:opacity-45"
          >
            {running ? 'Analysing…' : 'Analyse'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <fieldset className="flex flex-wrap items-center gap-4">
            <legend className="sr-only">Model</legend>
            {(['accurate', 'fast'] as const).map((value) => (
              <label key={value} className="flex items-center gap-1.5" style={{ color: 'var(--ink-soft)' }}>
                <input
                  type="radio"
                  name="accuracy"
                  value={value}
                  checked={accuracy === value}
                  onChange={() => setAccuracy(value)}
                />
                {value === 'accurate' ? 'Best notation (2.5 Pro)' : 'Faster (2.5 Flash)'}
              </label>
            ))}
          </fieldset>
          {running && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="underline underline-offset-2"
              style={{ color: 'var(--ink-soft)' }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {state === 'idle' && !error && (
        <section aria-labelledby="examples" className="flex flex-col gap-3">
          <h2 id="examples" className="text-xs tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Or start with one of these
          </h2>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <li key={example.url}>
                <button
                  type="button"
                  onClick={() => {
                    setSource(example.url);
                    void start(example.url);
                  }}
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-soft)' }}
                >
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-label="Progress"
        aria-live="polite"
        aria-busy={running}
        className="flex flex-col gap-3"
      >
        {(running || state === 'done') && (
          <>
            <ol className="flex flex-col gap-1.5">
              {STAGES.map((id, index) => {
                const done = currentIndex > index || state === 'done';
                const active = currentIndex === index && state !== 'done';
                return (
                  <li key={id} className="flex items-center gap-2.5 text-sm">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: done
                          ? 'hsl(var(--hue) var(--fill-s) var(--fill-l))'
                          : active
                            ? 'hsl(var(--hue) var(--fill-s) var(--fill-l))'
                            : 'var(--line-strong)',
                        opacity: done ? 0.5 : 1,
                      }}
                    />
                    <span
                      style={{
                        color: active ? 'var(--ink)' : done ? 'var(--ink-faint)' : 'var(--ink-faint)',
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {STAGE_LABEL[id]}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="font-mono text-xs tabular-nums" style={{ color: 'var(--ink-faint)' }}>
              {(elapsedMs / 1000).toFixed(1)}s
            </p>
          </>
        )}
      </section>

      {error && (
        <section
          aria-label="Error"
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--color-magenta)', background: 'var(--paper-raised)' }}
        >
          <p className="text-sm font-medium">{error.message}</p>
          {error.detail && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs" style={{ color: 'var(--ink-faint)' }}>
                Technical detail
              </summary>
              <pre
                className="mt-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap"
                style={{ color: 'var(--ink-soft)' }}
              >
                {error.detail}
              </pre>
            </details>
          )}
        </section>
      )}

      {analysis && (
        <section aria-label="Analysis so far" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">
            {analysis.track.title} — {analysis.track.artist}
          </h2>
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            {analysis.musical.key} · {Math.round(analysis.musical.tempoBpm)} BPM ·{' '}
            {analysis.musical.timeSignature}. Writing the arrangements now.
          </p>
        </section>
      )}

      {/* The twelve pitch classes, at rest. */}
      <div className="mt-auto pt-6">{state === 'idle' && !error && <PitchBars />}</div>
    </main>
  );
}
