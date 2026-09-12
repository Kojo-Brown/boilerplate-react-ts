/**
 * Turning anything that was thrown into a row an error backend can group.
 *
 * The envelope is shaped like Sentry's because the shape is the useful part —
 * an exception *chain* rather than one message, a fingerprint that decides
 * grouping, tags that a dashboard facets on, breadcrumbs that say what led
 * here. Nothing in this directory talks to Sentry, and no Sentry SDK is a
 * dependency; `ErrorTransport` is the seam, and `docs/error-boundaries.md`
 * describes what wiring a real one up would involve.
 *
 * Two things make this a module rather than `{ message: error.message }` at
 * the call site.
 *
 * **`throw` accepts any value.** `error.message` is a property access on a
 * value that is only an `Error` by convention. `throw "nope"` is legal and so
 * is `throw { code: 500 }`; React Router's own `throw new Response(...)` is
 * idiomatic. Reading `.message` off those yields `undefined`, and a fallback
 * that renders it shows an empty paragraph under "Something went wrong" — the
 * error report and the error screen degrade together, at the moment both are
 * the only thing anyone has to go on.
 *
 * **Grouping is done on a normalized string, not the message.** An error
 * carrying an id (`Failed to load user 8f21c3`) produces a distinct group per
 * occurrence, so the one bug that fired ten thousand times arrives as ten
 * thousand issues of one event each, which is indistinguishable from noise.
 * {@link fingerprintOf} strips the parts that vary.
 */

/** One link in an exception chain. Mirrors Sentry's `exception.values` entry. */
export interface ExceptionValue {
  /** Constructor name (`TypeError`), or a synthetic one for non-`Error` throws. */
  type: string;
  /** The human-readable message. Never `undefined` — see {@link normalizeThrown}. */
  value: string;
  /** Present only when the thrown value carried one. */
  stack?: string;
}

export type ErrorLevel = "fatal" | "error" | "warning";

/**
 * How the error reached the reporter.
 *
 * `handled` is the field a dashboard filters on to separate "the app showed a
 * fallback" from "the app is white". A route boundary catching a render error
 * is handled; a `window.onerror` is not.
 */
export interface ErrorMechanism {
  /** Free-form origin, e.g. `"route-boundary"` or `"react.onUncaughtError"`. */
  type: string;
  /** Whether something caught this and showed the user a fallback. */
  handled: boolean;
}

/** A step the user or app took before the error. Strings only — see `breadcrumbs.ts`. */
export interface Breadcrumb {
  /** Milliseconds since the epoch. */
  timestamp: number;
  /** Coarse origin: `"navigation"`, `"ui.click"`, `"http"`, `"console"`. */
  category: string;
  message: string;
  level: ErrorLevel | "info";
  /** Flat, already-redacted extras. */
  data?: Record<string, string>;
}

/** The row a transport sends. */
export interface ErrorEvent {
  /** 32 lowercase hex characters, the id format Sentry uses. */
  eventId: string;
  /** Milliseconds since the epoch. */
  timestamp: number;
  level: ErrorLevel;
  /**
   * The chain, thrown value first and each entry's `cause` after it. The last
   * entry is the root cause, which is what {@link fingerprintOf} groups on.
   */
  exception: ExceptionValue[];
  /**
   * Grouping key. An array because Sentry's is; joining with `|` is the
   * backend's job, not this module's.
   */
  fingerprint: string[];
  /** Facets: route, boundary, release, whatever the app sets. */
  tags: Record<string, string>;
  /** Structured extras that are not facets. React's component stack lives here. */
  contexts: {
    react?: { componentStack: string };
    [key: string]: Record<string, string> | undefined;
  };
  breadcrumbs: Breadcrumb[];
  mechanism: ErrorMechanism;
}

/**
 * How many `cause` links are walked.
 *
 * A cap is needed even though `cause` chains are short in practice, because
 * this walks a structure the application did not build: a rethrow in a loop
 * produces a chain as long as the loop ran. {@link toExceptionChain} also
 * tracks identity, so the cap is the second line of defence rather than the
 * only one.
 */
export const MAX_CAUSE_DEPTH = 5;

/** Stack frames kept per exception. Enough to identify the call site. */
export const MAX_STACK_FRAMES = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Trims a stack to {@link MAX_STACK_FRAMES} frames.
 *
 * V8 puts the message on the first line of `stack` and the frames after it, so
 * the message line is kept and the count applies to the frames. Engines that
 * omit the message line (SpiderMonkey) simply lose one fewer frame; nothing
 * here parses frames, because a stack is only ever displayed or hashed.
 */
export function trimStack(stack: string, maxFrames = MAX_STACK_FRAMES): string {
  const lines = stack.split("\n");
  const firstFrame = lines.findIndex((line) => line.trimStart().startsWith("at "));
  // No recognisable frames: keep the whole thing, it is short by definition.
  if (firstFrame === -1) return lines.slice(0, maxFrames + 1).join("\n");
  return lines.slice(0, firstFrame + maxFrames).join("\n");
}

/**
 * Describes any thrown value as `{ type, value, stack }`.
 *
 * The cases below are the ones that actually occur, and each produces
 * something a human can act on rather than `undefined`:
 *
 * - **`Error`** (and subclasses) — `name` is preferred over
 *   `constructor.name`, because a minifier rewrites class names and `name` is
 *   assigned as a string on the prototype. After minification
 *   `constructor.name` is `t`, and every custom error type groups together.
 * - **`Response`** — React Router's `throw new Response(null, { status: 404 })`
 *   is the documented way to signal a route error, and a `Response` has no
 *   `message` at all.
 * - **string** — `throw "nope"` carries no stack; the string is the message.
 * - **plain object** — reported with its own `name`/`message` when it has
 *   them (this is what a cross-realm `Error` looks like, e.g. one that
 *   crossed a worker boundary), otherwise a JSON preview, because
 *   `String({})` is `"[object Object]"` and says nothing.
 * - **everything else** — `null`, `undefined`, numbers, symbols.
 */
export function normalizeThrown(thrown: unknown): ExceptionValue {
  if (thrown instanceof Error) {
    const result: ExceptionValue = {
      type: thrown.name || "Error",
      value: thrown.message || "<no message>",
    };
    if (typeof thrown.stack === "string" && thrown.stack !== "") {
      result.stack = trimStack(thrown.stack);
    }
    return result;
  }

  if (typeof Response !== "undefined" && thrown instanceof Response) {
    return {
      type: "Response",
      value: `HTTP ${thrown.status}${thrown.statusText ? ` ${thrown.statusText}` : ""}`,
    };
  }

  if (typeof thrown === "string") {
    return { type: "NonError", value: thrown || "<empty string>" };
  }

  if (isRecord(thrown)) {
    // A cross-realm Error fails `instanceof` but still carries the fields.
    const name = typeof thrown["name"] === "string" ? thrown["name"] : null;
    const message = typeof thrown["message"] === "string" ? thrown["message"] : null;
    if (name !== null || message !== null) {
      const result: ExceptionValue = {
        type: name ?? "NonError",
        value: message ?? "<no message>",
      };
      if (typeof thrown["stack"] === "string" && thrown["stack"] !== "") {
        result.stack = trimStack(thrown["stack"]);
      }
      return result;
    }
    return { type: "NonError", value: previewObject(thrown) };
  }

  if (thrown === null) return { type: "NonError", value: "null" };
  if (thrown === undefined) return { type: "NonError", value: "undefined" };
  return { type: "NonError", value: safeToString(thrown) };
}

/** `String(value)` without the throw. `String(Symbol())` throws in some engines. */
function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "<unstringifiable>";
  }
}

/**
 * A short JSON preview of a thrown object.
 *
 * Capped and try/caught: the thrown value may be cyclic, may contain a getter
 * that throws, or may be megabytes of API payload. A reporter that throws
 * while reporting takes down the fallback UI as well as the page.
 */
function previewObject(value: Record<string, unknown>, maxLength = 200): string {
  try {
    // Re-typed rather than called directly: `JSON.stringify` is declared to
    // return `string` for an object argument, and returns `undefined` for one
    // whose `toJSON()` does. That is reachable here — the value was thrown by
    // code this module does not control — and against the declared type the
    // guard below reads as dead to the linter.
    const stringify = JSON.stringify as (value: unknown) => string | undefined;
    const json = stringify(value);
    if (json === undefined) return "<unserialisable object>";
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
  } catch {
    return "<unserialisable object>";
  }
}

/**
 * Flattens a thrown value and its `cause` links into a chain.
 *
 * Index 0 is what was thrown; the last entry is the root cause. The identity
 * set is not belt-and-braces for the depth cap — `err.cause = err` is one
 * line, `a.cause = b; b.cause = a` is two, and either turns a plain `while`
 * into a hang inside the error path, where nothing is left to catch it.
 */
export function toExceptionChain(thrown: unknown, maxDepth = MAX_CAUSE_DEPTH): ExceptionValue[] {
  const chain: ExceptionValue[] = [];
  const seen = new Set<unknown>();
  let current: unknown = thrown;

  while (current !== undefined && current !== null && chain.length < maxDepth) {
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(normalizeThrown(current));
    current = isRecord(current) ? current["cause"] : undefined;
  }

  // `throw null` and `throw undefined` produce an empty loop but are still
  // errors that need reporting.
  if (chain.length === 0) chain.push(normalizeThrown(thrown));
  return chain;
}

/**
 * Replaces the parts of a message that vary between occurrences of one bug.
 *
 * Without this, grouping is done on a string containing a record id, and the
 * backend reports one issue per *occurrence*: the loudest bug in the app looks
 * like ten thousand unrelated singletons, and the deduplication in
 * `errorReporter.ts` — which compares fingerprints — never fires either.
 *
 * Order matters. UUIDs and long hex runs are matched before bare digits,
 * because the digit rule would otherwise chew a UUID into
 * `<uuid>`-shaped rubble that no two occurrences agree on.
 */
export function normalizeForGrouping(value: string): string {
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\b\d[\d.]*\b/g, "<n>")
    .trim();
}

/**
 * The grouping key: root cause first, because that is the bug.
 *
 * Fingerprinting on the outermost error groups by whoever rethrew last, which
 * is usually one wrapper shared by every call site — so a database timeout and
 * a malformed response arrive as the same issue, both titled after the
 * wrapper. The root cause is the one that names what actually failed.
 *
 * The outermost type is kept as a second component so that two different
 * wrappers around one root cause stay distinguishable, which is what makes a
 * regression in one call path visible.
 */
export function fingerprintOf(chain: ExceptionValue[]): string[] {
  const root = chain[chain.length - 1] ?? { type: "NonError", value: "<empty>" };
  const outer = chain[0] ?? root;
  const parts = [root.type, normalizeForGrouping(root.value)];
  if (outer !== root) parts.push(outer.type);
  return parts;
}

/**
 * A 32-character lowercase hex id, the format Sentry's `event_id` uses.
 *
 * `crypto.randomUUID` is preferred and is not assumed: it is unavailable on
 * insecure origins, which is every LAN-address dev server anyone tests a
 * mobile build against. The fallback is `getRandomValues`, and only if that is
 * missing too does this reach `Math.random` — an id needs to be unique, not
 * unguessable, so a weak source is a correct last resort rather than a
 * vulnerability.
 */
export function createEventId(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;

  if (c !== undefined && typeof c.randomUUID === "function") {
    return c.randomUUID().replace(/-/g, "");
  }

  if (c !== undefined && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  let out = "";
  while (out.length < 32) {
    out += Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  }
  return out.slice(0, 32);
}
