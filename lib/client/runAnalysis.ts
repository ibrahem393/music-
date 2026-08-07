import { createEventParser, type ProgressEvent } from '@/lib/progress';

/**
 * Browser side of the NDJSON protocol.
 *
 * Nothing here touches @google/genai — the key lives on the server and the
 * client only ever sees the stream. Imports from lib/gemini are type-only and
 * erased at build time.
 */
export type AnalysisHandlers = {
  onEvent: (event: ProgressEvent) => void;
};

export async function runAnalysis(
  input: { source: string; accuracy: 'fast' | 'accurate' },
  handlers: AnalysisHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  } catch {
    handlers.onEvent({
      type: 'error',
      kind: 'network',
      message: 'Could not reach the server. Check your connection and try again.',
    });
    return;
  }

  // Pre-stream failures come back as a single JSON object with a real status.
  if (!response.ok) {
    const fallback: ProgressEvent = {
      type: 'error',
      kind: 'bad-request',
      message: `The request failed (${response.status}).`,
    };
    try {
      const body: unknown = await response.json();
      handlers.onEvent(isProgressEvent(body) ? body : fallback);
    } catch {
      handlers.onEvent(fallback);
    }
    return;
  }

  if (!response.body) {
    handlers.onEvent({
      type: 'error',
      kind: 'network',
      message: 'The server sent no stream. Try again.',
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parse = createEventParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parse(decoder.decode(value, { stream: true }))) {
        handlers.onEvent(event);
      }
    }
    for (const event of parse(decoder.decode())) {
      handlers.onEvent(event);
    }
  } catch {
    if (signal?.aborted) return;
    handlers.onEvent({
      type: 'error',
      kind: 'network',
      message: 'The connection dropped mid-analysis. Run it again.',
    });
  } finally {
    reader.releaseLock();
  }
}

function isProgressEvent(value: unknown): value is ProgressEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
