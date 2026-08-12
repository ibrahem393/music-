import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/source';

/**
 * Issues short-lived client tokens for direct browser-to-Blob uploads.
 *
 * The audio never passes through here. Vercel caps request bodies at 4.5 MB and
 * returns 413 above it, so a 20 MB file routed through our own API would fail
 * outright — the browser uploads straight to Blob storage and only the
 * resulting URL is posted to /api/analyze.
 *
 * This route only exchanges JSON for a token, so it stays far inside the body
 * limit and needs no extended duration.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(
      {
        error:
          'File uploads are not configured on this deployment. Attach a Vercel Blob store and set BLOB_READ_WRITE_TOKEN, or paste a YouTube link instead.',
      },
      501,
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return json({ error: 'The request body was not JSON.' }, 400);
  }

  try {
    const result = await handleUpload({
      body,
      request,
      // The size and type limits are enforced here as well as in the browser.
      // The client-side check is a courtesy; this one is the actual boundary.
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [...ALLOWED_UPLOAD_MIME_TYPES],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // Nothing to record: the client hands the URL straight to /api/analyze
        // and no analysis is stored server-side.
      },
    });

    return json(result, 200);
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : 'The upload could not be authorised.' }, 400);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
