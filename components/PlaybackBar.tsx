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
    <div className="print-hide cadence-card flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? synth.pause() : void synth.play())}
          disabled={busy || blocked}
          aria-label={playing ? 'Pause' : 'Play'}
          className="cadence-solid rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-45"
        >
          {busy ? 'Loading instrument…' : playing ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          onClick={() => synth.restart()}
          disabled={synth.status === 'idle' || busy || blocked}
          className="rounded-lg border px-3 py-2 text-sm disabled:opacity-45"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-soft)' }}
        >
          Restart
        </button>

        <p aria-live="polite" className="font-mono text-xs tabular-nums" style={{ color: 'var(--ink-faint)' }}>
          {currentBar !== null ? `Bar ${currentBar + 1} of ${totalBars}` : `${totalBars} bars`}
        </p>
      </div>

      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="w-24 shrink-0 text-xs" style={{ color: 'var(--ink-faint)' }}>Tempo</span>
        <input
          type="range"
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          step={1}
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value))}
          className="min-w-40 flex-1"
          style={{ accentColor: 'hsl(var(--hue) var(--fill-s) var(--fill-l))' }}
          aria-valuetext={`${tempo} beats per minute`}
        />
        <span className="w-28 shrink-0 font-mono text-xs tabular-nums" style={{ color: 'var(--ink-faint)' }}>
          {tempo} BPM
          {tempo !== suggestedTempo && (
            <button
              type="button"
              onClick={() => onTempoChange(suggestedTempo)}
              className="ml-2 underline underline-offset-2"
              style={{ color: 'hsl(var(--hue) var(--mark-s) var(--mark-l))' }}
            >
              reset
            </button>
          )}
        </span>
      </label>

      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="w-24 shrink-0 text-xs" style={{ color: 'var(--ink-faint)' }}>Transpose</span>
        <input
          type="range"
          min={MIN_TRANSPOSE}
          max={MAX_TRANSPOSE}
          step={1}
          value={transpose}
          onChange={(e) => onTransposeChange(Number(e.target.value))}
          className="min-w-40 flex-1"
          style={{ accentColor: 'hsl(var(--hue) var(--fill-s) var(--fill-l))' }}
          aria-valuetext={
            transpose === 0 ? 'original key' : `${transpose} semitones from the original key`
          }
        />
        <span className="w-28 shrink-0 font-mono text-xs tabular-nums" style={{ color: 'var(--ink-faint)' }}>
          {SEMITONE_LABEL(transpose)}
        </span>
      </label>

      {synth.error && (
        <p role="status" className="text-xs" style={{ color: 'var(--ink-soft)' }}>
          {synth.error}
        </p>
      )}

      {/* abcjs's controller attaches here; its own UI is switched off. */}
      <div ref={synth.mountRef} className="sr-only" aria-hidden="true" />
    </div>
  );
}
