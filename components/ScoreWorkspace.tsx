'use client';

import type { NoteTimingEvent, TuneObject } from 'abcjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import DifficultyTabs from '@/components/DifficultyTabs';
import PlaybackBar from '@/components/PlaybackBar';
import ScoreView, { type ScoreViewHandle } from '@/components/ScoreView';
import {
  EXPORT_MIME,
  clampTempo,
  clampTranspose,
  exportFileName,
  toMidiBytes,
  toMusicXml,
  transposeAbc,
  type ExportFormat,
} from '@/lib/abc/transform';
import { validateAbc } from '@/lib/abc/validate';
import { prepareScore, type ScoreState } from '@/lib/client/prepareScore';
import { useSynth, type LoopRange } from '@/lib/client/useSynth';
import { DIFFICULTY_LEVELS, type AnalysisResult, type Difficulty } from '@/lib/gemini/schema';

/**
 * The notation workspace: validate, repair, render, play, transpose, export.
 *
 * Everything under here is browser-only. This module is reached exclusively
 * through next/dynamic with ssr: false.
 */

const DISCLAIMER = 'AI-generated arrangement — verify against the recording before performance.';

export type ScoreWorkspaceProps = {
  result: AnalysisResult;
  accuracy: 'fast' | 'accurate';
  /** Bar to scroll to, supplied by the form timeline in Phase 3. */
  scrollToBar?: number | null;
  loop?: LoopRange;
};

type States = Record<Difficulty, ScoreState>;

const INITIAL_STATES: States = {
  easy: { status: 'validating' },
  medium: { status: 'validating' },
  hard: { status: 'validating' },
};

export default function ScoreWorkspace({
  result,
  accuracy,
  scrollToBar = null,
  loop = null,
}: ScoreWorkspaceProps) {
  const [states, setStates] = useState<States>(INITIAL_STATES);
  const [active, setActive] = useState<Difficulty>('medium');
  const [transpose, setTranspose] = useState(0);
  const [tempo, setTempo] = useState(() => clampTempo(result.scores.medium.suggestedTempo));
  const [tune, setTune] = useState<TuneObject | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const scoreRef = useRef<ScoreViewHandle | null>(null);
  const cursorRef = useRef<HTMLElement[]>([]);
  /**
   * Once the reader picks a level themselves we stop moving them off it. The
   * automatic fallback below is for the opening moment only — being bounced
   * away from a tab you just clicked would make the honest "why this level is
   * unavailable" message impossible to read.
   */
  const userPicked = useRef(false);

  const selectLevel = useCallback((level: Difficulty) => {
    userPicked.current = true;
    setActive(level);
  }, []);

  // Validate all three levels up front, repairing at most once each, so the
  // tabs can tell the truth about which levels are playable before they are
  // clicked.
  useEffect(() => {
    const controller = new AbortController();

    for (const level of DIFFICULTY_LEVELS) {
      const score = result.scores[level];
      void prepareScore(score.abc, {
        level,
        accuracy,
        signal: controller.signal,
        onState: (state) => {
          if (controller.signal.aborted) return;
          setStates((current) => ({ ...current, [level]: state }));
        },
      });
    }

    return () => controller.abort();
  }, [result, accuracy]);

  const activeState = states[active];
  const activeScore = result.scores[active];

  // Follow the tab with the tempo the arranger suggested for that level.
  useEffect(() => {
    setTempo(clampTempo(result.scores[active].suggestedTempo));
  }, [active, result]);

  // If the default level turns out to be unavailable, open on one that works
  // rather than on an empty canvas.
  useEffect(() => {
    if (userPicked.current || activeState.status !== 'unavailable') return;
    const fallback = DIFFICULTY_LEVELS.find((level) => states[level].status === 'ready');
    if (fallback) setActive(fallback);
  }, [activeState.status, states]);

  useEffect(() => {
    if (scrollToBar !== null) scoreRef.current?.scrollToBar(scrollToBar);
  }, [scrollToBar]);

  const paintCursor = useCallback((event: NoteTimingEvent) => {
    for (const element of cursorRef.current) element.classList.remove('cadence-cursor');
    const next = (event.elements ?? []).flat();
    for (const element of next) element.classList.add('cadence-cursor');
    cursorRef.current = next;
  }, []);

  const synth = useSynth({ tune, tempo, transpose, loop, onEvent: paintCursor });

  useEffect(() => {
    return () => {
      for (const element of cursorRef.current) element.classList.remove('cadence-cursor');
      cursorRef.current = [];
    };
  }, [active]);

  const readyAbc = activeState.status === 'ready' ? activeState.abc : null;

  const totalBars = useMemo(
    () => (activeState.status === 'ready' ? activeState.bars : 0),
    [activeState],
  );

  const download = useCallback(
    (format: ExportFormat) => {
      if (!readyAbc) return;
      // The staff transposes visually; downloads must carry it in the source
      // or the file would silently come back in the original key.
      const source = transposeAbc(readyAbc, transpose);

      let data: BlobPart;
      if (format === 'abc') {
        data = source;
      } else if (format === 'midi') {
        const midi = toMidiBytes(source);
        if (!midi.ok) {
          setRenderError(`MIDI export failed: ${midi.message}`);
          return;
        }
        data = midi.bytes as unknown as BlobPart;
      } else {
        const parsed = validateAbc(source);
        if (!parsed.ok) {
          setRenderError('MusicXML export failed: the transposed score did not re-validate.');
          return;
        }
        data = toMusicXml(parsed.tune, {
          title: result.track.title,
          composer: result.track.artist,
          subtitle: DISCLAIMER,
        });
      }

      const blob = new Blob([data], { type: EXPORT_MIME[format] });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFileName(result.track.title, result.track.artist, active, format);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    [readyAbc, transpose, result.track, active],
  );

  return (
    <section aria-label="Score" className="flex flex-col gap-4">
      <DifficultyTabs active={active} onChange={selectLevel} states={states} />

      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="flex flex-col gap-4"
      >
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {result.track.title} — {result.track.artist}
          </h2>
          <p className="text-xs text-neutral-600">{DISCLAIMER}</p>
          {activeState.status === 'ready' && (
            <p className="text-xs text-neutral-500">
              {activeScore.difficultyNote}
              {activeScore.keyChanged && ' Transposed from the original key for this level.'}
              {activeState.repaired &&
                ` Notation was repaired before rendering${activeState.fixNote ? `: ${activeState.fixNote}` : '.'}`}
            </p>
          )}
        </header>

        <div aria-live="polite">
          {activeState.status === 'validating' && (
            <p className="text-sm text-neutral-600">Checking the notation…</p>
          )}
          {activeState.status === 'repairing' && (
            <p className="text-sm text-neutral-600">
              The notation did not parse. Asking for a corrected copy…
            </p>
          )}
          {activeState.status === 'unavailable' && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">{activeState.reason}</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-amber-800">What the parser said</summary>
                <pre className="mt-1 overflow-x-auto text-xs whitespace-pre-wrap text-amber-900">
                  {activeState.detail}
                </pre>
              </details>
            </div>
          )}
        </div>

        {readyAbc && (
          <>
            <PlaybackBar
              synth={synth}
              tempo={tempo}
              onTempoChange={(bpm) => setTempo(clampTempo(bpm))}
              transpose={transpose}
              onTransposeChange={(semitones) => setTranspose(clampTranspose(semitones))}
              suggestedTempo={clampTempo(activeScore.suggestedTempo)}
              currentBar={synth.currentBar}
              totalBars={totalBars}
            />

            <ScoreView
              ref={scoreRef}
              abc={readyAbc}
              visualTranspose={transpose}
              onTune={setTune}
              onRenderError={setRenderError}
            />

            {renderError && (
              <p role="status" className="text-xs text-amber-800">
                {renderError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['musicxml', 'Download MusicXML'],
                  ['midi', 'Download MIDI'],
                  ['abc', 'Download ABC'],
                ] as const
              ).map(([format, label]) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => download(format)}
                  className="rounded border border-neutral-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
