import { describe, expect, it } from 'vitest';

import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT,
  checkUploadFile,
  describeUploadSize,
  parseSource,
} from '@/lib/source';

const MB = 1024 * 1024;

describe('MAX_UPLOAD_BYTES', () => {
  it('is the 20 MB cap from the brief', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20 * MB);
  });
});

describe('checkUploadFile', () => {
  it.each([
    ['take-1.mp3', 5 * MB],
    ['demo.m4a', 19.9 * MB],
    ['session.wav', 1],
    ['mix.flac', 12 * MB],
    ['clip.mp4', 3 * MB],
  ])('accepts %s', (name, size) => {
    expect(checkUploadFile({ name, size })).toBeNull();
  });

  it('refuses a file over the cap, naming the size and the fix', () => {
    const problem = checkUploadFile({ name: 'huge.wav', size: 45 * MB });
    expect(problem).not.toBeNull();
    expect(problem).toMatch(/45\.0 MB/);
    expect(problem).toMatch(/limit is 20 MB/);
    expect(problem).toMatch(/trim the excerpt|lower bitrate/);
  });

  it('refuses a file type we cannot read, naming what we can', () => {
    const problem = checkUploadFile({ name: 'notes.pdf', size: 1 * MB });
    expect(problem).toMatch(/MP3, M4A, WAV/);
  });

  it('refuses an empty file', () => {
    expect(checkUploadFile({ name: 'empty.mp3', size: 0 })).toMatch(/empty/i);
  });

  it('accepts a file exactly at the cap but not one byte over', () => {
    expect(checkUploadFile({ name: 'edge.mp3', size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(checkUploadFile({ name: 'edge.mp3', size: MAX_UPLOAD_BYTES + 1 })).not.toBeNull();
  });

  it('is case-insensitive about the extension', () => {
    expect(checkUploadFile({ name: 'TAKE.MP3', size: MB })).toBeNull();
  });
});

describe('the picker and the token issuer agree', () => {
  it('every accepted MIME type has an extension parseSource can read back', () => {
    // A token issued for a type whose Blob URL we later reject would strand
    // the upload after it had already been paid for.
    const url = (ext: string) => `https://abc.public.blob.vercel-storage.com/take.${ext}`;
    for (const ext of ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus', 'mp4', 'webm']) {
      expect(parseSource(url(ext)).ok, `${ext} should round-trip`).toBe(true);
    }
  });

  it('the accept attribute names the same formats the copy promises', () => {
    for (const ext of ['.mp3', '.m4a', '.wav', '.flac', '.mp4']) {
      expect(UPLOAD_ACCEPT).toContain(ext);
    }
  });

  it('allows only audio and video types', () => {
    for (const type of ALLOWED_UPLOAD_MIME_TYPES) {
      expect(type).toMatch(/^(audio|video)\//);
    }
  });
});

describe('describeUploadSize', () => {
  it('reads in megabytes to one decimal', () => {
    expect(describeUploadSize(20 * MB)).toBe('20.0 MB');
    expect(describeUploadSize(1.5 * MB)).toBe('1.5 MB');
    expect(describeUploadSize(45 * MB)).toBe('45.0 MB');
  });
});
