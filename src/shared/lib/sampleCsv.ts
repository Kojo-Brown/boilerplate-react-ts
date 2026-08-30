/**
 * A deterministic transactions CSV, for the worker lab and its tests.
 *
 * Deterministic by construction rather than by chance: the generator is a
 * seeded PRNG, so "200,000 rows, seed 7" names one exact string. A benchmark
 * whose input differs between the two arms it is comparing is not a benchmark,
 * and a test that asserts a total against `Math.random()` data cannot assert
 * anything but its own arithmetic.
 */

/** Categories the generator draws from. */
export const SAMPLE_CATEGORIES = [
  "groceries",
  "transport",
  "utilities",
  // Deliberately contains a comma, so every sample exercises the quoted-field
  // path in `readRecord` rather than leaving it to a hand-written unit test.
  "food, drink",
  "entertainment",
  "health",
] as const;

export interface SampleCsvOptions {
  /** PRNG seed. The same seed and row count always produce the same string. */
  readonly seed?: number;
  /**
   * Emit a deliberately malformed row every N rows, or 0 for none.
   *
   * The lab uses this to show error reporting on a file that still mostly
   * parses, which is what a real export looks like.
   */
  readonly invalidEvery?: number;
}

/**
 * Mulberry32 — 32-bit state, no dependencies, uniform enough for fixture data.
 *
 * Not `Math.random()` with a seed prefix and not a hash of the index: both
 * produce sequences whose statistical shape changes with the row count, so a
 * 10k run and a 200k run would not be the same data plus more of it.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 2024-01-01, as a fixed epoch so dates never depend on the current clock. */
const EPOCH_MS = Date.UTC(2024, 0, 1);

/**
 * Builds `rowCount` data rows plus a header.
 *
 * Fields carrying a comma are quoted; nothing else is, which is what a real
 * exporter does and what makes the fast path in `readRecord` the common one.
 */
export function buildSampleCsv(rowCount: number, options: SampleCsvOptions = {}): string {
  const { seed = 1, invalidEvery = 0 } = options;
  const random = mulberry32(seed);

  // One array joined once. Repeated `+=` on a string of this size is quadratic
  // in some engines and is the reason a "generate the fixture" step can end up
  // slower than the parse it exists to feed.
  const lines: string[] = ["id,date,category,amount"];

  for (let index = 0; index < rowCount; index += 1) {
    if (invalidEvery > 0 && (index + 1) % invalidEvery === 0) {
      lines.push(`tx-${index},not-a-date,groceries,12.00`);
      continue;
    }

    const date = new Date(EPOCH_MS + Math.floor(random() * 365) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const category = SAMPLE_CATEGORIES[Math.floor(random() * SAMPLE_CATEGORIES.length)] ?? "other";
    // −500.00 to +500.00, two decimal places, via integers so the string is
    // exact rather than whatever `toFixed` made of a float.
    const minor = Math.floor(random() * 100_001) - 50_000;
    const sign = minor < 0 ? "-" : "";
    const absolute = Math.abs(minor);
    const amount = `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
    const field = category.includes(",") ? `"${category}"` : category;
    lines.push(`tx-${index},${date},${field},${amount}`);
  }

  return `${lines.join("\n")}\n`;
}
