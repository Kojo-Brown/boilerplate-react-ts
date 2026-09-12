/**
 * The last N things that happened, attached to whatever fails next.
 *
 * A stack trace says where the app was; breadcrumbs say how it got there. The
 * difference matters most for the errors a stack cannot explain — a render
 * that throws because of state set three interactions ago names only the
 * component that read the state, never the click that wrote it.
 *
 * Two constraints shape the implementation, and both are about what a
 * long-lived SPA does to a naive buffer.
 *
 * **It is bounded, and bounded by eviction rather than by a flush.** This
 * collects on every navigation and every tracked click for as long as the tab
 * is open. An unbounded array is a leak with a friendly name, and one that
 * grows fastest in the sessions most likely to hit a bug.
 *
 * **It stores strings, and only strings.** The tempting version of a click
 * breadcrumb keeps the `Event`, or the `target`, to derive a selector at send
 * time. Either one pins a DOM node in a buffer designed to outlive it, so
 * every recorded click retains the element it happened on plus that element's
 * entire subtree, long after React unmounted it — which is precisely the
 * detached-node retention `docs/memory-leaks.md` sets a gate against. The
 * selector is computed at record time and the node is dropped on the spot.
 */

import type { Breadcrumb } from "@/shared/observability/errorEvent";
import {
  redactMessage,
  redactUrl,
  type SENSITIVE_KEY_PATTERNS,
} from "@/shared/observability/redact";

/** Default ring capacity. Sentry's default is 100; the cost here is retained strings. */
export const DEFAULT_BREADCRUMB_LIMIT = 30;

export interface BreadcrumbBuffer {
  /** Records one crumb, evicting the oldest when full. */
  add: (crumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: number }) => void;
  /** Oldest first. A copy — the caller must not be able to mutate the ring. */
  snapshot: () => Breadcrumb[];
  /** Drops everything. Used after an event is sent, when the caller wants a fresh trail. */
  clear: () => void;
  /** How many crumbs are currently held. */
  readonly size: number;
}

export interface BreadcrumbBufferOptions {
  limit?: number;
  /** Injected so tests do not depend on wall-clock ordering. */
  now?: () => number;
  /** Query-key patterns treated as sensitive. Defaults to the shared list. */
  sensitiveKeys?: typeof SENSITIVE_KEY_PATTERNS;
}

/**
 * A fixed-capacity ring.
 *
 * `Array.prototype.shift()` on a full buffer would be the obvious
 * implementation and is O(n) per record, which is the wrong shape for
 * something on the hot path of every click. The ring writes at a cursor and
 * `snapshot()` pays the reordering cost once, at the only moment anyone needs
 * the order — when an error is being reported.
 */
export function createBreadcrumbBuffer(options: BreadcrumbBufferOptions = {}): BreadcrumbBuffer {
  const { limit = DEFAULT_BREADCRUMB_LIMIT, now = Date.now, sensitiveKeys } = options;
  // A zero or negative limit would make the ring a divide-by-zero; treat it as
  // "keep one" rather than throwing inside the error path.
  const capacity = Math.max(1, Math.floor(limit));
  const ring: (Breadcrumb | undefined)[] = new Array<Breadcrumb | undefined>(capacity);
  let cursor = 0;
  let count = 0;

  return {
    add(crumb) {
      const redacted: Breadcrumb = {
        timestamp: crumb.timestamp ?? now(),
        category: crumb.category,
        level: crumb.level,
        message: sensitiveKeys
          ? redactMessage(crumb.message, sensitiveKeys)
          : redactMessage(crumb.message),
        ...(crumb.data ? { data: redactData(crumb.data, sensitiveKeys) } : {}),
      };
      ring[cursor] = redacted;
      cursor = (cursor + 1) % capacity;
      if (count < capacity) count += 1;
    },
    snapshot() {
      const out: Breadcrumb[] = [];
      // `count < capacity` means the ring has not wrapped, so the oldest entry
      // is at 0; once wrapped the oldest is whatever the cursor is about to
      // overwrite.
      const start = count < capacity ? 0 : cursor;
      for (let i = 0; i < count; i += 1) {
        const entry = ring[(start + i) % capacity];
        if (entry !== undefined) out.push(entry);
      }
      return out;
    },
    clear() {
      ring.fill(undefined);
      cursor = 0;
      count = 0;
    },
    get size() {
      return count;
    },
  };
}

/** Redacts a crumb's flat extras. Keys are matched as well as values. */
function redactData(
  data: Record<string, string>,
  sensitiveKeys?: typeof SENSITIVE_KEY_PATTERNS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = sensitiveKeys ? redactMessage(value, sensitiveKeys) : redactMessage(value);
  }
  return out;
}

/** A navigation crumb, with the destination redacted. */
export function navigationBreadcrumb(from: string, to: string): Omit<Breadcrumb, "timestamp"> {
  return {
    category: "navigation",
    level: "info",
    message: `${redactUrl(from)} → ${redactUrl(to)}`,
    data: { from: redactUrl(from), to: redactUrl(to) },
  };
}

/**
 * A click crumb naming the element, derived at record time.
 *
 * The label is the element's accessible-ish name — its text, `aria-label` or
 * `title`, truncated — rather than a CSS selector path. A selector is what
 * tells you which node was clicked; a label is what tells you which *button*,
 * and the second one is the question anyone reading a crumb trail is asking.
 * Neither the node nor the event is retained; see the module comment.
 */
export function clickBreadcrumb(target: Element): Omit<Breadcrumb, "timestamp"> {
  const tag = target.tagName.toLowerCase();
  const label =
    target.getAttribute("aria-label") ?? target.getAttribute("title") ?? target.textContent.trim();
  const trimmed = label.length > 60 ? `${label.slice(0, 60)}…` : label;
  return {
    category: "ui.click",
    level: "info",
    message: trimmed === "" ? tag : `${tag}: ${trimmed}`,
  };
}
