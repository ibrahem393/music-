import abcjs, { type TuneObject } from 'abcjs';

import { stripFences } from '@/lib/abc/validate';
import { toMusicXml, type MusicXmlMeta } from '@/lib/abc/musicxml';

export { toMusicXml, type MusicXmlMeta };

/** The brief's transpose range. */
export const MIN_TRANSPOSE = -6;
export const MAX_TRANSPOSE = 6;

/** The brief's tempo slider range. */
export const MIN_TEMPO = 40;
export const MAX_TEMPO = 200;

export function clampTranspose(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(MIN_TRANSPOSE, Math.min(MAX_TRANSPOSE, Math.round(semitones)));
}

export function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) return MIN_TEMPO;
  return Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(bpm)));
}

/**
 * Rewrites the ABC source into a new key.
 *
 * abcjs also takes a `visualTranspose` render parameter, which moves the
 * printed notes without touching the source. That is the right tool for the
 * on-screen staff, but the downloads have to carry the transposition in the
 * source or a MusicXML export would silently come out in the original key.
 */
export function transposeAbc(abc: string, semitones: number): string {
  const source = stripFences(abc);
  const steps = clampTranspose(semitones);
  if (steps === 0) return source;

  const parsed = abcjs.parseOnly(source);
  // abcjs types this as a 1-tuple, but a document with no tune really does
  // come back empty at runtime.
  if (!parsed[0]) return source;
  return abcjs.strTranspose(source, parsed, steps);
}

/**
 * Rewrites the Q: header. ABC allows several tempo spellings, so an existing
 * Q: line is replaced wholesale rather than patched.
 */
export function setTempo(abc: string, bpm: number): string {
  const source = stripFences(abc);
  const tempo = clampTempo(bpm);
  const line = `Q:1/4=${tempo}`;

  if (/^Q:.*$/m.test(source)) {
    return source.replace(/^Q:.*$/m, line);
  }

  // No Q: yet. It belongs in the header block, immediately before K:.
  if (/^K:.*$/m.test(source)) {
    return source.replace(/^(K:.*)$/m, `${line}\n$1`);
  }

  return `${line}\n${source}`;
}

export function readTempo(tune: TuneObject): number {
  const bpm = tune.getBpm();
  return bpm > 0 ? Math.round(bpm) : 0;
}

export type MidiResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; message: string };

/**
 * Renders a standard MIDI file. abcjs builds this from the parsed tune with no
 * audio context involved, so it works headless and needs no user gesture.
 */
export function toMidiBytes(abc: string): MidiResult {
  try {
    const output = abcjs.synth.getMidiFile(stripFences(abc), { midiOutputType: 'binary' });
    const candidate: unknown = Array.isArray(output) ? output[0] : output;
    if (candidate instanceof Uint8Array) return { ok: true, bytes: candidate };
    return { ok: false, message: 'The MIDI encoder returned an unexpected format.' };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type ExportFormat = 'musicxml' | 'midi' | 'abc';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  musicxml: 'application/vnd.recordare.musicxml+xml',
  midi: 'audio/midi',
  abc: 'text/vnd.abc',
};

export const EXPORT_EXTENSION: Record<ExportFormat, string> = {
  musicxml: 'musicxml',
  midi: 'mid',
  abc: 'abc',
};

/** Safe across the filesystems people actually download onto. */
export function exportFileName(
  title: string,
  artist: string,
  level: string,
  format: ExportFormat,
): string {
  const slug = [title, artist, level]
    .filter((part) => part.trim().length > 0)
    .join('-')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return `${slug.length > 0 ? slug : 'cadence-score'}.${EXPORT_EXTENSION[format]}`;
}
