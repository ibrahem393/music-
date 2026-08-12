# Cadence

Paste a music video link. Get a professional musical analysis and a playable
piano score at three difficulty levels.

Cadence sends the link to Gemini, which listens to the recording, writes out the
key, tempo, form and harmony, and arranges the song for two hands at easy,
medium and hard. The notation is validated before it reaches a staff, plays back
in the browser, transposes, and exports to MusicXML and MIDI.

## Setup

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local     # then fill in GEMINI_API_KEY
pnpm dev
```

Open http://localhost:3000.

### Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Google Gemini API key, from [AI Studio](https://aistudio.google.com/apikey). Server-only — it is read exclusively inside `app/api/` route handlers and never reaches the browser. |
| `BLOB_READ_WRITE_TOKEN` | no | Vercel Blob token, for direct client uploads of audio files. Created automatically when you attach a Blob store to the project; pull it with `vercel env pull .env.local`. Without it the YouTube path works normally and the upload control explains that uploads are not configured. |

Without a key the app runs and the interface works, but every analysis returns
*"The server has no Gemini API key configured."*

### Scripts

```bash
pnpm dev         # development server
pnpm build       # production build
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
```

## How it works

```
app/
  page.tsx                 hero, URL input, streamed progress
  work/[id]/page.tsx       results workspace — analysis rail + score canvas
  api/analyze/route.ts     POST { source } -> streamed NDJSON progress + result
  api/repair/route.ts      POST { abc, error } -> corrected ABC
  api/blob/upload/route.ts issues client upload tokens; the audio never passes through it
lib/
  gemini/schema.ts         zod schema + Gemini responseSchema, single source of truth
  gemini/prompts.ts        the analysis prompt, versioned
  gemini/partial.ts        streaming JSON key scanner, drives the progress stages
  abc/validate.ts          headless structural validation of ABC
  abc/musicxml.ts          MusicXML writer
  abc/transform.ts         transpose, tempo, MIDI export
  form.ts                  form sections -> bar spans -> score bars
components/
  PitchColor.tsx           the twelve-hue chromatic system — every accent derives from here
  AnalysisPanel, FormTimeline, ScoreView, ScoreWorkspace,
  DifficultyTabs, PlaybackBar, ThemeToggle
```

**The pipeline.** The client posts a YouTube link (or a Vercel Blob URL from an
uploaded file) to `/api/analyze`. That route calls Gemini with the URL as a
`fileData` part and a `responseSchema` that fixes the JSON shape, then
re-validates through zod — a response can satisfy the wire schema and still be
musically nonsense, so the second gate rejects zero tempos, out-of-range
confidences and ABC missing its headers.

**Progress is real.** The route streams newline-delimited JSON. Stages advance
when the model actually emits that part of the document: a scanner reports
top-level JSON keys as they arrive, and because the response schema fixes
property ordering, seeing `"form"` open means the form has genuinely been
written. The same scanner closes the object just before `"scores"` and ships the
analysis while the arrangements are still being generated.

**Notation is checked, not trusted.** abcjs is extremely forgiving — unbalanced
brackets, a missing `K:` header and outright prose all parse without throwing
and mostly without warnings. So `lib/abc/validate.ts` checks structure instead:
two staves, both hands carrying material, at least 16 bars, real notes. A score
that fails gets one repair pass through `/api/repair`; if it still fails, that
level is marked unavailable with an honest reason. A broken staff is never
rendered.

**The colour system.** Twelve pitch classes, twelve fixed hues, ordered by the
circle of fifths so related keys sit next to each other and semitone neighbours
stay far apart. The detected key sets the page accent, chord symbols carry their
root's hue, the form timeline tints by each section's harmonic centre, and notes
glow in their own colour as the playback cursor passes. `components/PitchColor.tsx`
is the only place a hue is defined.

## Deployment

Deploys to Vercel with no configuration beyond the API key.

```bash
vercel                                  # link and deploy a preview
vercel env add GEMINI_API_KEY           # add the key to the project
vercel --prod
```

Six things the code depends on in production:

1. **The API key never reaches the browser.** All model calls happen in route
   handlers reading `process.env.GEMINI_API_KEY`. No `NEXT_PUBLIC_` prefix, and
   no client component imports `@google/genai`.
2. **`maxDuration = 300`** on every route that calls Gemini. Analysis takes
   30–90 seconds, and longer on 2.5 Pro. Vercel allows 300s on Hobby with fluid
   compute, which is on by default for new projects.
3. **Bodies stay under 4.5 MB.** Vercel returns 413 above it. Audio uploads
   therefore go straight from the browser to Vercel Blob; only the URL is posted
   to our route.
4. **abcjs is browser-only.** The notation workspace is loaded with
   `next/dynamic` and `ssr: false`, or the build dies on `window is not defined`.
5. **Progress is streamed** as a `ReadableStream` of NDJSON, read on the client
   with `response.body.getReader()`.
6. **No secrets in the repo.** `.env.local` is gitignored; `.env.example` carries
   key names only.

All six are asserted in `tests/constraints.test.ts`, so breaking one fails the
test suite rather than the deploy.

### Playback and the soundfont

Playback fetches instrument samples from `paulrosen.github.io`, abcjs's default
soundfont host. If that host is unreachable the transport reports it in words
rather than failing silently; everything else on the page keeps working.

## Notation notes

Two places where the ABC standard and abcjs disagree, both handled in the prompt:

- The piano brace is written `%%score {(1) (2)}`. The ids inside `%%score` must
  match the `V:` ids, so `{(V1) (V2)}` above `V:1` and `V:2` is a mismatch that
  abcjs warns about on every score.
- Pedal is written as the annotations `"_Ped."` and `"_*"`, not the `!ped!` and
  `!ped-up!` decorations. abcjs has no entry for those in its legal-accent
  table and drops them silently, so pedalling written that way would vanish from
  both the staff and the exports.

## Licence and provenance

Arrangements are generated for personal study. Every score carries
*"AI-generated arrangement — verify against the recording before performance."*
under its title, and the print footer reads *"Arrangement generated for personal
study."* Cadence does not host, store or redistribute recordings.
