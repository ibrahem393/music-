import { z } from 'zod';

import { generateJson, modelFor } from '@/lib/gemini/client';
import { REPAIR_SYSTEM_INSTRUCTION, repairUserPrompt } from '@/lib/gemini/prompts';
import { RepairResultSchema, repairResponseSchema } from '@/lib/gemini/schema';

/** Repair is one short call, but it is still a Gemini call. */
export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RepairRequestSchema = z.object({
  // Comfortably inside Vercel's 4.5 MB body limit; an arrangement this long
  // would have failed validation for other reasons long before.
  abc: z.string().min(1).max(200_000),
  error: z.string().min(1).max(20_000),
  accuracy: z.enum(['fast', 'accurate']).default('fast'),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request body was not JSON.' }, 400);
  }

  const parsed = RepairRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Send { abc: string, error: string }.' }, 400);
  }

  const result = await generateJson({
    model: modelFor(parsed.data.accuracy),
    systemInstruction: REPAIR_SYSTEM_INSTRUCTION,
    parts: [{ text: repairUserPrompt(parsed.data.abc, parsed.data.error) }],
    responseSchema: repairResponseSchema,
    validate: RepairResultSchema,
    // Repair is a correctness task, not a creative one.
    temperature: 0.1,
    signal: request.signal,
  });

  if (!result.ok) {
    return json(
      { error: result.error.message, kind: result.error.kind, detail: result.error.detail },
      statusFor(result.error.kind),
    );
  }

  return json({ abc: result.value.abc, fixNote: result.value.fixNote }, 200);
}

function statusFor(kind: string): number {
  if (kind === 'rate-limited' || kind === 'quota-exhausted') return 429;
  if (kind === 'missing-api-key') return 500;
  return 502;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
