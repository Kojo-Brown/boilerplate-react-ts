/**
 * The half of the image pipeline jsdom cannot supply.
 *
 * `src/shared/lib/responsiveImage.test.ts` and
 * `src/shared/ui/OptimizedImage.test.tsx` cover the markup — which `<source>`
 * elements exist, in what order, with which attributes. None of that is the
 * interesting question, because the interesting question is what the browser
 * *does* with it, and jsdom does none of it: it has no `<picture>` selection,
 * no `srcset` candidate algorithm, no `loading="lazy"` deferral, no preload,
 * and no `layout-shift`. Everything asserted here needs a real engine.
 *
 * ## The fixture serves one PNG for every candidate
 *
 * The repository ships no AVIF or WebP binaries. It does not need to: format
 * selection is decided from the `type` attribute on each `<source>` *before a
 * byte is requested*, and the response is never sniffed to discover the choice
 * was wrong. So `currentSrc` ending `.avif` is the real algorithm reaching a
 * real conclusion about real markup, and the bytes behind it are irrelevant to
 * that conclusion. What these tests do not show is an AVIF decode or a byte
 * saving, and none of them claims one.
 *
 * The PNG mirrors `DEMO_IMAGE_PNG_BASE64` in `src/shared/lib/demoImages.ts`.
 * It cannot be imported: the E2E server runs with the mock worker disabled so
 * `page.route()` owns the network, and `e2e/` keeps its own copies of the
 * constants it shares with `src/` for the same reason `fixtures.ts` does.
 */

import { test, expect, type Page } from "@playwright/test";

/** A 16×9 PNG. Mirrors `DEMO_IMAGE_PNG_BASE64`. */
const DEMO_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR42mPwz/pKEmIY1TAoNAAABfnx4Wn4QP4AAAAASUVORK5CYII=";

/** Mirrors `DEMO_IMAGE_DELAY_MS`. Long enough to clear the 500ms input window. */
const FIXTURE_DELAY_MS = 1_200;

const LAB_PATH = "/labs/images";

/**
 * Answers every candidate URL with the same image.
 *
 * The delay is load-bearing rather than realistic: a layout shift within 500ms
 * of a click carries `hadRecentInput` and is excluded from CLS, so a fixture
 * that answered promptly would make the unreserved arm score zero and the
 * reserved arm look no better than it.
 */
async function serveMedia(page: Page, requested: string[]): Promise<void> {
  await page.route("**/media/**", async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await new Promise((resolve) => setTimeout(resolve, FIXTURE_DELAY_MS));
    await route.fulfill({
      status: 200,
      body: Buffer.from(DEMO_IMAGE_PNG_BASE64, "base64"),
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  });
}

async function clsValue(page: Page): Promise<number> {
  const text = await page.getByTestId("cls-value").innerText();
  return Number.parseFloat(text);
}

test.describe("image pipeline", () => {
  test("picks the format from `type` and the width from `sizes`", async ({ page, browserName }) => {
    const requested: string[] = [];
    await serveMedia(page, requested);

    // 1600 wide on purpose, because it is the width at which the two possible
    // answers differ. The hero's `sizes` says it is 72rem (1152px) here, so the
    // smallest candidate at least that wide is 1280. Had `sizes` been omitted —
    // the mistake this component's required prop exists to prevent — the
    // browser would assume `100vw` and buy the 1600 candidate for the same box.
    await page.setViewportSize({ width: 1600, height: 800 });
    await page.goto(LAB_PATH);

    const hero = page.getByTestId("hero-image");
    await expect(hero).toHaveJSProperty("complete", true);

    const currentSrc = await hero.evaluate((img: HTMLImageElement) => img.currentSrc);
    if (browserName === "chromium") {
      // Chromium decodes AVIF, so the first `<source>` matches and selection
      // stops there — the WebP and JPEG lists are never consulted.
      expect(currentSrc).toMatch(/\/media\/harbour-1280\.avif\?run=1$/);
    } else {
      // Elsewhere the format half is whatever the engine supports; the width
      // half is the same arithmetic in every engine.
      expect(currentSrc).toMatch(/\/media\/harbour-1280\.(avif|webp|jpeg)\?run=1$/);
    }

    // A decoded image rather than a broken one that happens to carry the right
    // attributes. Not asserted as 16×9, which is what the fixture is: under a
    // `w` descriptor the selected candidate's width becomes an intrinsic
    // *density* (1280 ÷ 1152 here), and `naturalWidth` is the decoded size
    // divided by it. The number is a fact about the layout, not about the file.
    expect(await hero.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test("fetches the hero exactly once despite preloading it", async ({ page }) => {
    // The preload and the element have to resolve to one URL. If they disagree
    // — a preload without `imagesizes`, or one pointing at the fallback — the
    // hint stops being a hint and becomes a second download, which no test of
    // the markup can see.
    const requested: string[] = [];
    await serveMedia(page, requested);
    await page.goto(LAB_PATH);
    await expect(page.getByTestId("hero-image")).toHaveJSProperty("complete", true);

    const heroRequests = requested.filter((path) => path.startsWith("/media/harbour-"));
    expect(heroRequests).toHaveLength(1);
  });

  test("hoists a typed preload for the hero and nothing else", async ({ page }) => {
    const requested: string[] = [];
    await serveMedia(page, requested);
    await page.goto(LAB_PATH);
    await expect(page.getByTestId("hero-image")).toHaveJSProperty("complete", true);

    const links = await page.locator('head link[rel="preload"][as="image"]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        type: node.getAttribute("type"),
        imagesrcset: node.getAttribute("imagesrcset"),
        imagesizes: node.getAttribute("imagesizes"),
        fetchpriority: node.getAttribute("fetchpriority"),
        href: node.getAttribute("href"),
      })),
    );

    // One image on the page is `priority`, so there is one preload — and it
    // announces AVIF, so a browser without AVIF drops it rather than fetching
    // a candidate the `<picture>` will not select.
    expect(links).toHaveLength(1);
    expect(links[0]?.type).toBe("image/avif");
    expect(links[0]?.fetchpriority).toBe("high");
    expect(links[0]?.imagesizes).toBe("(min-width: 72rem) 72rem, 100vw");
    expect(links[0]?.imagesrcset).toContain("/media/harbour-");
    // React drops `href` once `imageSrcSet` is present: the candidate list is
    // the address.
    expect(links[0]?.href).toBeNull();
  });

  test("asks for the priority image before any lazy one", async ({ page }) => {
    /*
     * Deliberately *not* "the tiles are not requested until scrolled to". They
     * often are: `loading="lazy"` is a distance threshold rather than a
     * viewport test, and Chromium's is around 1250px on a fast connection, so
     * a tile a screen and a half down is fetched immediately. The first
     * version of this test asserted zero requests, passed nothing, and would
     * have failed again the moment the page grew a section.
     *
     * What is deterministic is the order. The hero is eager, preloaded and
     * high-priority; every other image is lazy and unprioritised. So the hero's
     * request is issued first, whatever the threshold decides about the rest.
     */
    const requested: string[] = [];
    await serveMedia(page, requested);
    await page.goto(LAB_PATH);
    await expect(page.getByTestId("hero-image")).toHaveJSProperty("complete", true);

    expect(requested[0]).toMatch(/^\/media\/harbour-/);

    const tile = page.getByAltText("An estuary at low tide");
    await expect(tile).toHaveAttribute("loading", "lazy");
    await tile.scrollIntoViewIfNeeded();
    await expect(tile).toHaveJSProperty("complete", true);
    expect(requested.filter((path) => path.startsWith("/media/estuary-"))).toHaveLength(1);
  });

  test("assigns the priority hint to exactly one image", async ({ page }) => {
    const requested: string[] = [];
    await serveMedia(page, requested);
    await page.goto(LAB_PATH);

    const high = page.locator('img[fetchpriority="high"]');
    await expect(high).toHaveCount(1);
    await expect(high).toHaveAttribute("loading", "eager");
    await expect(page.getByAltText("An estuary at low tide")).toHaveAttribute("loading", "lazy");
  });

  test.describe("layout stability", () => {
    // `layout-shift` is a Chromium-only entry type, and the page says so rather
    // than reporting a zero it did not measure.
    test.skip(
      ({ browserName }) => browserName !== "chromium",
      "layout-shift is only implemented in Chromium.",
    );

    /*
     * The scroll has to be the LAST thing before the wait, and both arms have
     * to do it identically.
     *
     * A layout shift is only recorded for movement the viewport can see, and
     * Playwright's actions auto-scroll to whatever they are about to touch — so
     * clicking a control at the top of the panel scrolls the region that is
     * going to move off the bottom of the screen, and the browser records
     * nothing at all. Not a small score: no entries. The first version of these
     * two tests interacted after scrolling, and the reserved arm "passed" for
     * that reason rather than because its box held. Scrolling last is what
     * makes the zero below evidence — the sibling test proves the same region,
     * observed the same way, does move when nothing reserves it.
     */
    test("a reserved box holds through a slow load", async ({ page }) => {
      const requested: string[] = [];
      await serveMedia(page, requested);
      await page.goto(LAB_PATH);
      await expect(page.getByTestId("hero-image")).toHaveJSProperty("complete", true);

      // Resets the meter and asks for every image again under a new run number,
      // so this measures a fresh load rather than the cache.
      await page.getByTestId("reload-images").click();
      await page.getByTestId("stability-caption").scrollIntoViewIfNeeded();

      // Longer than the fixture delay, so the images have landed and anything
      // they were going to move has moved.
      await page.waitForTimeout(FIXTURE_DELAY_MS * 3);
      await expect(page.getByTestId("reserved-arm").getByRole("img")).toHaveJSProperty(
        "complete",
        true,
      );
      expect(await clsValue(page)).toBe(0);
    });

    test("an unreserved image moves the page after the input window has closed", async ({
      page,
    }) => {
      const requested: string[] = [];
      await serveMedia(page, requested);
      await page.goto(LAB_PATH);
      await expect(page.getByTestId("hero-image")).toHaveJSProperty("complete", true);

      // Mounting the arm restarts the meter, so the toggle is both the setup
      // and the trigger.
      await page.getByTestId("toggle-unreserved").check();
      await page.getByTestId("stability-caption").scrollIntoViewIfNeeded();

      await page.waitForTimeout(FIXTURE_DELAY_MS * 3);
      await expect(page.getByTestId("unreserved-arm").getByRole("img")).toHaveJSProperty(
        "complete",
        true,
      );

      // Not merely non-zero: 0.1 is the boundary between a "good" CLS and one
      // that needs improvement, and a single unreserved image clears it.
      expect(await clsValue(page)).toBeGreaterThan(0.1);
      // And it is scored, not excluded — which is the whole reason the fixture
      // waits 1.2 seconds before answering the click that caused it.
      expect(Number.parseFloat(await page.getByTestId("shift-excluded").innerText())).toBe(0);
    });
  });
});
