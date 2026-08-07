import { describe, expect, it } from 'vitest';

import { TopLevelKeyScanner, sliceBefore } from '@/lib/gemini/partial';

function scanAll(text: string, chunkSize: number): string[] {
  const scanner = new TopLevelKeyScanner();
  const found: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    for (const key of scanner.push(text.slice(i, i + chunkSize))) found.push(key.name);
  }
  return found;
}

describe('TopLevelKeyScanner', () => {
  const doc = JSON.stringify({
    track: { title: 'A', nested: { key: 'v' } },
    form: [{ section: 'Verse', bars: 8 }],
    texture: 'layered',
    scores: { easy: { abc: 'X:1' } },
  });

  it('reports only top-level keys, not nested ones', () => {
    expect(scanAll(doc, doc.length)).toEqual(['track', 'form', 'texture', 'scores']);
  });

  it.each([1, 3, 7, 64])('gives the same answer at chunk size %i', (size) => {
    expect(scanAll(doc, size)).toEqual(['track', 'form', 'texture', 'scores']);
  });

  it('is not fooled by key names appearing inside string values', () => {
    const tricky = JSON.stringify({
      productionNotes: ['the "scores" are mixed loud', 'form: unusual'],
      scores: { easy: 1 },
    });
    expect(scanAll(tricky, 5)).toEqual(['productionNotes', 'scores']);
  });

  it('is not fooled by escaped quotes in values', () => {
    const tricky = JSON.stringify({ note: 'a \\"scores\\": fake', scores: 1 });
    expect(scanAll(tricky, 2)).toEqual(['note', 'scores']);
  });

  it('reports the offset where the key starts', () => {
    const scanner = new TopLevelKeyScanner();
    scanner.push(doc);
    const start = scanner.startOf('scores');
    expect(start).not.toBeNull();
    expect(doc.slice(start as number, (start as number) + 8)).toBe('"scores"');
  });

  it('returns null for a key it never saw', () => {
    const scanner = new TopLevelKeyScanner();
    scanner.push(doc);
    expect(scanner.startOf('harmony')).toBeNull();
  });
});

describe('sliceBefore', () => {
  it('closes a partial object into something parseable', () => {
    const scanner = new TopLevelKeyScanner();
    const partial = '{"texture":"layered","instrumentation":["piano"],"scores":{"easy":';
    scanner.push(partial);
    const start = scanner.startOf('scores');
    expect(start).not.toBeNull();

    const value = sliceBefore(partial, start as number);
    expect(value).toEqual({ texture: 'layered', instrumentation: ['piano'] });
  });

  it('returns null when the head does not parse', () => {
    expect(sliceBefore('{"a":{"b":', 10)).toBeNull();
  });

  it('returns null on an empty head', () => {
    expect(sliceBefore('', 0)).toBeNull();
  });
});
