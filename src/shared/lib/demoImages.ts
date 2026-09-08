import type { ImageTransform } from "@/shared/lib/responsiveImage";

/**
 * The fixture image set behind `/labs/images`.
 *
 * Shared with the mock server rather than declared in the page, for the same
 * reason `sampleCsv` is: the demo and the thing serving it have to agree on a
 * URL shape, and two copies of that agreement is one copy too many.
 *
 * ## The repository ships no AVIF or WebP binaries
 *
 * Every candidate URL is answered by one small PNG. That is not a shortcut
 * around encoding them — it is what makes the demo *honest about what it
 * demonstrates*. Format selection happens entirely from the `type` attribute
 * on each `<source>`, before a byte is requested; the browser never sniffs the
 * response to discover it chose wrong. So the selection this page shows, and
 * the selection `e2e/image-pipeline.spec.ts` asserts on, is the real
 * algorithm running against real markup.
 *
 * What it does *not* demonstrate is an actual AVIF decode or a real byte
 * saving, and no part of this page claims a number for either.
 */

/** Path prefix the mock server and the E2E fixture both answer. */
export const DEMO_MEDIA_PREFIX = "/media";

/**
 * How long the fixture waits before answering.
 *
 * Above 500ms on purpose. A layout shift within 500ms of a user interaction
 * carries `hadRecentInput` and is excluded from CLS — so a demonstration that
 * reloads its images on a button press and answers promptly scores zero no
 * matter how far the page jumps, and looks like a working reserved box. The
 * delay is what puts the shift outside that window, where the metric can see
 * it. See {@link "@/shared/lib/layoutShift"}.
 */
export const DEMO_IMAGE_DELAY_MS = 1_200;

/**
 * A 16×9 PNG, 77 bytes.
 *
 * Its intrinsic ratio matches {@link DEMO_HERO} and {@link DEMO_TILES} so the
 * unreserved arm collapses to the same shape the reserved one holds open —
 * which is what makes the two arms comparable rather than merely different.
 *
 * `e2e/image-pipeline.spec.ts` carries the same bytes; it runs with the mock
 * worker disabled, so it cannot reach this module at runtime.
 */
export const DEMO_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR42mPwz/pKEmIY1TAoNAAABfnx4Wn4QP4AAAAASUVORK5CYII=";

export interface DemoImage {
  readonly name: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export const DEMO_HERO: DemoImage = {
  name: "harbour",
  alt: "Fishing boats moored along a harbour wall at dusk",
  width: 1600,
  height: 900,
};

/**
 * The image both layout-stability arms load.
 *
 * Distinct from {@link DEMO_HERO} so the two are separable in a network log:
 * `e2e/image-pipeline.spec.ts` counts the hero's requests to prove the preload
 * and the element resolve to one, and a shared name would fold the arms into
 * that count.
 */
export const DEMO_STABILITY: DemoImage = {
  name: "quayside",
  alt: "A quayside crane silhouetted against the water",
  width: 1600,
  height: 900,
};

export const DEMO_TILES: readonly DemoImage[] = [
  { name: "estuary", alt: "An estuary at low tide", width: 1280, height: 720 },
  { name: "boatyard", alt: "Hulls propped up in a winter boatyard", width: 1280, height: 720 },
  { name: "lighthouse", alt: "A lighthouse against flat grey cloud", width: 1280, height: 720 },
];

/**
 * A transform whose URLs carry the run number.
 *
 * The demo has to be repeatable, and a repeat means a fresh request — a cached
 * image paints in the same frame it is asked for and shifts nothing, so a
 * second run against warm cache would report a stability the page does not
 * have. Bumping the run changes every candidate URL, which is the only lever
 * that reliably defeats both the HTTP cache and the browser's in-memory image
 * cache.
 */
export function demoImageTransform(run: number): ImageTransform {
  return ({ src, width, format }) => `${DEMO_MEDIA_PREFIX}/${src}-${width}.${format}?run=${run}`;
}

/** The candidate widths the fixture set offers. Smaller than the defaults. */
export const DEMO_IMAGE_WIDTHS: readonly number[] = [320, 640, 960, 1280, 1600];
