import { useState, type SyntheticEvent } from "react";
import { Text } from "@/shared/ui/Text";
import { Button } from "@/shared/ui/Button";
import { OptimizedImage } from "@/shared/ui/OptimizedImage";
import { cn } from "@/shared/lib/cn";
import { useLayoutShift } from "@/shared/hooks/useLayoutShift";
import { rateCls } from "@/shared/lib/layoutShift";
import {
  DEMO_HERO,
  DEMO_IMAGE_WIDTHS,
  DEMO_STABILITY,
  DEMO_TILES,
  demoImageTransform,
} from "@/shared/lib/demoImages";

/**
 * The hero's layout width, as a media-condition list.
 *
 * It has to describe the *layout*, not the image: the page caps its content at
 * 72rem and the hero fills it, so above that breakpoint the hero is 72rem wide
 * however wide the window gets. Writing `100vw` here — the value the browser
 * assumes when `sizes` is absent — asks a 2560px monitor for the 2560px
 * candidate to fill 1152 CSS pixels.
 */
const HERO_SIZES = "(min-width: 72rem) 72rem, 100vw";

/** Three-up above 60rem, one-up below. Mirrors the grid classes exactly. */
const TILE_SIZES = "(min-width: 60rem) 22rem, 100vw";

interface Selection {
  readonly currentSrc: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5">
      <Text as="h2" size="lg" weight="semibold">
        {title}
      </Text>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  testId,
  tone,
}: {
  label: string;
  value: string;
  testId: string;
  tone?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text size="xs" className="text-[var(--color-muted-fg)] uppercase">
        {label}
      </Text>
      <Text data-testid={testId} size="lg" weight="semibold" className={cn("font-mono", tone)}>
        {value}
      </Text>
    </div>
  );
}

/**
 * Reference demo for the image pipeline.
 *
 * Three claims, each visible on the page rather than described by it:
 *
 * - **Format negotiation.** The readout under the hero is `img.currentSrc`,
 *   the URL the browser actually chose out of the `<picture>`. In Chromium it
 *   ends `.avif`; in a browser without AVIF it ends `.webp` or `.jpeg`, from
 *   identical markup and with nothing conditional in the application.
 * - **Priority.** The hero is the only `priority` image here, which means it
 *   is also the only one with a `<link rel="preload">` in `<head>` and the
 *   only one that does not fade in — a fade-in would keep the LCP candidate at
 *   `opacity: 0` and postpone the metric it is supposed to be improving.
 * - **Reserved space.** Two arms load the same image the same way; only one
 *   holds its box open beforehand. The meter is real CLS, and the fixture
 *   answers slowly on purpose so its shift lands outside the 500ms window in
 *   which the browser attributes movement to the click that caused it.
 *
 * See `docs/image-pipeline.md`.
 */
export function ImageLabPage() {
  const [run, setRun] = useState(1);
  const [showUnreserved, setShowUnreserved] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  // Mounting the second arm starts a new measurement as surely as reloading
  // does, so both are part of the run key.
  const shift = useLayoutShift(`${run}:${String(showUnreserved)}`);
  const transform = demoImageTransform(run);
  const unreservedSrc = transform({ src: DEMO_STABILITY.name, width: 1280, format: "jpeg" });

  function captureSelection(event: SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    setSelection({
      currentSrc: img.currentSrc,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
  }

  return (
    <main className="mx-auto flex max-w-[72rem] flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Text as="h1" size="2xl" weight="bold">
          Image pipeline
        </Text>
        <Text className="max-w-2xl text-[var(--color-muted-fg)]">
          One <code className="font-mono">&lt;picture&gt;</code> offering AVIF, WebP and JPEG at
          five widths. Every candidate URL is answered by the same small PNG — format selection is
          decided from the <code className="font-mono">type</code> attribute before a byte is
          requested, so the choice below is the real algorithm on real markup, not a rendering of
          real AVIF.
        </Text>
      </header>

      <OptimizedImage
        priority
        src={DEMO_HERO.name}
        alt={DEMO_HERO.alt}
        width={DEMO_HERO.width}
        height={DEMO_HERO.height}
        sizes={HERO_SIZES}
        widths={DEMO_IMAGE_WIDTHS}
        transform={transform}
        onLoad={captureSelection}
        data-testid="hero-image"
        className="rounded-[var(--radius-lg)] border border-[var(--color-border)]"
      />

      <Panel title="What the browser chose">
        <div className="flex flex-wrap gap-8">
          <Metric
            label="currentSrc"
            testId="hero-current-src"
            value={selection ? new URL(selection.currentSrc, "http://x").pathname : "loading…"}
          />
          <Metric
            label="Decoded size"
            testId="hero-natural-size"
            value={selection ? `${selection.naturalWidth}×${selection.naturalHeight}` : "—"}
          />
        </div>
        <Text size="sm" className="text-[var(--color-muted-fg)]">
          The decoded size is the fixture PNG&apos;s 16×9, not the candidate&apos;s width — the URL
          says which candidate was requested, the bytes are the same for all of them.
        </Text>
      </Panel>

      <Panel title="Layout stability">
        <div className="flex flex-wrap items-end gap-8">
          <Metric
            label="CLS"
            testId="cls-value"
            value={shift.supported ? shift.cls.toFixed(4) : "unsupported"}
            tone={
              shift.supported && rateCls(shift.cls) !== "good"
                ? "text-[var(--color-danger)]"
                : undefined
            }
          />
          <Metric
            label="All shifts"
            testId="shift-total"
            value={shift.supported ? shift.total.toFixed(4) : "—"}
          />
          <Metric
            label="Excluded as user-caused"
            testId="shift-excluded"
            value={shift.supported ? shift.excluded.toFixed(4) : "—"}
          />
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              data-testid="reload-images"
              onClick={() => {
                setRun((current) => current + 1);
              }}
            >
              Reload images
            </Button>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid="toggle-unreserved"
                checked={showUnreserved}
                onChange={(event) => {
                  setShowUnreserved(event.target.checked);
                }}
              />
              <Text as="span" size="sm">
                Add the unreserved arm
              </Text>
            </label>
          </div>
        </div>

        {/*
         * Stacked, not side by side, and that is a correctness constraint
         * rather than a layout preference. In two grid columns the row is as
         * tall as its tallest cell — which is the reserved arm, whose height is
         * known before its image arrives — so the unreserved image would grow
         * into space the row was already holding open and move nothing at all.
         * The arms have to be in the same flow, one above the other, for the
         * one without a box to be able to push anything.
         */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2" data-testid="reserved-arm">
            <Text size="sm" weight="semibold">
              Reserved
            </Text>
            <OptimizedImage
              src={DEMO_STABILITY.name}
              alt={`${DEMO_STABILITY.alt} (reserved box)`}
              width={DEMO_STABILITY.width}
              height={DEMO_STABILITY.height}
              sizes="(min-width: 72rem) 68rem, 100vw"
              widths={DEMO_IMAGE_WIDTHS}
              transform={transform}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)]"
            />
          </div>

          {showUnreserved && (
            <div className="flex flex-col gap-2" data-testid="unreserved-arm">
              <Text size="sm" weight="semibold">
                Unreserved
              </Text>
              {/*
               * A bare `<img>` with no dimensions and no ratio: zero tall
               * until the bytes land, then as tall as its intrinsic ratio
               * makes it. Everything below it moves. This is not a strawman —
               * it is what an `<img>` does by default, and it is what the
               * component's required `width` and `height` exist to make
               * unrepresentable.
               */}
              <img
                src={unreservedSrc}
                alt={`${DEMO_STABILITY.alt} (no reserved box)`}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)]"
              />
            </div>
          )}
        </div>

        <Text data-testid="stability-caption" size="sm" className="text-[var(--color-muted-fg)]">
          This paragraph is what gets pushed down. The fixture waits <strong>1.2 seconds</strong>{" "}
          before answering, which is what keeps the shift outside the 500ms window where the browser
          would credit it to your click and CLS would read zero.
        </Text>
      </Panel>

      <Panel title="Lazy tiles">
        <Text size="sm" className="text-[var(--color-muted-fg)]">
          Below the fold and un-prioritised:{" "}
          <code className="font-mono">loading=&quot;lazy&quot;</code>,{" "}
          <code className="font-mono">decoding=&quot;async&quot;</code>, no preload, and a fade-in
          that costs nothing because none of them is the LCP candidate.
        </Text>
        <div className="grid gap-4 md:grid-cols-3">
          {DEMO_TILES.map((tile) => (
            <OptimizedImage
              key={tile.name}
              src={tile.name}
              alt={tile.alt}
              width={tile.width}
              height={tile.height}
              sizes={TILE_SIZES}
              widths={DEMO_IMAGE_WIDTHS}
              transform={transform}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)]"
            />
          ))}
        </div>
      </Panel>
    </main>
  );
}
