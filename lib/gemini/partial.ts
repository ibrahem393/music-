/**
 * Incremental scanner that reports top-level keys of a JSON object as they
 * appear in a stream.
 *
 * This is what makes the progress rail honest: instead of a timer pretending to
 * be work, each stage advances when the model actually emits that part of the
 * document. Because the response schema fixes property ordering, seeing
 * `"form"` open means the form really has been written.
 *
 * Naive substring matching would misfire on prose — a productionNote can
 * contain the word "scores". So this tracks string and nesting state properly
 * and only reports a key when a string at depth 1 is followed by a colon.
 */
export type TopLevelKey = {
  name: string;
  /** Index of the opening quote of the key, in the accumulated text. */
  start: number;
};

export class TopLevelKeyScanner {
  #depth = 0;
  #inString = false;
  #escaped = false;
  #stringStart = -1;
  #stringChars: string[] = [];
  /** A completed depth-1 string awaiting a colon to prove it is a key. */
  #candidate: TopLevelKey | null = null;
  #consumed = 0;
  #keys: TopLevelKey[] = [];

  /** Feeds the next delta. Returns keys discovered in this delta only. */
  push(delta: string): TopLevelKey[] {
    const found: TopLevelKey[] = [];

    for (let i = 0; i < delta.length; i += 1) {
      const ch = delta[i] as string;
      const index = this.#consumed + i;

      if (this.#inString) {
        if (this.#escaped) {
          this.#escaped = false;
        } else if (ch === '\\') {
          this.#escaped = true;
        } else if (ch === '"') {
          this.#inString = false;
          if (this.#depth === 1) {
            this.#candidate = { name: this.#stringChars.join(''), start: this.#stringStart };
          }
          this.#stringChars = [];
        } else if (this.#depth === 1) {
          this.#stringChars.push(ch);
        }
        continue;
      }

      switch (ch) {
        case '"':
          this.#inString = true;
          this.#stringStart = index;
          this.#stringChars = [];
          break;
        case '{':
        case '[':
          this.#depth += 1;
          this.#candidate = null;
          break;
        case '}':
        case ']':
          this.#depth -= 1;
          this.#candidate = null;
          break;
        case ':':
          if (this.#depth === 1 && this.#candidate) {
            this.#keys.push(this.#candidate);
            found.push(this.#candidate);
          }
          this.#candidate = null;
          break;
        case ' ':
        case '\n':
        case '\r':
        case '\t':
          break;
        default:
          this.#candidate = null;
          break;
      }
    }

    this.#consumed += delta.length;
    return found;
  }

  keys(): readonly TopLevelKey[] {
    return this.#keys;
  }

  startOf(name: string): number | null {
    const hit = this.#keys.find((k) => k.name === name);
    return hit ? hit.start : null;
  }
}

/**
 * Closes a partial JSON object just before `key`, yielding a parseable object
 * containing every property emitted so far. Returns null if the result does not
 * parse — the caller then simply waits for the complete document.
 */
export function sliceBefore(accumulated: string, start: number): unknown | null {
  const head = accumulated.slice(0, start).replace(/[\s,]*$/, '');
  if (head.length === 0) return null;
  try {
    return JSON.parse(`${head}}`) as unknown;
  } catch {
    return null;
  }
}
