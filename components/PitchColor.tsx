'use client';

import type { CSSProperties } from 'react';

/**
 * The chromatic colour system — the one idea, applied everywhere.
 *
 * Twelve pitch classes, twelve fixed hues around a wheel. The detected key
 * sets the page accent; chord symbols carry their root's hue; the form
 * timeline tints by each section's harmonic centre; notes glow in their pitch
 * colour as the playback cursor passes. Every accent in the interface is
 * derived from here and nowhere else.
 *
 * Two decisions worth stating:
 *
 * The wheel is ordered by the circle of fifths, not chromatically. Closely
 * related keys — C, G, F — land on neighbouring hues, while semitone
 * neighbours like C and C sharp end up far apart and stay easy to tell from
 * one another. A chromatic wheel gets that exactly backwards.
 *
 * Only hue lives here. Saturation and lightness come from the role a colour is
 * playing (a solid fill, a card wash, a border, text on paper), which is what
 * lets the same twelve hues work in both themes without a second palette.
 */

/**
 * Twelve hues, in circle-of-fifths order starting at C. Five positions are the
 * brand accents exactly — marigold, lime, cyan, violet, magenta — and the rest
 * fill the wheel between them.
 */
export const PITCH_HUES = [
  41, // C  — marigold #FFC145
  76, // G  — lime #A8E10C
  108, // D
  143, // A
  184, // E  — cyan #00D4E0
  214, // B
  252, // F# — violet #7B5CFF
  278, // C#
  300, // G#
  331, // D# — magenta #FF3D9A
  356, // A#
  18, // F
] as const;

export const PITCH_CLASS_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
] as const;

/** Semitones above C for each natural letter. */
const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Position on the wheel for a pitch class. Multiplying by 7 walks the circle
 * of fifths, since a fifth is seven semitones.
 */
export function wheelPosition(pitchClass: number): number {
  return (((pitchClass * 7) % 12) + 12) % 12;
}

export function hueForPitchClass(pitchClass: number): number {
  return PITCH_HUES[wheelPosition(pitchClass)] as number;
}

/**
 * Reads the root out of a key or chord name.
 *
 * Handles what the model actually writes: "C major", "E-flat minor", "F#m7",
 * "Bb", "A7♭9", "Dm7/G". Returns null rather than guessing when there is no
 * note name at the front — a chord we cannot read simply goes uncoloured.
 */
export function parsePitchClass(name: string | null | undefined): number | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;

  const letter = trimmed[0]?.toUpperCase();
  if (!letter || !(letter in LETTER_SEMITONES)) return null;

  let semitones = LETTER_SEMITONES[letter] as number;
  const rest = trimmed.slice(1);

  // Accidental directly after the letter, in any spelling the model uses.
  const accidental = rest.match(/^\s*(♯|#|♭|b|-?sharp|-?flat)/i)?.[1];
  if (accidental) {
    const lowered = accidental.toLowerCase();
    if (lowered === '♯' || lowered === '#' || lowered.endsWith('sharp')) semitones += 1;
    // A lone "b" is only a flat when it is not the start of a word such as
    // "bass" — but as a chord suffix directly after a letter it always is.
    else semitones -= 1;
  }

  return ((semitones % 12) + 12) % 12;
}

export function hueForName(name: string | null | undefined): number | null {
  const pitchClass = parsePitchClass(name);
  return pitchClass === null ? null : hueForPitchClass(pitchClass);
}

/**
 * Sets the local hue. Every pitch-coloured rule in globals.css reads --hue, so
 * dropping this on an element tints it and everything inside it.
 */
export function hueStyle(hue: number | null | undefined): CSSProperties {
  if (hue === null || hue === undefined) return {};
  return { ['--hue' as string]: String(Math.round(hue)) };
}

export function pitchStyle(name: string | null | undefined): CSSProperties {
  return hueStyle(hueForName(name));
}

/**
 * The twelve bars breathing on the idle hero. Each one is a pitch class, with
 * its own rate so the group never pulses in lockstep.
 */
export function PitchBars({ className = '' }: { className?: string }) {
  return (
    <div
      className={`cadence-bars ${className}`}
      aria-hidden="true"
      // Decorative: the twelve pitch classes, at rest.
    >
      {PITCH_HUES.map((hue, index) => (
        <span
          key={index}
          className="cadence-bar"
          style={
            {
              '--hue': String(hue),
              '--delay': `${(index * 0.37).toFixed(2)}s`,
              '--rate': `${(2.6 + (index % 5) * 0.44).toFixed(2)}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** A chord symbol or key name, wearing its root's hue. */
export function PitchChip({
  label,
  title,
  className = '',
}: {
  label: string;
  title?: string;
  className?: string;
}) {
  const hue = hueForName(label);
  return (
    <span
      className={`cadence-chip ${hue === null ? 'cadence-chip-plain' : ''} ${className}`}
      style={hueStyle(hue)}
      title={title}
    >
      {label}
    </span>
  );
}
