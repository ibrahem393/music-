import abcjs from 'abcjs';
import { describe, expect, it } from 'vitest';

import {
  durationToType,
  escapeXml,
  keyAlterations,
  keyFifths,
  pitchToStepOctave,
  toMusicXml,
} from '@/lib/abc/musicxml';

function parse(abc: string) {
  const tune = abcjs.parseOnly(abc)[0];
  if (!tune) throw new Error('fixture failed to parse');
  return tune;
}

function piano(body: string, key = 'C', meter = '4/4'): string {
  return [
    'X:1',
    'T:Test Tune',
    'C:A Composer',
    `M:${meter}`,
    'L:1/8',
    'Q:1/4=96',
    `K:${key}`,
    '%%score {(1) (2)}',
    'V:1 clef=treble',
    'V:2 clef=bass',
    body,
  ].join('\n');
}

const SIMPLE = piano('[V:1] CDEF GABc | cBAG FEDC |]\n[V:2] C,2 G,2 C,2 G,2 | C,2 G,2 C,4 |]');

/** Divisions in one 4/4 measure at 768 divisions per quarter. */
const MEASURE_DIVISIONS = 4 * 768;

/** Sums <duration> elements for one voice inside a measure block. */
function voiceDurations(xml: string, measureNumber: number, voice: number): number {
  const block = xml.split(`<measure number="${measureNumber}">`)[1]?.split('</measure>')[0] ?? '';
  let total = 0;
  for (const note of block.split('<note>').slice(1)) {
    if (!note.includes(`<voice>${voice}</voice>`)) continue;
    // Chord members sound together; only the first carries the time.
    if (note.includes('<chord/>')) continue;
    const match = note.match(/<duration>(\d+)<\/duration>/);
    if (match?.[1]) total += Number(match[1]);
  }
  return total;
}

describe('pitchToStepOctave', () => {
  it('places abcjs pitch 0 at middle C', () => {
    expect(pitchToStepOctave(0)).toEqual({ step: 'C', octave: 4 });
  });

  it.each([
    [1, 'D', 4],
    [6, 'B', 4],
    [7, 'C', 5],
    [14, 'C', 6],
    [-1, 'B', 3],
    [-7, 'C', 3],
    [-8, 'B', 2],
  ])('maps pitch %i to %s%i', (pitch, step, octave) => {
    expect(pitchToStepOctave(pitch)).toEqual({ step, octave });
  });
});

describe('durationToType', () => {
  it.each([
    [1, 'whole', 0],
    [0.5, 'half', 0],
    [0.25, 'quarter', 0],
    [0.125, 'eighth', 0],
    [0.0625, '16th', 0],
    [0.03125, '32nd', 0],
    [0.375, 'quarter', 1],
    [0.75, 'half', 1],
    [0.4375, 'quarter', 2],
  ])('maps duration %s to %s with %i dot(s)', (duration, type, dots) => {
    expect(durationToType(duration)).toEqual({ type, dots });
  });

  it('falls back to the nearest type for an unrepresentable duration', () => {
    const result = durationToType(0.1);
    expect(result.dots).toBe(0);
    expect(typeof result.type).toBe('string');
  });
});

describe('keyFifths and keyAlterations', () => {
  it.each([
    ['C', 0],
    ['G', 1],
    ['D', 2],
    ['F', -1],
    ['Bb', -2],
    ['Eb', -3],
    ['F#m', 3],
  ])('reads K:%s as %i fifths', (key, fifths) => {
    expect(keyFifths(parse(`X:1\nT:t\nM:4/4\nK:${key}\nC|\n`))).toBe(fifths);
  });

  it('gives F sharp in G major and B flat in F major', () => {
    expect(keyAlterations(1)).toEqual({ F: 1 });
    expect(keyAlterations(-1)).toEqual({ B: -1 });
  });

  it('gives all three flats of E flat major', () => {
    expect(keyAlterations(-3)).toEqual({ B: -1, E: -1, A: -1 });
  });
});

describe('toMusicXml — document structure', () => {
  const xml = toMusicXml(parse(SIMPLE));

  it('declares a partwise score', () => {
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml.trimEnd().endsWith('</score-partwise>')).toBe(true);
  });

  it('carries the title and composer from the tune', () => {
    expect(xml).toContain('<work-title>Test Tune</work-title>');
    expect(xml).toContain('<creator type="composer">A Composer</creator>');
  });

  it('declares two staves with treble and bass clefs', () => {
    expect(xml).toContain('<staves>2</staves>');
    expect(xml).toMatch(/<clef number="1">\s*<sign>G<\/sign>\s*<line>2<\/line>/);
    expect(xml).toMatch(/<clef number="2">\s*<sign>F<\/sign>\s*<line>4<\/line>/);
  });

  it('emits one measure per bar', () => {
    expect(xml.match(/<measure number="\d+">/g)).toHaveLength(2);
  });

  it('carries the tempo as a metronome direction', () => {
    expect(xml).toContain('<per-minute>96</per-minute>');
  });

  it('states the study-only provenance', () => {
    expect(xml).toContain('Arrangement generated for personal study.');
  });

  it('is well-formed enough to parse as XML', () => {
    // No dependency on a parser here — check the tag stack balances.
    const tags = xml.match(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*?)?\/?>/g) ?? [];
    const stack: string[] = [];
    for (const tag of tags) {
      if (tag.startsWith('<?') || tag.startsWith('<!') || tag.endsWith('/>')) continue;
      if (tag.startsWith('</')) {
        expect(stack.pop()).toBe(tag.slice(2, -1));
      } else {
        stack.push(tag.slice(1).split(/[\s>]/)[0] as string);
      }
    }
    expect(stack).toEqual([]);
  });
});

describe('toMusicXml — the measures add up', () => {
  it('gives each voice a full measure of 4/4', () => {
    const xml = toMusicXml(parse(SIMPLE));
    for (const measure of [1, 2]) {
      expect(voiceDurations(xml, measure, 1), `treble measure ${measure}`).toBe(MEASURE_DIVISIONS);
      expect(voiceDurations(xml, measure, 2), `bass measure ${measure}`).toBe(MEASURE_DIVISIONS);
    }
  });

  it('winds the cursor back between staves so the hands align', () => {
    const xml = toMusicXml(parse(SIMPLE));
    const backups = xml.match(/<backup>\s*<duration>(\d+)<\/duration>/g) ?? [];
    expect(backups).toHaveLength(2);
    for (const backup of backups) expect(backup).toContain(`<duration>${MEASURE_DIVISIONS}</duration>`);
  });

  it('keeps triplets adding up to their written beat', () => {
    const xml = toMusicXml(parse(piano('[V:1] (3CDE (3FGA (3cde (3fga |]\n[V:2] C,8 |]')));
    expect(xml).toContain('<actual-notes>3</actual-notes>');
    expect(xml).toContain('<normal-notes>2</normal-notes>');
    expect(voiceDurations(xml, 1, 1)).toBe(MEASURE_DIVISIONS);
  });

  it('handles 3/4 as readily as 4/4', () => {
    const xml = toMusicXml(parse(piano('[V:1] CDEFGA |]\n[V:2] C,6 |]', 'C', '3/4')));
    expect(xml).toContain('<beats>3</beats>');
    expect(xml).toContain('<beat-type>4</beat-type>');
    expect(voiceDurations(xml, 1, 1)).toBe(3 * 768);
  });
});

describe('toMusicXml — accidentals sound right', () => {
  it('applies the key signature to unmarked notes', () => {
    // In G major, a written F is F sharp.
    const xml = toMusicXml(parse(piano('[V:1] FFFF FFFF |]\n[V:2] G,8 |]', 'G')));
    const notes = xml.split('<note>').filter((n) => n.includes('<step>F</step>'));
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note).toContain('<alter>1</alter>');
  });

  it('carries an explicit accidental for the rest of the measure', () => {
    // ^F then plain F in the same measure: both sound F sharp.
    const xml = toMusicXml(parse(piano('[V:1] ^FF FF FFFF |]\n[V:2] C,8 |]')));
    const first = xml.split('<measure number="1">')[1]?.split('</measure>')[0] ?? '';
    const fNotes = first.split('<note>').filter((n) => n.includes('<step>F</step>'));
    expect(fNotes.length).toBe(8);
    for (const note of fNotes) expect(note).toContain('<alter>1</alter>');
  });

  it('resets accidentals at the bar line', () => {
    const xml = toMusicXml(parse(piano('[V:1] ^FFFF FFFF | FFFF FFFF |]\n[V:2] C,8 | C,8 |]')));
    const second = xml.split('<measure number="2">')[1]?.split('</measure>')[0] ?? '';
    const fNotes = second.split('<note>').filter((n) => n.includes('<step>F</step>'));
    expect(fNotes.length).toBeGreaterThan(0);
    for (const note of fNotes) expect(note).not.toContain('<alter>');
  });

  it('writes a natural against the key signature', () => {
    const xml = toMusicXml(parse(piano('[V:1] =FFFF FFFF |]\n[V:2] G,8 |]', 'G')));
    const notes = xml.split('<note>').filter((n) => n.includes('<step>F</step>'));
    for (const note of notes) expect(note).not.toContain('<alter>');
    expect(xml).toContain('<accidental>natural</accidental>');
  });
});

describe('toMusicXml — musical detail survives', () => {
  it('writes chords with a chord element on each member after the first', () => {
    const xml = toMusicXml(parse('X:1\nT:t\nM:4/4\nL:1/4\nK:C\nV:1\n[CEG]4 |]\n'));
    const notes = xml.split('<note>').slice(1);
    expect(notes.filter((n) => n.includes('<chord/>'))).toHaveLength(2);
    expect(voiceDurations(xml, 1, 1)).toBe(MEASURE_DIVISIONS);
  });

  it('carries ties on both ends', () => {
    const xml = toMusicXml(parse(piano('[V:1] C4-C4 | C8 |]\n[V:2] C,8 | C,8 |]')));
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    expect(xml).toContain('<tied type="start"/>');
  });

  it('carries slurs with matching numbers', () => {
    const xml = toMusicXml(parse(piano('[V:1] (CDEF) GABc |]\n[V:2] C,8 |]')));
    expect(xml).toMatch(/<slur type="start" number="\d+"\/>/);
    expect(xml).toMatch(/<slur type="stop" number="\d+"\/>/);
  });

  it('turns dynamics into directions', () => {
    const xml = toMusicXml(parse(piano('[V:1] !mf! CDEF GABc |]\n[V:2] C,8 |]')));
    expect(xml).toContain('<dynamics><mf/></dynamics>');
  });

  it('turns pedal annotations into pedal directions', () => {
    // abcjs drops the !ped! / !ped-up! decorations the ABC standard defines,
    // so the prompt asks for below-staff annotations instead.
    const xml = toMusicXml(parse(piano('[V:1] CDEF GABc |]\n[V:2] "_Ped." C,4 "_*" G,4 |]')));
    expect(xml).toContain('<pedal type="start" line="no"/>');
    expect(xml).toContain('<pedal type="stop" line="no"/>');
  });

  it('ignores the pedal decorations abcjs silently drops', () => {
    // Documents the engine limitation that motivated the annotation spelling:
    // nothing reaches the export, so nothing may be invented for it either.
    const xml = toMusicXml(parse(piano('[V:1] CDEF GABc |]\n[V:2] !ped! C,4 !ped-up! G,4 |]')));
    expect(xml).not.toContain('<pedal');
  });

  it('writes rests as rests, not as silence', () => {
    const xml = toMusicXml(parse(piano('[V:1] z4 CDEF |]\n[V:2] C,8 |]')));
    expect(xml).toContain('<rest/>');
    expect(voiceDurations(xml, 1, 1)).toBe(MEASURE_DIVISIONS);
  });
});

describe('escapeXml', () => {
  it('escapes the five predefined entities', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('keeps a title with an ampersand from breaking the document', () => {
    const xml = toMusicXml(parse(SIMPLE), { title: 'Rock & Roll <b>' });
    expect(xml).toContain('<work-title>Rock &amp; Roll &lt;b&gt;</work-title>');
    expect(xml).not.toMatch(/<work-title>[^<]*<b>/);
  });
});
