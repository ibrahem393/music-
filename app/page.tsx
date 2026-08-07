'use client';

import { useCallback, useRef, useState } from 'react';

import { runAnalysis } from '@/lib/client/runAnalysis';
import { STAGES, STAGE_LABEL, type ProgressEvent, type StageId } from '@/lib/progress';
import type { AnalysisOnly, AnalysisResult } from '@/lib/gemini/schema';

/**
 * Phase 1 harness. This page exists to prove the pipeline end to end: paste a
 * link, watch real stages arrive, read the raw JSON. The hero, the URL field as
 * focal element, and everything else in the design direction land in Phase 4.
 */

const EXAMPLES = [
  { label: 'Radiohead — Weird Fishes', url: 'https://www.youtube.com/watch?v=EAqLI8g_LMk' },
  { label: 'Bill Evans — Waltz for Debby', url: 'https://www.youtube.com/watch?v=OaCza2-Cs5Y' },
  { label: 'Stevie Wonder — Sir Duke', url: 'https://www.youtube.com/watch?v=6sPKLZ0qKhY' },
];

type RunState = 'idle' | 'running' | 'done' | 'failed';

export default function Home() {
  const [source, setSource] = useState('');
  const [accuracy, setAccuracy] = useState<'fast' | 'accurate'>('fast');
  const [state, setState] = useState<RunState>('idle');
  const [stage, setStage] = useState<StageId | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisOnly | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const onEvent = useCallback((event: ProgressEvent) => {
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
        setResult(event.result);
        setElapsedMs(event.elapsedMs);
        setState('done');
        break;
      case 'error':
        setError(event.detail ? { message: event.message, detail: event.detail } : { message: event.message });
        setState('failed');
        break;
    }
  }, []);

  const start = useCallback(
    async (raw: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState('running');
      setStage(null);
      setElapsedMs(0);
      setAnalysis(null);
      setResult(null);
      setError(null);

      await runAnalysis({ source: raw, accuracy }, { onEvent }, controller.signal);

      setState((current) => (current === 'running' ? 'idle' : current));
    },
    [accuracy, onEvent],
  );

  const running = state === 'running';
  const currentIndex = stage ? STAGES.indexOf(stage) : -1;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Cadence</h1>
        <p className="text-sm text-neutral-600">
          Paste a music video link. Get an analysis and a piano score at three difficulty levels.
        </p>
        <p className="text-xs text-neutral-500">Phase 1 harness — raw pipeline output, no styling yet.</p>
      </header>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void start(source);
        }}
      >
        <label htmlFor="source" className="text-sm font-medium">
          Video link
        </label>
        <input
          id="source"
          name="source"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=…"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
        />

        <fieldset className="flex flex-wrap items-center gap-4 text-sm">
          <legend className="sr-only">Model</legend>
          {(['fast', 'accurate'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="accuracy"
                value={value}
                checked={accuracy === value}
                onChange={() => setAccuracy(value)}
                className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
              />
              {value === 'fast' ? 'Fast (2.5 Flash)' : 'High accuracy (2.5 Pro)'}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={running || source.trim().length === 0}
            className="rounded bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
          >
            {running ? 'Analysing…' : 'Analyse'}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded border border-neutral-300 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {state === 'idle' && !result && (
        <section aria-labelledby="examples" className="flex flex-col gap-2">
          <h2 id="examples" className="text-sm font-medium">
            Or try one of these
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {EXAMPLES.map((example) => (
              <li key={example.url}>
                <button
                  type="button"
                  onClick={() => {
                    setSource(example.url);
                    void start(example.url);
                  }}
                  className="text-violet-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
                >
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Progress" aria-live="polite" aria-busy={running} className="flex flex-col gap-2">
        {(running || state === 'done') && (
          <>
            <ol className="flex flex-col gap-1 text-sm">
              {STAGES.map((id, index) => {
                const status =
                  currentIndex > index || state === 'done'
                    ? 'done'
                    : currentIndex === index
                      ? 'active'
                      : 'waiting';
                return (
                  <li
                    key={id}
                    className={
                      status === 'done'
                        ? 'text-neutral-500'
                        : status === 'active'
                          ? 'font-medium text-neutral-900'
                          : 'text-neutral-400'
                    }
                  >
                    {status === 'done' ? '✓' : status === 'active' ? '▸' : '·'} {STAGE_LABEL[id]}
                  </li>
                );
              })}
            </ol>
            <p className="text-xs tabular-nums text-neutral-500">{(elapsedMs / 1000).toFixed(1)}s elapsed</p>
          </>
        )}
      </section>

      {error && (
        <section aria-label="Error" className="rounded border border-red-300 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-900">{error.message}</p>
          {error.detail && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-700">Technical detail</summary>
              <pre className="mt-1 overflow-x-auto text-xs whitespace-pre-wrap text-red-800">{error.detail}</pre>
            </details>
          )}
        </section>
      )}

      {analysis && !result && (
        <section aria-label="Analysis (partial)" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Analysis — arrangements still being written</h2>
          <RawJson value={analysis} />
        </section>
      )}

      {result && (
        <section aria-label="Result" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">
            {result.track.title} — {result.track.artist}
          </h2>
          <RawJson value={result} />
        </section>
      )}
    </main>
  );
}

function RawJson({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[32rem] overflow-auto rounded border border-neutral-300 bg-white p-3 text-xs leading-relaxed whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
