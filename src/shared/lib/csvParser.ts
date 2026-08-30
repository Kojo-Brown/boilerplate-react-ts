/**
 * A resumable CSV parser and aggregator for a transactions export.
 *
 * This module is the *work*. It knows nothing about workers, Comlink or React:
 * it is a synchronous, allocation-conscious parser that can be stopped between
 * any two rows and asked how far it has got. That shape is what makes the rest
 * of the pattern possible —
 *
 * - `csvParserApi.ts` drives it in chunks inside a worker, which is the only
 *   way a long parse can observe a cancel message (see the note there).
 * - `csvParserClient.ts` drives the same code from the main thread when the
 *   lab asks for the blocking arm, so the two arms of the comparison are the
 *   same parser and not two implementations that might disagree.
 *
 * The parser is deliberately not a generator. A generator would read more
 * nicely, but resuming one costs a frame's worth of allocation per row at the
 * sizes this is meant for, and the point of moving this off the main thread is
 * that it is expensive.
 */

/** The header this parser accepts, in order. */
export const TRANSACTION_COLUMNS = ["id", "date", "category", "amount"] as const;

/** Row errors are collected up to this many, then counted rather than kept. */
export const MAX_ROW_ERRORS = 50;

/** Growth start for the amounts buffer. Doubles from here. */
const INITIAL_AMOUNT_CAPACITY = 1024;

/**
 * Rows consumed between yields by default.
 *
 * Small enough that a cancel lands within a frame or two even on a slow
 * machine, large enough that the per-chunk overhead (a macrotask hop, a
 * progress message) is noise next to the parsing. Chunking at, say, 50 rows
 * makes the worker arm measurably *slower* than the blocking one, which is the
 * failure this constant exists to avoid.
 */
export const DEFAULT_CHUNK_ROWS = 5_000;

const QUOTE = 34; // "
const COMMA = 44; // ,
const CR = 13;
const LF = 10;

/** One record read off the input, plus where the next one starts. */
export interface CsvRecord {
  readonly fields: readonly string[];
  /** Index in the source text at which the following record begins. */
  readonly next: number;
}

/** A row that could not be turned into a transaction. */
export interface CsvRowError {
  /** 1-based line number in the source, header included. */
  readonly line: number;
  readonly message: string;
}

/** Aggregate for one category. Amounts are integer minor units. */
export interface CategorySummary {
  readonly category: string;
  readonly count: number;
  readonly totalMinor: number;
  readonly minMinor: number;
  readonly maxMinor: number;
}

export interface CsvParseResult {
  readonly rowCount: number;
  readonly totalMinor: number;
  /** Sorted by absolute total, largest first — the order a reader wants. */
  readonly categories: readonly CategorySummary[];
  readonly errors: readonly CsvRowError[];
  /** Rows that failed beyond {@link MAX_ROW_ERRORS} and were only counted. */
  readonly droppedErrorCount: number;
  /**
   * Every valid amount, in file order, in minor units.
   *
   * This is the one large value the worker sends back, and it is sent as a
   * transfer rather than a copy — see `csvParserApi.ts`. It is an `Int32Array`
   * rather than `number[]` for exactly that reason: an array of numbers has no
   * transferable buffer behind it, so it would be structured-cloned element by
   * element, which at 200k rows costs more than the parse did.
   */
  readonly amountsMinor: Int32Array;
}

export interface CsvParseProgress {
  readonly rowsParsed: number;
  readonly charsParsed: number;
  readonly totalChars: number;
  /** Fraction of the input consumed, 0–1. */
  readonly ratio: number;
}

/** Thrown when the input's header is not {@link TRANSACTION_COLUMNS}. */
export class CsvHeaderError extends Error {
  constructor(readonly received: readonly string[]) {
    super(
      `Expected the header "${TRANSACTION_COLUMNS.join(",")}" but found "${received.join(",")}".`,
    );
    this.name = "CsvHeaderError";
  }
}

/**
 * Reads one record starting at `start`, or `null` once the input is exhausted.
 *
 * Quoting follows RFC 4180: a field opening with `"` runs to the next
 * unescaped `"`, and `""` inside it is one literal quote. Two things the RFC
 * leaves undefined are decided here rather than left to chance, because real
 * exports contain both:
 *
 * - **Characters between a closing quote and the delimiter** (`"a"x,b`) are
 *   appended to the field rather than dropped. Dropping them loses data with
 *   no trace; keeping them means the malformed value reaches row validation,
 *   which reports it with the line number attached.
 * - **An unterminated quote** consumes the rest of the input as one field.
 *   The alternative — resynchronising at the next newline — silently splits
 *   one broken row into many plausible-looking ones.
 *
 * The scan works on `charCodeAt` and `slice` rather than building fields a
 * character at a time. That is not micro-optimisation: at 200k rows the
 * concatenating form spends most of its time in string allocation, which makes
 * the parse look inherently expensive when most of the cost is the parser's
 * own doing.
 */
export function readRecord(text: string, start: number): CsvRecord | null {
  if (start >= text.length) return null;

  const fields: string[] = [];
  let i = start;

  for (;;) {
    let value: string;

    if (text.charCodeAt(i) === QUOTE) {
      i += 1;
      let chunkStart = i;
      let parts: string[] | null = null;

      while (i < text.length) {
        if (text.charCodeAt(i) !== QUOTE) {
          i += 1;
          continue;
        }
        if (text.charCodeAt(i + 1) === QUOTE) {
          // Keep the first of the pair, skip the second.
          (parts ??= []).push(text.slice(chunkStart, i + 1));
          i += 2;
          chunkStart = i;
          continue;
        }
        break;
      }

      const tail = text.slice(chunkStart, i);
      value = parts === null ? tail : parts.join("") + tail;
      if (i < text.length) i += 1; // the closing quote

      const junkStart = i;
      while (i < text.length) {
        const code = text.charCodeAt(i);
        if (code === COMMA || code === LF || code === CR) break;
        i += 1;
      }
      if (i > junkStart) value += text.slice(junkStart, i);
    } else {
      const fieldStart = i;
      while (i < text.length) {
        const code = text.charCodeAt(i);
        if (code === COMMA || code === LF || code === CR) break;
        i += 1;
      }
      value = text.slice(fieldStart, i);
    }

    fields.push(value);

    if (i >= text.length) return { fields, next: i };
    const code = text.charCodeAt(i);
    if (code === COMMA) {
      i += 1;
      continue;
    }
    if (code === CR) {
      return { fields, next: text.charCodeAt(i + 1) === LF ? i + 2 : i + 1 };
    }
    return { fields, next: i + 1 };
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

/**
 * Parses a decimal amount into integer minor units.
 *
 * `Math.round(Number(text) * 100)` is the obvious version and it is wrong for
 * values a bank statement contains: `Number("8.115") * 100` is `811.4999…`,
 * and rounding a binary float is how a total drifts by a cent per few thousand
 * rows. Splitting on the point and padding keeps the arithmetic in integers,
 * so the sum this parser reports is the sum of the file.
 *
 * Returns `null` for anything that is not a plain decimal with at most two
 * fractional digits — including `1e3`, `+1`, `1.`, `NaN` and the empty string,
 * all of which `Number()` would accept or coerce.
 */
export function parseAmountMinor(text: string): number | null {
  if (!AMOUNT_PATTERN.test(text)) return null;
  const negative = text.charCodeAt(0) === 45; // -
  const digits = negative ? text.slice(1) : text;
  const point = digits.indexOf(".");
  const whole = point === -1 ? digits : digits.slice(0, point);
  const fraction = point === -1 ? "" : digits.slice(point + 1);
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -minor : minor;
}

interface CategoryAccumulator {
  count: number;
  totalMinor: number;
  minMinor: number;
  maxMinor: number;
}

/**
 * A parse in progress.
 *
 * `step` is the unit of interruption: it consumes at most `maxRows` records and
 * returns whether any input is left. Everything the caller needs between steps
 * — progress for a UI, the finished result — is a method rather than a
 * callback, so the driver decides when and how often to look.
 */
export interface TransactionParser {
  /** Consumes up to `maxRows` records. Returns true while input remains. */
  step: (maxRows: number) => boolean;
  progress: () => CsvParseProgress;
  /** The result so far. Meaningful at any point; final once `step` is false. */
  result: () => CsvParseResult;
}

/**
 * Starts a parse over `text`.
 *
 * The header is read and checked eagerly, so a file with the wrong columns
 * fails here rather than producing a result full of row errors that all say
 * the same thing.
 *
 * @throws {CsvHeaderError} when the first record is not {@link TRANSACTION_COLUMNS}.
 */
export function createTransactionParser(text: string): TransactionParser {
  const header = readRecord(text, 0);
  if (
    header === null ||
    header.fields.length !== TRANSACTION_COLUMNS.length ||
    !TRANSACTION_COLUMNS.every((column, index) => header.fields[index]?.trim() === column)
  ) {
    throw new CsvHeaderError(header?.fields ?? []);
  }

  let cursor = header.next;
  let line = 1; // the header
  let rowCount = 0;
  let totalMinor = 0;
  let droppedErrorCount = 0;
  const errors: CsvRowError[] = [];
  const categories = new Map<string, CategoryAccumulator>();

  let amounts = new Int32Array(INITIAL_AMOUNT_CAPACITY);
  let amountCount = 0;

  const recordError = (message: string): void => {
    if (errors.length < MAX_ROW_ERRORS) errors.push({ line, message });
    else droppedErrorCount += 1;
  };

  const pushAmount = (value: number): void => {
    if (amountCount === amounts.length) {
      const grown = new Int32Array(amounts.length * 2);
      grown.set(amounts);
      amounts = grown;
    }
    amounts[amountCount] = value;
    amountCount += 1;
  };

  const consumeRow = (fields: readonly string[]): void => {
    // A trailing newline produces one empty field. It is not a row and it is
    // not an error; treating it as either is the commonest off-by-one in a
    // hand-written CSV reader.
    if (fields.length === 1 && fields[0] === "") return;

    if (fields.length !== TRANSACTION_COLUMNS.length) {
      recordError(`Expected ${TRANSACTION_COLUMNS.length} columns, found ${fields.length}.`);
      return;
    }

    // Sound by the length check immediately above. `noUncheckedIndexedAccess`
    // cannot see that, and spelling it as four `?? ""` defaults would add four
    // branches no input can reach — which is a coverage hole that looks like a
    // gap in the tests rather than what it is.
    const [id, date, category, amount] = fields as readonly [string, string, string, string];
    if (id.trim() === "") {
      recordError("Missing id.");
      return;
    }
    if (!DATE_PATTERN.test(date)) {
      recordError(`Invalid date "${date}" — expected YYYY-MM-DD.`);
      return;
    }
    const trimmedCategory = category.trim();
    if (trimmedCategory === "") {
      recordError("Missing category.");
      return;
    }
    const amountMinor = parseAmountMinor(amount.trim());
    if (amountMinor === null) {
      recordError(`Invalid amount "${amount}".`);
      return;
    }

    rowCount += 1;
    totalMinor += amountMinor;
    pushAmount(amountMinor);

    const existing = categories.get(trimmedCategory);
    if (existing === undefined) {
      categories.set(trimmedCategory, {
        count: 1,
        totalMinor: amountMinor,
        minMinor: amountMinor,
        maxMinor: amountMinor,
      });
    } else {
      existing.count += 1;
      existing.totalMinor += amountMinor;
      if (amountMinor < existing.minMinor) existing.minMinor = amountMinor;
      if (amountMinor > existing.maxMinor) existing.maxMinor = amountMinor;
    }
  };

  return {
    step(maxRows: number): boolean {
      for (let taken = 0; taken < maxRows; taken += 1) {
        const record = readRecord(text, cursor);
        if (record === null) return false;
        cursor = record.next;
        line += 1;
        consumeRow(record.fields);
      }
      return cursor < text.length;
    },

    progress(): CsvParseProgress {
      return {
        rowsParsed: rowCount,
        charsParsed: cursor,
        totalChars: text.length,
        ratio: text.length === 0 ? 1 : Math.min(1, cursor / text.length),
      };
    },

    result(): CsvParseResult {
      const summaries: CategorySummary[] = [];
      for (const [category, accumulator] of categories) {
        summaries.push({ category, ...accumulator });
      }
      summaries.sort(
        (a, b) =>
          Math.abs(b.totalMinor) - Math.abs(a.totalMinor) || a.category.localeCompare(b.category),
      );

      return {
        rowCount,
        totalMinor,
        categories: summaries,
        errors: [...errors],
        droppedErrorCount,
        // `subarray`, not `slice`: a view shares the buffer, so there is no
        // copy here and the buffer stays transferable. The buffer may be up to
        // twice the length of the data because of the doubling above; a
        // transfer moves it either way, and the receiving side sees a view of
        // exactly `amountCount` elements because structured cloning preserves
        // a view's offset and length.
        amountsMinor: amounts.subarray(0, amountCount),
      };
    },
  };
}

/**
 * Parses `text` in one go, blocking until it is done.
 *
 * This is the reference implementation the chunked driver has to agree with,
 * and it is also the *blocking arm* of the lab: the same parser, run without
 * yielding, on whichever thread called it.
 */
export function parseTransactionsCsv(text: string): CsvParseResult {
  const parser = createTransactionParser(text);
  while (parser.step(DEFAULT_CHUNK_ROWS)) {
    // Every call consumes a chunk; the condition is the loop body.
  }
  return parser.result();
}

/** Formats integer minor units as a signed decimal string. */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
