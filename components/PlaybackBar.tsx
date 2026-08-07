'use client';

import { MAX_TEMPO, MIN_TEMPO, MAX_TRANSPOSE, MIN_TRANSPOSE } from '@/lib/abc/transform';
import type { SynthController } from '@/lib/client/useSynth';

/**
 * Transport, tempo and transpose. Phase 2 styling is functional only — the
 * design pass in Phase 4 dresses this.
 */

export type PlaybackBarProps = {
  synth: SynthController;
  tempo: number;
  onTempoChange: (bpm: number) => void;
  transpose: number;
  onTransposeChange: (semitones: number) => void;
  suggestedTempo: number;
  currentBar: number | null;
  totalBars: number;
};

const SEMITONE_LABEL = (n: number): string => (n === 0 ? 'original key' : n > 0 ? `+${n}` : `${n}`);

export default function PlaybackBar({
  synth,
  tempo,
  onTempoChange,
  transpose,
  onTransposeChange,
  suggestedTempo,
  currentBar,
  totalBars,
}: PlaybackBarProps) {
  const playing = synth.status === 'playing';
  const busy = synth.status === 'loading';
  const blocked = synth.status === 'unsupported';

  return (
    <div className="flex flex-col gap-3 rounded border border-neutral-300 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? synth.pause() : void synth.play())}
          disabled={busy || blocked}
          aria-label={playing ? 'Pause' : 'Play'}
          className="rounded bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
        >
          {busy ? 'Loading instrument…' : playing ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          onClick={() => synth.restart()}
          disabled={synth.status === 'idle' || busy || blocked}
          className="rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
        >
          Restart
        </button>

        <p aria-live="polite" className="text-xs tabular-nums text-neutral-600">
          {currentBar !== null ? `Bar ${currentBar + 1} of ${totalBars}` : `${totalBars} bars`}
        </p>
      </div>

      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="w-24 shrink-0">Tempo</span>
        <input
          type="range"
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          step={1}
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value))}
          className="min-w-40 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
          aria-valuetext={`${tempo} beats per minute`}
        />
        <span className="w-28 shrink-0 tabular-nums text-neutral-600">
          {tempo} BPM
          {tempo !== suggestedTempo && (
            <button
              type="button"
              onClick={() => onTempoChange(suggestedTempo)}
              className="ml-2 text-violet-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
            >
              reset
            </button>
          )}
        </span>
      </label>

      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="w-24 shrink-0">Transpose</span>
        <input
          type="range"
          min={MIN_TRANSPOSE}
          max={MAX_TRANSPOSE}
          step={1}
          value={transpose}
          onChange={(e) => onTransposeChange(Number(e.target.value))}
          className="min-w-40 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
          aria-valuetext={
            transpose === 0 ? 'original key' : `${transpose} semitones from the original key`
          }
        />
        <span className="w-28 shrink-0 tabular-nums text-neutral-600">
          {SEMITONE_LABEL(transpose)}
        </span>
      </label>

      {synth.error && (
        <p role="status" className="text-xs text-amber-800">
          {synth.error}
        </p>
      )}

      {/* abcjs's controller attaches here; its own UI is switched off. */}
      <div ref={synth.mountRef} className="sr-only" aria-hidden="true" />
    </div>
  );
}
