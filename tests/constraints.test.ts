import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The six hard constraints from BRIEF.md, as tests rather than good intentions.
 * Each one is something that breaks in production, so each one gets a guard
 * that fails the suite rather than the deploy.
 *
 * Constraints 3 (Blob upload path) and 4 (abcjs via next/dynamic) are asserted
 * conditionally — they have nothing to bite on until Phase 2 introduces the
 * upload and the score view, and they start biting the moment it does.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.next', '.git', 'out', 'coverage']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(ROOT).map((path) => ({
  path,
  rel: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}));

const isClientComponent = (text: string): boolean => /^\s*['"]use client['"]/.test(text);
const isTest = (rel: string): boolean => rel.startsWith('tests/');

describe('constraint 1 — the Gemini key never reaches the browser', () => {
  it('no client component imports the Gemini SDK', () => {
    const offenders = FILES.filter(
      (f) => isClientComponent(f.text) && /from\s+['"]@google\/genai['"]/.test(f.text),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('no client component imports the server-side Gemini client', () => {
    const offenders = FILES.filter(
      (f) =>
        isClientComponent(f.text) &&
        // A type-only import is erased at build time and is fine.
        /^(?!.*\bimport type\b).*from\s+['"]@\/lib\/gemini\/client['"]/m.test(f.text),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('no client component reads the key from the environment', () => {
    const offenders = FILES.filter(
      (f) => isClientComponent(f.text) && /process\.env\.GEMINI_API_KEY/.test(f.text),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('the key is never exposed under a NEXT_PUBLIC_ name', () => {
    const offenders = FILES.filter((f) => !isTest(f.rel) && /NEXT_PUBLIC_\w*GEMINI/i.test(f.text)).map(
      (f) => f.rel,
    );
    expect(offenders).toEqual([]);
  });

  it('the key is only read inside app/api', () => {
    const offenders = FILES.filter(
      (f) =>
        !isTest(f.rel) &&
        /process\.env\.GEMINI_API_KEY/.test(f.text) &&
        !f.rel.startsWith('app/api/') &&
        !f.rel.startsWith('lib/gemini/'),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe('constraint 2 — maxDuration on every route that calls Gemini', () => {
  const routes = FILES.filter((f) => /^app\/api\/.*route\.ts$/.test(f.rel));

  it('there is at least one API route', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes.map((r) => r.rel))('%s exports maxDuration = 300', (rel) => {
    const file = routes.find((r) => r.rel === rel);
    expect(file?.text).toMatch(/export\s+const\s+maxDuration\s*=\s*300\b/);
  });
});

describe('constraint 3 — audio never travels through our API route', () => {
  it('no API route accepts a file upload body', () => {
    const offenders = FILES.filter(
      (f) => /^app\/api\/.*route\.ts$/.test(f.rel) && /formData\(\)|arrayBuffer\(\)|request\.blob\(/.test(f.text),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('uploads, once implemented, go direct to Blob from the client', () => {
    const uploaders = FILES.filter((f) => /@vercel\/blob/.test(f.text) && !isTest(f.rel));
    for (const file of uploaders) {
      // The client-side entrypoint is the only correct one: the server route
      // variant would put the bytes back through the 4.5 MB body limit.
      expect(file.text, `${file.rel} must import @vercel/blob/client`).toMatch(
        /@vercel\/blob\/client/,
      );
    }
  });
});

describe('constraint 4 — abcjs is browser-only', () => {
  it('abcjs is never imported into a server component or route', () => {
    const offenders = FILES.filter(
      (f) =>
        !isTest(f.rel) &&
        /from\s+['"]abcjs/.test(f.text) &&
        !isClientComponent(f.text) &&
        !/import\s*\(/.test(f.text),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('any component rendering abcjs is loaded with ssr: false', () => {
    const dynamicUsers = FILES.filter((f) => /next\/dynamic/.test(f.text) && /abc/i.test(f.text));
    for (const file of dynamicUsers) {
      expect(file.text, `${file.rel} must pass ssr: false`).toMatch(/ssr:\s*false/);
    }
  });
});

describe('constraint 5 — progress is streamed', () => {
  it('the analyze route returns a ReadableStream, not a buffered body', () => {
    const route = FILES.find((f) => f.rel === 'app/api/analyze/route.ts');
    expect(route?.text).toMatch(/new ReadableStream/);
    expect(route?.text).toMatch(/application\/x-ndjson/);
  });

  it('the client reads it with a stream reader', () => {
    const client = FILES.find((f) => f.rel === 'lib/client/runAnalysis.ts');
    expect(client?.text).toMatch(/response\.body\.getReader\(\)/);
  });
});

describe('constraint 6 — no secrets in the repo', () => {
  const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');

  it('.env.local is gitignored', () => {
    expect(gitignore).toMatch(/^\.env\.local$/m);
  });

  it('.env.example names the keys and holds no values', () => {
    const assignments = envExample
      .split('\n')
      .filter((line) => /^[A-Z0-9_]+=/.test(line.trim()));
    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) {
      expect(line.trim(), `${line} must have an empty value`).toMatch(/^[A-Z0-9_]+=$/);
    }
    expect(assignments.some((l) => l.startsWith('GEMINI_API_KEY='))).toBe(true);
  });

  it('no source file contains a literal API key', () => {
    const offenders = FILES.filter((f) => /AIza[0-9A-Za-z_-]{20,}/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
