/**
 * Server-only Gemini access.
 *
 * Nothing in this module may be imported from a client component: it reads
 * GEMINI_API_KEY, which must never be bundled for the browser. The key is read
 * lazily inside the call so a missing key surfaces as a typed error at request
 * time rather than a crash at module load.
 */
import { GoogleGenAI, type Part, type Schema } from '@google/genai';
import type { z } from 'zod';

export const MODELS = {
  fast: 'gemini-2.5-flash',
  accurate: 'gemini-2.5-pro',
} as const;

export type Accuracy = keyof typeof MODELS;

export function modelFor(accuracy: Accuracy): string {
  return MODELS[accuracy];
}

// ---------------------------------------------------------------------------
// Typed errors — every failure path lands in this union, nothing is swallowed
// ---------------------------------------------------------------------------

export type GeminiErrorKind =
  | 'missing-api-key'
  | 'source-unavailable'
  | 'source-too-long'
  | 'rate-limited'
  | 'quota-exhausted'
  | 'safety-blocked'
  | 'truncated'
  | 'empty-response'
  | 'invalid-json'
  | 'schema-mismatch'
  | 'aborted'
  | 'network'
  | 'upstream';

export type GeminiError = {
  kind: GeminiErrorKind;
  /** Written for the interface: names the cause and the fix, no apology. */
  message: string;
  /** Developer-facing detail. Never rendered as the primary message. */
  detail?: string;
};

export type GeminiResult<T> = { ok: true; value: T } | { ok: false; error: GeminiError };

export const HTTP_STATUS_FOR: Record<GeminiErrorKind, number> = {
  'missing-api-key': 500,
  'source-unavailable': 422,
  'source-too-long': 422,
  'rate-limited': 429,
  'quota-exhausted': 429,
  'safety-blocked': 422,
  truncated: 502,
  'empty-response': 502,
  'invalid-json': 502,
  'schema-mismatch': 502,
  aborted: 499,
  network: 503,
  upstream: 502,
};

function err(kind: GeminiErrorKind, message: string, detail?: string): GeminiError {
  return detail === undefined ? { kind, message } : { kind, message, detail };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let cached: GoogleGenAI | null = null;

type ClientResult = { ok: true; client: GoogleGenAI } | { ok: false; error: GeminiError };

function getClient(): ClientResult {
  if (cached) return { ok: true, client: cached };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: err(
        'missing-api-key',
        'The server has no Gemini API key configured. Set GEMINI_API_KEY in the environment and redeploy.',
      ),
    };
  }

  cached = new GoogleGenAI({ apiKey });
  return { ok: true, client: cached };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type ThrownShape = { status?: number; code?: number; name?: string; message?: string };

function readThrown(e: unknown): ThrownShape {
  if (typeof e !== 'object' || e === null) {
    return { message: String(e) };
  }
  const rec = e as Record<string, unknown>;
  const status = typeof rec.status === 'number' ? rec.status : undefined;
  const code = typeof rec.code === 'number' ? rec.code : undefined;
  const name = typeof rec.name === 'string' ? rec.name : undefined;
  const message = typeof rec.message === 'string' ? rec.message : undefined;
  return { status, code, name, message };
}

/** Maps a thrown value onto the error union. Message copy is user-facing. */
export function classifyThrown(e: unknown): GeminiError {
  const { status, code, name, message } = readThrown(e);
  const detail = message ?? String(e);
  const lower = detail.toLowerCase();
  const httpStatus = status ?? code;

  if (name === 'AbortError' || lower.includes('aborted')) {
    return err('aborted', 'The request was cancelled before the model finished.', detail);
  }

  if (
    lower.includes('private') ||
    lower.includes('age-restricted') ||
    lower.includes('age restricted') ||
    lower.includes('unavailable') ||
    lower.includes('cannot access') ||
    lower.includes('failed to fetch') ||
    lower.includes('not accessible')
  ) {
    return err(
      'source-unavailable',
      'That video cannot be reached — it is private, age-restricted, or region-blocked. Try a public link, or upload the audio file instead.',
      detail,
    );
  }

  if (lower.includes('too long') || lower.includes('duration') || lower.includes('token limit')) {
    return err(
      'source-too-long',
      'That video is longer than the 10-minute cap. Link a shorter version or upload an excerpt.',
      detail,
    );
  }

  if (httpStatus === 429 || lower.includes('resource_exhausted')) {
    const exhausted = lower.includes('quota');
    return exhausted
      ? err(
          'quota-exhausted',
          'The Gemini quota for this key is spent. It resets on the billing cycle, or raise the limit in the Google AI Studio console.',
          detail,
        )
      : err('rate-limited', 'Gemini is rate-limiting this key. Wait a moment and run it again.', detail);
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return err(
      'missing-api-key',
      'Gemini rejected the API key. Check GEMINI_API_KEY is valid and has access to the 2.5 models.',
      detail,
    );
  }

  if (httpStatus !== undefined && httpStatus >= 500) {
    return err('upstream', 'Gemini returned a server error. Run it again in a minute.', detail);
  }

  if (
    name === 'TypeError' ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  ) {
    return err('network', 'Could not reach Gemini. Check the network and try again.', detail);
  }

  return err('upstream', 'Gemini could not complete the analysis. Run it again.', detail);
}

// ---------------------------------------------------------------------------
// The one call site
// ---------------------------------------------------------------------------

export type GenerateJsonOptions<T> = {
  model: string;
  systemInstruction: string;
  parts: Part[];
  responseSchema: Schema;
  /** The zod gate. A shape-valid response can still be musically nonsense. */
  validate: z.ZodType<T>;
  temperature?: number;
  signal?: AbortSignal;
};

export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<GeminiResult<T>> {
  const client = getClient();
  if (!client.ok) return { ok: false, error: client.error };

  let text: string;
  try {
    const response = await client.client.models.generateContent({
      model: opts.model,
      contents: [{ role: 'user', parts: opts.parts }],
      config: {
        systemInstruction: opts.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: opts.responseSchema,
        temperature: opts.temperature ?? 0.4,
        ...(opts.signal ? { abortSignal: opts.signal } : {}),
      },
    });

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      return {
        ok: false,
        error: err(
          'safety-blocked',
          'Gemini declined to analyse that source. Try a different recording.',
          `blockReason=${blockReason}`,
        ),
      };
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      return {
        ok: false,
        error: err(
          'truncated',
          'The model ran out of room before finishing the arrangements. Try a shorter excerpt.',
          'finishReason=MAX_TOKENS',
        ),
      };
    }
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      return {
        ok: false,
        error: err(
          'safety-blocked',
          'Gemini declined to analyse that source. Try a different recording.',
          `finishReason=${finishReason}`,
        ),
      };
    }

    const raw = response.text;
    if (!raw || raw.trim().length === 0) {
      return {
        ok: false,
        error: err(
          'empty-response',
          'Gemini returned nothing for that source. Run it again.',
          `finishReason=${finishReason ?? 'unknown'}`,
        ),
      };
    }
    text = raw;
  } catch (e: unknown) {
    return { ok: false, error: classifyThrown(e) };
  }

  return finishJson(text, opts.validate);
}

/**
 * Streaming variant. Identical validation, but `onText` sees each delta as it
 * arrives so the caller can drive progress from real output.
 */
export type GenerateJsonStreamOptions<T> = GenerateJsonOptions<T> & {
  onText: (delta: string, accumulated: string) => void | Promise<void>;
};

export async function generateJsonStream<T>(
  opts: GenerateJsonStreamOptions<T>,
): Promise<GeminiResult<T>> {
  const client = getClient();
  if (!client.ok) return { ok: false, error: client.error };

  let accumulated = '';
  let finishReason: string | undefined;

  try {
    const stream = await client.client.models.generateContentStream({
      model: opts.model,
      contents: [{ role: 'user', parts: opts.parts }],
      config: {
        systemInstruction: opts.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: opts.responseSchema,
        temperature: opts.temperature ?? 0.4,
        ...(opts.signal ? { abortSignal: opts.signal } : {}),
      },
    });

    for await (const chunk of stream) {
      const blockReason = chunk.promptFeedback?.blockReason;
      if (blockReason) {
        return {
          ok: false,
          error: err(
            'safety-blocked',
            'Gemini declined to analyse that source. Try a different recording.',
            `blockReason=${blockReason}`,
          ),
        };
      }

      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;

      const delta = chunk.text;
      if (delta) {
        accumulated += delta;
        await opts.onText(delta, accumulated);
      }
    }
  } catch (e: unknown) {
    return { ok: false, error: classifyThrown(e) };
  }

  if (finishReason === 'MAX_TOKENS') {
    return {
      ok: false,
      error: err(
        'truncated',
        'The model ran out of room before finishing the arrangements. Try a shorter excerpt.',
        'finishReason=MAX_TOKENS',
      ),
    };
  }
  if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
    return {
      ok: false,
      error: err(
        'safety-blocked',
        'Gemini declined to analyse that source. Try a different recording.',
        `finishReason=${finishReason}`,
      ),
    };
  }
  if (accumulated.trim().length === 0) {
    return {
      ok: false,
      error: err(
        'empty-response',
        'Gemini returned nothing for that source. Run it again.',
        `finishReason=${finishReason ?? 'unknown'}`,
      ),
    };
  }

  return finishJson(accumulated, opts.validate);
}

/** JSON.parse then the zod gate. Shared by both call shapes. */
export function finishJson<T>(text: string, validate: z.ZodType<T>): GeminiResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (e: unknown) {
    return {
      ok: false,
      error: err(
        'invalid-json',
        'The model returned notation that could not be read as JSON. Run it again.',
        readThrown(e).message ?? String(e),
      ),
    };
  }

  const result = validate.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: err(
        'schema-mismatch',
        'The analysis came back incomplete. Run it again — this usually clears on a second pass.',
        result.error.issues
          .slice(0, 8)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
      ),
    };
  }

  return { ok: true, value: result.data };
}

/**
 * responseMimeType: 'application/json' makes fences unlikely, not impossible.
 * Cheap insurance at the boundary.
 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}
