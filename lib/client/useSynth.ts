'use client';

import abcjs, { type CursorControl, type NoteTimingEvent, type TuneObject } from 'abcjs';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Playback over abcjs's synth controller.
 *
 * The controller is loaded into a hidden node so we get its transport, tempo
 * and seek handling without its stock UI — the buttons in PlaybackBar are ours.
 *
 * Audio has to start from a user gesture, so nothing is initialised until the
 * first play. Everything before that is deliberately inert.
 */

export type SynthStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'unsupported' | 'error';

/** abcjs's default soundfont host. A network failure here is not fatal. */
const SOUNDFONT_URL = 'https://paulrosen.github.io/midi-js-soundfonts/abcjs/';

export type LoopRange = { startMs: number; endMs: number } | null;

export type SynthController = {
  status: SynthStatus;
  error: string | null;
  /** 0–1 through the tune. */
  progress: number;
  currentBar: number | null;
  play: () => Promise<void>;
  pause: () => void;
  restart: () => void;
  seek: (fraction: number) => void;
  /** The hidden node abcjs's controller needs to attach to. */
  mountRef: (node: HTMLDivElement | null) => void;
};

export type UseSynthOptions = {
  tune: TuneObject | null;
  tempo: number;
  /** Semitones. Kept in sync with the visual transpose so ear matches eye. */
  transpose: number;
  loop: LoopRange;
  onEvent?: (event: NoteTimingEvent) => void;
};

export function useSynth(options: UseSynthOptions): SynthController {
  const { tune, tempo, transpose, loop, onEvent } = options;

  const [status, setStatus] = useState<SynthStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentBar, setCurrentBar] = useState<number | null>(null);

  const controllerRef = useRef<ReturnType<typeof createController> | null>(null);
  const mountedRef = useRef<HTMLDivElement | null>(null);
  const loopRef = useRef<LoopRange>(loop);
  const onEventRef = useRef(onEvent);

  loopRef.current = loop;
  onEventRef.current = onEvent;

  const mountRef = useCallback((node: HTMLDivElement | null) => {
    mountedRef.current = node;
  }, []);

  const cursorControl = useRef<CursorControl>({
    onStart: () => {
      setStatus('playing');
    },
    onFinished: () => {
      setStatus('ready');
      setProgress(0);
      setCurrentBar(null);
    },
    onBeat: (beatNumber: number, totalBeats: number) => {
      if (totalBeats > 0) setProgress(Math.min(1, beatNumber / totalBeats));
    },
    onEvent: (event: NoteTimingEvent) => {
      if (event.type === 'end') return;
      if (typeof event.measureNumber === 'number') setCurrentBar(event.measureNumber);
      onEventRef.current?.(event);

      // Section looping. The form timeline supplies the range in Phase 3.
      const range = loopRef.current;
      const controller = controllerRef.current;
      if (range && controller && event.milliseconds >= range.endMs) {
        const total = controller.totalMs;
        if (total > 0) controller.instance.setProgress(range.startMs / total);
      }
    },
  });

  // Reload the tune whenever the music, tempo or transposition changes.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !tune) return;
    let cancelled = false;

    void (async () => {
      try {
        await controller.instance.setTune(tune, false, {
          qpm: tempo,
          program: 0,
          midiTranspose: transpose,
          soundFontUrl: SOUNDFONT_URL,
        });
        if (!cancelled) controller.totalMs = tune.getTotalTime() * 1000;
      } catch (e: unknown) {
        if (!cancelled) {
          setStatus('error');
          setError(describe(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tune, tempo, transpose]);

  const play = useCallback(async () => {
    if (!tune) return;

    if (!abcjs.synth.supportsAudio()) {
      setStatus('unsupported');
      setError('This browser cannot play audio through the Web Audio API.');
      return;
    }

    if (controllerRef.current) {
      controllerRef.current.instance.play();
      return;
    }

    const node = mountedRef.current;
    if (!node) return;

    setStatus('loading');
    setError(null);

    try {
      const instance = new abcjs.synth.SynthController();
      instance.load(node, cursorControl.current, {
        displayLoop: false,
        displayRestart: false,
        displayPlay: false,
        displayProgress: false,
        displayWarp: false,
      });

      const response = await instance.setTune(tune, true, {
        qpm: tempo,
        program: 0,
        midiTranspose: transpose,
        soundFontUrl: SOUNDFONT_URL,
      });

      if (response.status === 'no-audio-context') {
        setStatus('unsupported');
        setError('The browser would not give us an audio context.');
        return;
      }

      controllerRef.current = createController(instance, tune.getTotalTime() * 1000);
      setStatus('ready');
      instance.play();
    } catch (e: unknown) {
      setStatus('error');
      setError(
        `Playback could not start. The instrument samples are fetched from an external host — ${describe(e)}`,
      );
    }
  }, [tune, tempo, transpose]);

  const pause = useCallback(() => {
    controllerRef.current?.instance.pause();
    setStatus((current) => (current === 'playing' ? 'ready' : current));
  }, []);

  const restart = useCallback(() => {
    controllerRef.current?.instance.restart();
    setProgress(0);
  }, []);

  const seek = useCallback((fraction: number) => {
    controllerRef.current?.instance.setProgress(Math.max(0, Math.min(1, fraction)));
    setProgress(Math.max(0, Math.min(1, fraction)));
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.instance.pause();
      controllerRef.current = null;
    };
  }, []);

  return { status, error, progress, currentBar, play, pause, restart, seek, mountRef };
}

function createController(instance: abcjs.SynthObjectController, totalMs: number) {
  return { instance, totalMs };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
