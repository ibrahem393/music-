import type { TuneObject, VoiceItem, VoiceItemNote } from 'abcjs';

/**
 * MusicXML export.
 *
 * abcjs can render, play and transpose ABC, but it has no MusicXML writer, so
 * this walks the parsed tune and emits score-partwise 4.0 by hand.
 *
 * Two things make this more than a transliteration:
 *
 *  - Duration. abcjs reports *written* durations in whole-note units, with
 *    tuplets carried separately on tripletMultiplier. MusicXML wants sounding
 *    durations in divisions, plus a time-modification element. Both have to be
 *    emitted or the measure will not add up and the file is rejected.
 *
 *  - Accidentals. ABC and MusicXML disagree about what a note "is". ABC writes
 *    what the performer reads; MusicXML's `alter` is what the note sounds. So
 *    the key signature and any accidental earlier in the same measure have to
 *    be tracked to work out the sounding alteration.
 */

/** Divisions per quarter note. 768 keeps triplets, dots and 64ths integral. */
const DIVISIONS = 768;

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

const ALTER_FOR: Record<string, number> = {
  sharp: 1,
  flat: -1,
  natural: 0,
  dblsharp: 2,
  dblflat: -2,
  quartersharp: 0,
  quarterflat: 0,
};

const ACCIDENTAL_NAME: Record<string, string> = {
  sharp: 'sharp',
  flat: 'flat',
  natural: 'natural',
  dblsharp: 'double-sharp',
  dblflat: 'flat-flat',
};

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const;

const NOTE_TYPES: { value: number; name: string }[] = [
  { value: 8, name: 'maxima' },
  { value: 4, name: 'long' },
  { value: 2, name: 'breve' },
  { value: 1, name: 'whole' },
  { value: 1 / 2, name: 'half' },
  { value: 1 / 4, name: 'quarter' },
  { value: 1 / 8, name: 'eighth' },
  { value: 1 / 16, name: '16th' },
  { value: 1 / 32, name: '32nd' },
  { value: 1 / 64, name: '64th' },
  { value: 1 / 128, name: '128th' },
];

const DYNAMICS = new Set(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz']);

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** abcjs pitch is a diatonic index with 0 = middle C. */
export function pitchToStepOctave(pitch: number): { step: string; octave: number } {
  const index = ((pitch % 7) + 7) % 7;
  return { step: STEPS[index] as string, octave: 4 + Math.floor(pitch / 7) };
}

/** Written duration (in whole notes) to a MusicXML note type plus dots. */
export function durationToType(duration: number): { type: string; dots: number } {
  for (const { value, name } of NOTE_TYPES) {
    for (let dots = 0; dots <= 3; dots += 1) {
      // A dotted note is base * (2 - 2^-dots).
      const total = value * (2 - Math.pow(2, -dots));
      if (Math.abs(total - duration) < 1e-6) return { type: name, dots };
    }
  }
  // Anything unrecognised is written as its nearest plain type; the duration
  // element still carries the truth, so playback stays correct.
  let closest = NOTE_TYPES[NOTE_TYPES.length - 1] as { value: number; name: string };
  for (const candidate of NOTE_TYPES) {
    if (Math.abs(candidate.value - duration) < Math.abs(closest.value - duration)) closest = candidate;
  }
  return { type: closest.name, dots: 0 };
}

/** Sharps positive, flats negative, from the key signature abcjs resolved. */
export function keyFifths(tune: TuneObject): number {
  const accidentals = tune.getKeySignature().accidentals ?? [];
  let sharps = 0;
  let flats = 0;
  for (const accidental of accidentals) {
    if (accidental.acc === 'sharp') sharps += 1;
    if (accidental.acc === 'flat') flats += 1;
  }
  if (sharps > 0) return sharps;
  if (flats > 0) return -flats;
  return 0;
}

/** The alteration each step letter carries by default in this key. */
export function keyAlterations(fifths: number): Record<string, number> {
  const map: Record<string, number> = {};
  if (fifths > 0) for (const step of SHARP_ORDER.slice(0, fifths)) map[step] = 1;
  if (fifths < 0) for (const step of FLAT_ORDER.slice(0, -fifths)) map[step] = -1;
  return map;
}

type Measure = { items: VoiceItem[] };

/** Splits a staff's voice items into measures on bar lines. */
function measuresOf(tune: TuneObject, staffIndex: number): Measure[] {
  const measures: Measure[] = [];
  let current: VoiceItem[] = [];

  for (const line of tune.lines) {
    const staff = line.staff?.[staffIndex];
    if (!staff) continue;
    for (const voice of staff.voices ?? []) {
      for (const item of voice) {
        if (item.el_type === 'bar') {
          // A bar line before any material is a leading repeat, not a measure.
          if (current.length > 0) measures.push({ items: current });
          current = [];
        } else {
          current.push(item);
        }
      }
    }
  }

  if (current.length > 0) measures.push({ items: current });
  return measures;
}

function clefElement(type: string | undefined, staffNumber: number): string {
  const sign = type?.startsWith('bass') ? 'F' : type?.startsWith('alto') ? 'C' : 'G';
  const line = sign === 'F' ? 4 : sign === 'C' ? 3 : 2;
  const octaveChange = type?.endsWith('-8') ? -1 : type?.endsWith('+8') ? 1 : 0;
  return [
    `        <clef number="${staffNumber}">`,
    `          <sign>${sign}</sign>`,
    `          <line>${line}</line>`,
    octaveChange !== 0 ? `          <clef-octave-change>${octaveChange}</clef-octave-change>` : null,
    `        </clef>`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

/** Written duration in whole notes to sounding divisions. */
function divisionsOf(duration: number, multiplier: number): number {
  return Math.round(duration * multiplier * 4 * DIVISIONS);
}

type NoteContext = {
  staffNumber: number;
  voiceNumber: number;
  /** step+octave -> alteration, reset each measure from the key signature. */
  measureAccidentals: Map<string, number>;
  keyAlter: Record<string, number>;
};

/**
 * The tuplet in force. `actual` comes from abcjs's startTriplet (the number of
 * notes written), and `multiplier` is normal/actual — 2/3 for a triplet. The
 * ratio cannot be recovered from the multiplier alone: 2/3 could be 3-in-2 or
 * 6-in-4, and they are notated differently.
 */
type Tuplet = { actual: number; multiplier: number };

const NO_TUPLET: Tuplet = { actual: 1, multiplier: 1 };

function timeModificationLines(tuplet: Tuplet): string[] {
  if (tuplet.multiplier === 1) return [];
  const actual = tuplet.actual > 1 ? tuplet.actual : 3;
  const normal = Math.max(1, Math.round(actual * tuplet.multiplier));
  return [
    `        <time-modification>`,
    `          <actual-notes>${actual}</actual-notes>`,
    `          <normal-notes>${normal}</normal-notes>`,
    `        </time-modification>`,
  ];
}

function renderNote(note: VoiceItemNote, tuplet: Tuplet, context: NoteContext): string[] {
  const lines: string[] = [];
  const duration = divisionsOf(note.duration, tuplet.multiplier);
  const { type, dots } = durationToType(note.duration);
  const timeModification = timeModificationLines(tuplet);

  if (note.rest) {
    lines.push('      <note>');
    lines.push('        <rest/>');
    lines.push(`        <duration>${duration}</duration>`);
    lines.push(`        <voice>${context.voiceNumber}</voice>`);
    lines.push(`        <type>${type}</type>`);
    for (let i = 0; i < dots; i += 1) lines.push('        <dot/>');
    lines.push(...timeModification);
    lines.push(`        <staff>${context.staffNumber}</staff>`);
    lines.push('      </note>');
    return lines;
  }

  const pitches = note.pitches ?? [];
  pitches.forEach((pitch, index) => {
    const { step, octave } = pitchToStepOctave(pitch.pitch);
    const key = `${step}${octave}`;

    let alter: number;
    if (pitch.accidental && pitch.accidental in ALTER_FOR) {
      alter = ALTER_FOR[pitch.accidental] as number;
      context.measureAccidentals.set(key, alter);
    } else if (context.measureAccidentals.has(key)) {
      alter = context.measureAccidentals.get(key) as number;
    } else {
      alter = context.keyAlter[step] ?? 0;
    }

    lines.push('      <note>');
    // Every pitch after the first in a chord is a <chord/>.
    if (index > 0) lines.push('        <chord/>');
    lines.push('        <pitch>');
    lines.push(`          <step>${step}</step>`);
    if (alter !== 0) lines.push(`          <alter>${alter}</alter>`);
    lines.push(`          <octave>${octave}</octave>`);
    lines.push('        </pitch>');
    lines.push(`        <duration>${duration}</duration>`);
    if (pitch.startTie) lines.push('        <tie type="start"/>');
    if (pitch.endTie) lines.push('        <tie type="stop"/>');
    lines.push(`        <voice>${context.voiceNumber}</voice>`);
    lines.push(`        <type>${type}</type>`);
    for (let i = 0; i < dots; i += 1) lines.push('        <dot/>');
    if (pitch.accidental && pitch.accidental in ACCIDENTAL_NAME) {
      lines.push(`        <accidental>${ACCIDENTAL_NAME[pitch.accidental]}</accidental>`);
    }
    lines.push(...timeModification);
    lines.push(`        <staff>${context.staffNumber}</staff>`);

    const notations: string[] = [];
    if (pitch.startTie) notations.push('          <tied type="start"/>');
    if (pitch.endTie) notations.push('          <tied type="stop"/>');
    for (const slur of pitch.startSlur ?? []) {
      notations.push(`          <slur type="start" number="${slur.label}"/>`);
    }
    for (const label of pitch.endSlur ?? []) {
      notations.push(`          <slur type="stop" number="${label}"/>`);
    }
    if (notations.length > 0) {
      lines.push('        <notations>');
      lines.push(...notations);
      lines.push('        </notations>');
    }

    lines.push('      </note>');
  });

  return lines;
}

function direction(staffNumber: number, ...body: string[]): string[] {
  return [
    '      <direction placement="below">',
    '        <direction-type>',
    ...body,
    '        </direction-type>',
    `        <staff>${staffNumber}</staff>`,
    '      </direction>',
  ];
}

/**
 * Pedalling.
 *
 * ABC 2.1 spells pedal as the decorations !ped! and !ped-up!, but abcjs does
 * not carry them — they are absent from its legal-accent table and are dropped
 * silently during parsing, so they would reach neither the staff nor this
 * export. The prompt therefore asks for the traditional engraved marks as
 * below-staff annotations, "_Ped." and "_*", which abcjs does render, and they
 * are recovered here as real MusicXML pedal directions.
 */
function renderAnnotations(
  chord: { name?: string; position?: string }[] | undefined,
  staffNumber: number,
): string[] {
  if (!chord) return [];
  const lines: string[] = [];
  for (const annotation of chord) {
    if (annotation.position !== 'below') continue;
    const name = (annotation.name ?? '').trim();
    if (/^ped\.?$/i.test(name)) {
      lines.push(...direction(staffNumber, '          <pedal type="start" line="no"/>'));
    } else if (name === '*') {
      lines.push(...direction(staffNumber, '          <pedal type="stop" line="no"/>'));
    }
  }
  return lines;
}

/** Dynamics and hairpins survive the trip; other decorations are dropped. */
function renderDecorations(decorations: string[] | undefined, staffNumber: number): string[] {
  if (!decorations) return [];
  const lines: string[] = [];
  for (const decoration of decorations) {
    if (DYNAMICS.has(decoration)) {
      lines.push('      <direction placement="below">');
      lines.push('        <direction-type>');
      lines.push(`          <dynamics><${decoration}/></dynamics>`);
      lines.push('        </direction-type>');
      lines.push(`        <staff>${staffNumber}</staff>`);
      lines.push('      </direction>');
    } else if (decoration === 'crescendo(' || decoration === 'diminuendo(') {
      lines.push('      <direction placement="below">');
      lines.push('        <direction-type>');
      lines.push(
        `          <wedge type="${decoration === 'crescendo(' ? 'crescendo' : 'diminuendo'}"/>`,
      );
      lines.push('        </direction-type>');
      lines.push(`        <staff>${staffNumber}</staff>`);
      lines.push('      </direction>');
    } else if (decoration === 'crescendo)' || decoration === 'diminuendo)') {
      lines.push('      <direction placement="below">');
      lines.push('        <direction-type>');
      lines.push('          <wedge type="stop"/>');
      lines.push('        </direction-type>');
      lines.push(`        <staff>${staffNumber}</staff>`);
      lines.push('      </direction>');
    }
  }
  return lines;
}

function renderStaffMeasure(
  measure: Measure | undefined,
  staffNumber: number,
  keyAlter: Record<string, number>,
): { lines: string[]; divisions: number } {
  const context: NoteContext = {
    staffNumber,
    voiceNumber: staffNumber,
    measureAccidentals: new Map(),
    keyAlter,
  };

  const lines: string[] = [];
  let total = 0;
  let tuplet: Tuplet = NO_TUPLET;

  for (const item of measure?.items ?? []) {
    if (item.el_type !== 'note') continue;
    const note = item as VoiceItemNote & {
      startTriplet?: number;
      endTriplet?: boolean;
      tripletMultiplier?: number;
      decoration?: string[];
      chord?: { name?: string; position?: string }[];
    };

    if (typeof note.startTriplet === 'number' && typeof note.tripletMultiplier === 'number') {
      tuplet = { actual: note.startTriplet, multiplier: note.tripletMultiplier };
    }

    lines.push(...renderAnnotations(note.chord, staffNumber));
    lines.push(...renderDecorations(note.decoration, staffNumber));
    lines.push(...renderNote(note, tuplet, context));
    total += divisionsOf(note.duration, tuplet.multiplier);

    if (note.endTriplet) tuplet = NO_TUPLET;
  }

  return { lines, divisions: total };
}

export type MusicXmlMeta = {
  title?: string;
  composer?: string;
  /** Rendered as a credit line under the title. */
  subtitle?: string;
};

export function toMusicXml(tune: TuneObject, meta: MusicXmlMeta = {}): string {
  const title = meta.title ?? tune.metaText.title ?? 'Untitled';
  const composer = meta.composer ?? tune.metaText.composer ?? '';
  const fifths = keyFifths(tune);
  const keyAlter = keyAlterations(fifths);
  const meter = tune.getMeterFraction();

  const staffCount = Math.max(
    1,
    ...tune.lines.filter((line) => line.staff).map((line) => line.staff?.length ?? 0),
  );

  const staffMeasures = Array.from({ length: staffCount }, (_, i) => measuresOf(tune, i));
  const measureCount = Math.max(0, ...staffMeasures.map((m) => m.length));

  const body: string[] = [];

  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    body.push(`    <measure number="${measureIndex + 1}">`);

    if (measureIndex === 0) {
      body.push('      <attributes>');
      body.push(`        <divisions>${DIVISIONS}</divisions>`);
      body.push('        <key>');
      body.push(`          <fifths>${fifths}</fifths>`);
      body.push('        </key>');
      body.push('        <time>');
      body.push(`          <beats>${meter.num}</beats>`);
      body.push(`          <beat-type>${meter.den}</beat-type>`);
      body.push('        </time>');
      body.push(`        <staves>${staffCount}</staves>`);
      for (let staff = 0; staff < staffCount; staff += 1) {
        const clefType = tune.lines.find((line) => line.staff)?.staff?.[staff]?.clef?.type;
        body.push(clefElement(clefType, staff + 1));
      }
      body.push('      </attributes>');

      const bpm = tune.getBpm();
      if (bpm > 0) {
        body.push('      <direction placement="above">');
        body.push('        <direction-type>');
        body.push('          <metronome>');
        body.push('            <beat-unit>quarter</beat-unit>');
        body.push(`            <per-minute>${Math.round(bpm)}</per-minute>`);
        body.push('          </metronome>');
        body.push('        </direction-type>');
        body.push(`        <sound tempo="${Math.round(bpm)}"/>`);
        body.push('      </direction>');
      }
    }

    for (let staff = 0; staff < staffCount; staff += 1) {
      const rendered = renderStaffMeasure(
        staffMeasures[staff]?.[measureIndex],
        staff + 1,
        keyAlter,
      );

      // Every staff after the first needs the cursor wound back to the
      // measure start, or its notes land after the previous staff's.
      if (staff > 0) {
        const previous = renderStaffMeasure(
          staffMeasures[staff - 1]?.[measureIndex],
          staff,
          keyAlter,
        );
        if (previous.divisions > 0) {
          body.push('      <backup>');
          body.push(`        <duration>${previous.divisions}</duration>`);
          body.push('      </backup>');
        }
      }

      body.push(...rendered.lines);
    }

    body.push('    </measure>');
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    '  <work>',
    `    <work-title>${escapeXml(title)}</work-title>`,
    '  </work>',
    '  <identification>',
    composer ? `    <creator type="composer">${escapeXml(composer)}</creator>` : null,
    '    <rights>Arrangement generated for personal study.</rights>',
    '    <encoding>',
    '      <software>Cadence</software>',
    `      <encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>`,
    '    </encoding>',
    '  </identification>',
    meta.subtitle
      ? `  <credit page="1"><credit-type>subtitle</credit-type><credit-words>${escapeXml(meta.subtitle)}</credit-words></credit>`
      : null,
    '  <part-list>',
    '    <score-part id="P1">',
    '      <part-name>Piano</part-name>',
    '      <score-instrument id="P1-I1">',
    '        <instrument-name>Piano</instrument-name>',
    '      </score-instrument>',
    '      <midi-instrument id="P1-I1">',
    '        <midi-channel>1</midi-channel>',
    '        <midi-program>1</midi-program>',
    '      </midi-instrument>',
    '    </score-part>',
    '  </part-list>',
    '  <part id="P1">',
    ...body,
    '  </part>',
    '</score-partwise>',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
