# Claude Code brief — Cadence

## What we're building

Cadence — paste a music video link, get a professional musical analysis and a playable piano score at three difficulty levels. Next.js app deployed to Vercel.

## Hard constraints — these are deployment requirements, not preferences

Every one of these is something that breaks in production if you get it wrong. Treat them as tests the code must pass.

1. The Gemini API key never reaches the browser. All model calls happen in Route Handlers under `app/api/`. Read `process.env.GEMINI_API_KEY` — never `NEXT_PUBLIC_`. If any client component imports `@google/genai`, that's a bug.
2. `export const maxDuration = 300` on every route that calls Gemini. Analysis takes 30–90 seconds. Vercel allows 300s on Hobby with fluid compute, which is on by default for new projects.
3. Request and response bodies stay under 4.5 MB. That's Vercel's hard limit and it returns 413 above it. Audio file uploads therefore do not go through our API route — the client uploads to Vercel Blob (`@vercel/blob/client`, `upload()`), gets a URL back, and passes only the URL to our route. Cap uploads at 20 MB with a clear message above that.
4. abcjs is browser-only. Import it with `next/dynamic` and `ssr: false`, or the build dies on `window is not defined`.
5. Stream the analysis progress. The route returns a `ReadableStream` of newline-delimited JSON progress events so the UI shows real stages instead of a 90-second spinner. Client reads it with `response.body.getReader()`.
6. No secrets in the repo. `.env.local` is gitignored; ship `.env.example` with the key names only.

## Stack

Next.js 15 App Router, TypeScript strict mode, Tailwind v4, `@google/genai`, `abcjs`, `@vercel/blob`, `zod` for schema validation. pnpm. No component library — write the components.

## Architecture

```
app/
  page.tsx                    input + hero, client component
  work/[id]/page.tsx          results workspace
  api/
    analyze/route.ts          POST { source } -> streamed progress + final AnalysisResult
    repair/route.ts           POST { abc, error } -> corrected ABC string
lib/
  gemini/client.ts            SDK init, model selection
  gemini/prompts.ts           the analysis prompt, versioned as a const
  gemini/schema.ts            zod schema + responseSchema, single source of truth
  abc/validate.ts             parse-check ABC, headless
  abc/transform.ts            transpose, tempo, MusicXML + MIDI export
components/
  UrlInput, ProgressRail, AnalysisPanel, FormTimeline,
  ScoreView, DifficultyTabs, PlaybackBar, PitchColor
```

## Pipeline

1. Client POSTs a YouTube URL (validated as a well-formed public link) or a Blob URL from an uploaded audio file.
2. `/api/analyze` calls Gemini with the URL as a `fileData` part (`fileUri` = the URL, `mimeType: "video/*"`). Model: `gemini-2.5-flash` by default, `gemini-2.5-pro` when the client requests high-accuracy mode.
3. Use `responseMimeType: "application/json"` with a `responseSchema` so the structure is guaranteed, then parse through zod as a second gate — a schema-conforming response can still be musically nonsense.
4. Stream progress events as work completes. Emit the analysis before the scores so the panel populates while arrangements are still being written.
5. Client validates each level's ABC with `abcjs.renderAbc` on a detached node inside try/catch. On failure, one call to `/api/repair` with the broken ABC and the parser error, asking for corrected ABC only. Second failure: mark that level unavailable with an honest message. Never render a broken staff.

## Data shape

```ts
type AnalysisResult = {
  track: { title: string; artist: string; genre: string; eraOrStyle: string };
  musical: {
    key: string; keyConfidence: number; mode: string;
    modulations: { toKey: string; atBar: number; note: string }[];
    tempoBpm: number; timeSignature: string; meterChanges: string[]; feel: string;
  };
  form: { section: string; startTime: string; endTime: string; bars: number; description: string }[];
  harmony: { section: string; chordSymbols: string[]; romanNumerals: string[] }[];
  instrumentation: string[];
  texture: string;
  melody: { range: string; contour: string; motifs: string[]; phraseLength: string };
  productionNotes: string[];
  arrangementDecisions: string[];
  transcriptionConfidence: number;
  confidenceReason: string;
  scores: Record<'easy' | 'medium' | 'hard', {
    abc: string; suggestedTempo: number; difficultyNote: string; keyChanged: boolean;
  }>;
};
```

## ABC output requirements

State these in the prompt: valid ABC 2.1, two staves in a piano brace (`%%score {(V1) (V2)}`, `V:1 clef=treble`, `V:2 clef=bass`), complete `X: T: C: M: L: Q: K:` headers, bar lines every measure, minimum 16 bars per level, dynamics and pedal as decorations, returned as a single JSON string with escaped newlines and no markdown fences.

## Difficulty levels — define them musically

* **Easy** — melody in the right hand, root-position or single-note left hand. Keys capped at two accidentals; transpose if needed and set `keyChanged: true`. No hand crossing, no leaps beyond an octave, quarter and eighth notes, five-finger positions where the melody allows.
* **Medium** — original key. Melody harmonized in thirds and sixths, broken-chord or Alberti left hand, basic pedal marks, sixteenths and simple syncopation, roughly two octaves per hand.
* **Hard** — countermelodies and inner voices, extended and altered harmony, arpeggiated figuration across the keyboard, rubato and dynamic shaping, voicings a concert pianist would recognise.

## Analysis panel

Scannable cards, each one populated or omitted — never an empty card with a dash in it. Key and mode with confidence, modulations and their bar numbers, tempo, meter, groove. A horizontal form timeline with timestamps and bar counts, clickable to scroll the score to that section. Chord progressions per section in both Roman numerals and chord symbols. Instrumentation, texture, melodic character. Production notes. And arrangement decisions — what got condensed for two hands and what got cut. That card is always populated; it's the honest one.

`transcriptionConfidence` renders as a quiet badge with its one-line reason, not a warning banner. Under the score title, always: "AI-generated arrangement — verify against the recording before performance." The print footer reads "Arrangement generated for personal study."

## Score view

Responsive abcjs render that scales to mobile. Play/pause via abcjs synth, tempo slider 40–200 BPM, bar cursor highlighting, section looping driven by the form timeline. Client-side transpose −6 to +6 semitones with instant re-render. Downloads: MusicXML, MIDI, and a print stylesheet producing clean A4/Letter — no UI chrome, title block on page one, page numbers after, and systems never split across a page break.

## Design direction

Bright, saturated, musical, disciplined. Not a generic SaaS gradient page.

**Signature: the chromatic colour system.** Twelve pitch classes, twelve fixed hues around a wheel. The detected key sets the page accent. Chord symbols carry their root's hue. The form timeline tints by each section's harmonic centre. Notes glow in their pitch colour as the cursor passes. One idea, applied everywhere — that's what people remember. Put it in `components/PitchColor.tsx` as the single source of truth and derive every accent from it.

**Palette** — ink `#161029`, paper `#FBF8FF`, accents violet `#7B5CFF`, magenta `#FF3D9A`, cyan `#00D4E0`, marigold `#FFC145`, lime `#A8E10C`. Light by default, dark mode toggle, score always on white.

**Type** — display Bricolage Grotesque used large and tight-tracked; body Public Sans; timestamps, chord symbols and BPM in Space Mono. Load via `next/font/google`.

**Layout** — full-bleed hero, the URL field as the single focal element, twelve coloured bars breathing at different rates while idle. After analysis, a two-column workspace: sticky analysis rail left, score canvas right, stacked on mobile.

**Motion** — one orchestrated moment. Results arrive, the form timeline draws left to right section by section, then the staff fades in. Everything else quiet. Honour `prefers-reduced-motion`.

## Copy

Progress stages name real work: "Fetching the video" → "Listening for key and tempo" → "Mapping the form" → "Writing three arrangements". Errors name the cause and the fix in the interface's voice — private or age-restricted video, video over the 10-minute cap, rate limit, unparseable notation. No apologies, no vagueness. Empty state offers three example links to click.

## Quality floor

Responsive to 375px. Visible focus rings, semantic landmarks, `aria-live` on the progress region, full keyboard reach. Typed error unions on every Gemini call — no `any`, no silent catches. Vitest covering the zod schema, the ABC validator, and the transpose function.

## Phases — stop after each and wait for me

1. **Scaffold + pipeline.** Project setup, the analyze route, schema, and a bare page that dumps raw JSON. Prove the Gemini call works end to end before any styling exists.
2. **Notation.** abcjs rendering, validation and repair loop, difficulty tabs, playback, transpose, exports.
3. **Analysis panel + form timeline**, wired to scroll the score.
4. **Design pass.** Apply the palette, type, and chromatic colour system across everything built so far.
5. **Ship.** Print stylesheet, `.env.example`, README with setup steps, `vercel.json` if needed, deploy and verify against the six hard constraints.

Ask me before adding any dependency not listed above.
