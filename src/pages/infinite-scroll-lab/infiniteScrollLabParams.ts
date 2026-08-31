export const PREFETCH_MODES = ["eager", "end"] as const;

export type PrefetchMode = (typeof PREFETCH_MODES)[number];

/**
 * The `rootMargin` each mode gives the sentinel, in px.
 *
 * `end` is `0` rather than a separate code path, and that is the point of the
 * comparison: both arms run the identical component against the identical
 * feed, and the only difference between "the next page is already there" and
 * "here is a spinner" is how far ahead of the end the tripwire sits.
 */
export const PREFETCH_MARGIN_PX: Record<PrefetchMode, number> = {
  eager: 600,
  end: 0,
};

function isPrefetchMode(value: string): value is PrefetchMode {
  return (PREFETCH_MODES as readonly string[]).includes(value);
}

/** Reads the mode from the URL, defaulting to `eager` for anything else. */
export function parsePrefetchMode(raw: string | null): PrefetchMode {
  return raw !== null && isPrefetchMode(raw) ? raw : "eager";
}
