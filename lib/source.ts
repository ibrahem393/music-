import { z } from 'zod';

/**
 * What we will hand to Gemini as a fileData part.
 *
 * Two accepted shapes: a public YouTube watch link, or a Vercel Blob URL
 * produced by a direct client upload. Nothing else — an arbitrary URL here
 * would make the route an open fetch proxy.
 */
export type SourceKind = 'youtube' | 'blob';

export type ParsedSource = {
  kind: SourceKind;
  /** Canonical URL passed to Gemini as fileUri. */
  uri: string;
  /** MIME hint for the fileData part. */
  mimeType: string;
  /** YouTube video id, when we have one. Used for the work id. */
  videoId?: string;
};

export type SourceError = { message: string };
export type SourceResult =
  | { ok: true; source: ParsedSource }
  | { ok: false; error: SourceError };

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Vercel Blob public URLs live on this suffix. */
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

const AUDIO_EXTENSIONS: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  webm: 'video/webm',
};

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  // /shorts/<id>, /live/<id>, /embed/<id>
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(segments[0] ?? '')) {
    const id = segments[1] ?? '';
    if (VIDEO_ID.test(id)) return id;
  }

  return null;
}

export function parseSource(raw: string): SourceResult {
  const input = raw.trim();
  if (input.length === 0) {
    return { ok: false, error: { message: 'Paste a link to get started.' } };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      ok: false,
      error: { message: 'That is not a URL. Paste a full YouTube link, including https://.' },
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: { message: 'Links must start with https://.' } };
  }

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = youtubeId(url);
    if (!videoId) {
      return {
        ok: false,
        error: {
          message:
            'That YouTube link has no video in it. Use a watch link like https://www.youtube.com/watch?v=…',
        },
      };
    }
    return {
      ok: true,
      source: {
        kind: 'youtube',
        uri: `https://www.youtube.com/watch?v=${videoId}`,
        mimeType: 'video/*',
        videoId,
      },
    };
  }

  if (host.endsWith(BLOB_HOST_SUFFIX)) {
    const extension = url.pathname.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = AUDIO_EXTENSIONS[extension];
    if (!mimeType) {
      return {
        ok: false,
        error: {
          message: 'That upload is not an audio or video file. Use MP3, M4A, WAV, FLAC or MP4.',
        },
      };
    }
    return { ok: true, source: { kind: 'blob', uri: url.toString(), mimeType } };
  }

  return {
    ok: false,
    error: {
      message: 'Cadence reads YouTube links and audio files you upload. Other hosts are not supported.',
    },
  };
}

/**
 * 20 MB, per the brief. Checked in the browser before the upload starts so the
 * reader gets an immediate answer, and again when the upload token is issued —
 * the browser check is a courtesy, the token check is the real boundary.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** The MIME types a client token will be issued for. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-flac',
  'video/mp4',
  'video/webm',
] as const;

/** What the file picker accepts, and what the error copy names. */
export const UPLOAD_ACCEPT = '.mp3,.m4a,.wav,.flac,.aac,.ogg,.opus,.mp4,.webm,audio/*';

export function describeUploadSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Null when the file is acceptable, otherwise the reason it is not. */
export function checkUploadFile(file: { name: string; size: number }): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${describeUploadSize(file.size)}. The limit is 20 MB — trim the excerpt, or export it at a lower bitrate.`;
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!Object.keys(AUDIO_EXTENSIONS).includes(extension)) {
    return 'Cadence reads MP3, M4A, WAV, FLAC, AAC, OGG, Opus, MP4 and WebM.';
  }
  return null;
}

export const AnalyzeRequestSchema = z.object({
  source: z.string().min(1).max(2048),
  // Pro by default: the notation is only as good as the model writing it.
  accuracy: z.enum(['fast', 'accurate']).default('accurate'),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/** Stable-ish id for the work URL. Not a security boundary. */
export function workId(source: ParsedSource): string {
  const seed = source.videoId ?? source.uri;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
