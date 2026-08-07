/**
 * Timestamps in the analysis are model-written strings like "1:23". They are
 * parsed defensively — a malformed one loses a timeline tick, it does not
 * take the page down.
 */

/** Returns seconds, or null if the string is not a timestamp we understand. */
export function parseTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const numbers = parts.map((part) => Number(part.trim()));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;

  const [a, b, c] = numbers;
  const seconds =
    parts.length === 3
      ? (a as number) * 3600 + (b as number) * 60 + (c as number)
      : (a as number) * 60 + (b as number);

  return Number.isFinite(seconds) ? seconds : null;
}

/** m:ss, or h:mm:ss past an hour. */
export function formatTimestamp(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const whole = Math.round(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
