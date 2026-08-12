'use client';

import { upload } from '@vercel/blob/client';
import { useCallback, useRef, useState } from 'react';

import { UPLOAD_ACCEPT, checkUploadFile, describeUploadSize } from '@/lib/source';

/**
 * Direct browser-to-Blob upload for audio files.
 *
 * The bytes never touch our API. Vercel caps request bodies at 4.5 MB and
 * returns 413 above that, so a 20 MB file posted to a route of ours would fail
 * outright. `upload()` from @vercel/blob/client fetches a short-lived token
 * from /api/blob/upload and streams straight to Blob storage; only the
 * resulting URL is handed back, and that is what /api/analyze receives.
 */

export type AudioUploadProps = {
  /** Called with the Blob URL once the file has landed. */
  onUploaded: (url: string, fileName: string) => void;
  disabled?: boolean;
};

type Phase =
  | { status: 'idle' }
  | { status: 'uploading'; fileName: string; percent: number }
  | { status: 'failed'; message: string };

export default function AudioUpload({ onUploaded, disabled = false }: AudioUploadProps) {
  const [phase, setPhase] = useState<Phase>({ status: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      // Checked here so an oversized file is refused instantly, without a
      // round trip. The token issuer enforces the same limits server-side.
      const problem = checkUploadFile(file);
      if (problem) {
        setPhase({ status: 'failed', message: problem });
        return;
      }

      setPhase({ status: 'uploading', fileName: file.name, percent: 0 });

      try {
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/blob/upload',
          onUploadProgress: ({ percentage }) => {
            setPhase({ status: 'uploading', fileName: file.name, percent: percentage });
          },
        });

        setPhase({ status: 'idle' });
        onUploaded(blob.url, file.name);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setPhase({
          status: 'failed',
          // The commonest cause by far is an unconfigured Blob store, and the
          // route says so in as many words — pass that through rather than
          // burying it under something generic.
          message: /not configured/i.test(message)
            ? message
            : `The upload did not finish: ${message}`,
        });
      } finally {
        // Let the same file be chosen again after a failure.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onUploaded],
  );

  const uploading = phase.status === 'uploading';

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        id="audio-file"
        type="file"
        accept={UPLOAD_ACCEPT}
        disabled={disabled || uploading}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <label
        htmlFor="audio-file"
        className="w-fit cursor-pointer rounded-lg border px-3 py-2 text-sm"
        style={{
          borderColor: 'var(--line)',
          color: 'var(--ink-soft)',
          opacity: disabled || uploading ? 0.5 : 1,
        }}
      >
        {uploading ? 'Uploading…' : 'Or upload an audio file'}
      </label>

      <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
        MP3, M4A, WAV, FLAC or MP4, up to {describeUploadSize(20 * 1024 * 1024)}.
      </p>

      <div aria-live="polite">
        {uploading && (
          <p className="font-mono text-xs tabular-nums" style={{ color: 'var(--ink-soft)' }}>
            {phase.fileName} — {Math.round(phase.percent)}%
          </p>
        )}
        {phase.status === 'failed' && (
          <p className="text-xs" style={{ color: 'var(--ink)' }}>
            {phase.message}
          </p>
        )}
      </div>
    </div>
  );
}
