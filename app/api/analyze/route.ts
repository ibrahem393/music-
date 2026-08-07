import type { Part } from '@google/genai';

import { generateJsonStream, modelFor } from '@/lib/gemini/client';
import { ANALYSIS_SYSTEM_INSTRUCTION, ANALYSIS_USER_PROMPT } from '@/lib/gemini/prompts';
import { AnalysisOnlySchema, AnalysisResultSchema, analysisResponseSchema } from '@/lib/gemini/schema';
import { TopLevelKeyScanner, sliceBefore } from '@/lib/gemini/partial';
import { encodeEvent, STAGE_LABEL, type ProgressEvent, type StageId } from '@/lib/progress';
import { AnalyzeRequestSchema, parseSource, workId } from '@/lib/source';

/**
 * Analysis runs 30-90s. Vercel allows 300s on Hobby with fluid compute, which
 * is on by default for new projects. Without this the function is killed at the
 * default limit mid-analysis.
 */
export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which top-level key of the response, once it starts streaming, means we have
 * moved on to the next real stage of work.
 */
const STAGE_FOR_KEY: Record<string, StageId> = {
  track: 'listening',
  musical: 'listening',
  form: 'mapping',
  scores: 'arranging',
};

const HEARTBEAT_MS = 5000;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('bad-request', 'The request body was not JSON.', 400);
  }

  const parsedBody = AnalyzeRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return errorResponse('bad-request', 'Send { source: string, accuracy?: "fast" | "accurate" }.', 400);
  }

  const source = parseSource(parsedBody.data.source);
  if (!source.ok) {
    return errorResponse('bad-request', source.error.message, 400);
  }

  const id = workId(source.source);
  const model = modelFor(parsedBody.data.accuracy);
  const startedAt = Date.now();

  const parts: Part[] = [
    { fileData: { fileUri: source.source.uri, mimeType: source.source.mimeType } },
    { text: ANALYSIS_USER_PROMPT },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ProgressEvent): void => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };
      const elapsed = (): number => Date.now() - startedAt;

      // Keeps the connection warm while Gemini ingests the video, which can
      // take the better part of a minute before the first token.
      const heartbeat = setInterval(() => {
        send({ type: 'heartbeat', elapsedMs: elapsed() });
      }, HEARTBEAT_MS);

      send({ type: 'stage', stage: 'fetching', label: STAGE_LABEL.fetching, elapsedMs: elapsed() });

      const scanner = new TopLevelKeyScanner();
      const seen = new Set<StageId>(['fetching']);
      let analysisSent = false;

      try {
        const result = await generateJsonStream({
          model,
          systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
          parts,
          responseSchema: analysisResponseSchema,
          validate: AnalysisResultSchema,
          signal: request.signal,
          onText: (delta, accumulated) => {
            for (const key of scanner.push(delta)) {
              const stage = STAGE_FOR_KEY[key.name];
              if (stage && !seen.has(stage)) {
                seen.add(stage);
                send({ type: 'stage', stage, label: STAGE_LABEL[stage], elapsedMs: elapsed() });
              }

              // Everything before `scores` is the analysis. Close the object
              // there and ship it, so the panel populates while the
              // arrangements are still being written.
              if (key.name === 'scores' && !analysisSent) {
                const partial = sliceBefore(accumulated, key.start);
                const analysis = partial === null ? null : AnalysisOnlySchema.safeParse(partial);
                if (analysis?.success) {
                  analysisSent = true;
                  send({ type: 'analysis', analysis: analysis.data, elapsedMs: elapsed() });
                }
              }
            }
          },
        });

        if (result.ok) {
          send({ type: 'result', id, result: result.value, elapsedMs: elapsed() });
        } else {
          send({
            type: 'error',
            kind: result.error.kind,
            message: result.error.message,
            ...(result.error.detail ? { detail: result.error.detail } : {}),
          });
        }
      } finally {
        clearInterval(heartbeat);
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      // NDJSON, streamed. No buffering anywhere in the path.
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Failures known before the stream opens get a plain JSON body and a real
 * status code. Once the stream is open the transport is already 200, so errors
 * travel as an 'error' event instead.
 */
function errorResponse(kind: 'bad-request', message: string, status: number): Response {
  const event: ProgressEvent = { type: 'error', kind, message };
  return new Response(JSON.stringify(event), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
