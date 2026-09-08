# Image pipeline

`<OptimizedImage>` is one `<picture>` that does three things a bare `<img>`
does not: it offers AVIF and WebP with a JPEG fallback, it says which image the
page is about, and it holds its space open before the bytes arrive.

```tsx
<OptimizedImage
  priority
  src="/media/harbour"
  alt="Fishing boats moored along a harbour wall at dusk"
  width={1600}
  height={900}
  sizes="(min-width: 72rem) 72rem, 100vw"
/>
```

`/labs/images` is the live version. `src/shared/lib/responsiveImage.ts` is the
URL arithmetic, `src/shared/lib/preloadImage.ts` the preload, and
`src/shared/ui/OptimizedImage.tsx` the element.

---

## The required props are the design

`width`, `height` and `sizes` are not optional, and that is most of what this
component is. Each one has a default the platform applies when it is missing,
each default is wrong for a responsive layout, and none of them produces a
warning:

| Omitted            | What the browser does instead         | What you see          |
| ------------------ | ------------------------------------- | --------------------- |
| `width` / `height` | Reserves nothing until the bytes land | The page jumps        |
| `sizes`            | Assumes the image fills the viewport  | Roughly 3× over-fetch |

An image component that _can_ be rendered without them is a component that
will be, on the page nobody profiled. Making them required moves both mistakes
from runtime to `tsc`.

---

## Format negotiation

```html
<picture>
  <source type="image/avif" srcset="…" sizes="…" />
  <source type="image/webp" srcset="…" sizes="…" />
  <img src="…" srcset="…" sizes="…" width height alt />
</picture>
```

Selection walks the children in document order and stops at the first `type`
the engine can decode. It never compares file sizes and it never revisits, so:

- **Order is preference.** AVIF, then WebP, then the `<img>`. A fallback listed
  early makes every entry after it unreachable markup that reviews perfectly.
- **`type` is the whole negotiation.** The decision is made before a byte is
  requested and the response is never sniffed to discover it was wrong. That is
  why a mislabelled `<source>` is a hard failure — and why the fixture behind
  `/labs/images` can answer every candidate URL with one PNG and still exercise
  the real algorithm.
- **A duplicated format is dead markup.** Only the first `<source>` of a type
  is consulted, so `buildResponsiveImage` refuses one.

### `sizes` goes on every candidate list

Each `<source>` resolves its own `srcset` against its own `sizes`, and an
omitted `sizes` means `100vw`. Setting it only on the `<img>` leaves it missing
from the element that actually gets selected — the responsive behaviour silently
degrades to "always ask for the biggest one", on exactly the browsers whose
formats you went to the trouble of offering.

### Commas

`srcset` is comma-separated, so a candidate URL containing a comma parses into
two malformed candidates. Image CDNs reach for commas constantly
(`?tx=w_640,c_fill`). Nothing reports the corruption: the attribute is present,
the image still loads from `src`, and the responsiveness is just gone.
`buildSrcSet` throws rather than emit it — percent-encode in the transform if
your CDN needs the character.

### Widths

`DEFAULT_IMAGE_WIDTHS` steps by roughly 1.4× rather than by a constant.
Selection takes the smallest candidate at least as wide as it needs, so the
waste between neighbours is a _ratio_; evenly-spaced widths over-serve the
smallest screens, which is where it costs most.

---

## Priority

`priority` is four attributes that only work together:

| Attribute              | Without it                                            |
| ---------------------- | ----------------------------------------------------- |
| `loading="eager"`      | An in-viewport image is deferred behind layout        |
| `fetchpriority="high"` | It queues behind whatever else the parser found first |
| `<link rel="preload">` | It is not discovered until React commits the `<img>`  |
| `decoding="sync"`      | The decode may land in a frame after the one it is in |

Setting three of the four is indistinguishable from setting none: a lazy image
is still deferred however high its fetch priority.

**Use it on at most one image per view.** The hint is a ranking. Marking
everything high ranks nothing.

### The fade-in is part of it

`priority` also switches off the opacity transition, and this is the least
obvious rule here. An element at `opacity: 0` has not painted. A fade-in
therefore does not make the LCP image arrive smoothly — it postpones the image
being an LCP candidate at all until the transition begins, and then measures the
transition instead of the network. A decorative image can afford that; the one
the page is about cannot.

### Why preload at all, in a client-rendered app

There is no server-sent HTML for the preload scanner to read. The LCP image is
discovered when React commits the `<img>` — after the entry chunk has been
fetched, parsed and executed. `preloadImage` can be called from a route module
or a parent that renders while its children are still suspended, which moves
discovery earlier by however long the work in between takes.

Three things make one preload correct for a multi-format image:

1. **It carries `type`.** A browser that cannot decode AVIF drops the hint —
   and that is precisely the browser that would not have selected the AVIF
   `<source>` either. The hint disappears exactly where it would be wrong.
2. **Only the first format is preloaded.** One per format would double-download
   in every browser that supports two of them.
3. **`imageSrcSet` and `imageSizes` come from the same builder the element
   uses.** Preload candidate selection runs the element's algorithm; identical
   inputs are the only reason the two resolve to one request.

A mismatched preload is not a wasted hint, it is a second download.

> **React discards the `href`.** `preload(href, …)` requires one, but for
> `as: "image"` with an `imageSrcSet` React sets `href: undefined` on the link
> it creates — the candidate list is the address. "At least the fallback gets
> preloaded" is not something this API can express. React also keys its dedupe
> on `imagesrcset` + `imagesizes`, which is what makes a StrictMode double
> render produce one link rather than two.

---

## The reserved box

`width` and `height` on an `<img>` do give the browser an intrinsic ratio to
reserve space with — but only while CSS leaves one axis alone. A responsive
image is `width: 100%` with `height: auto`, and the moment a stylesheet sets
both (`h-full w-full`, as the fitted `<img>` here does) the UA's ratio is
overridden and the attributes reserve nothing.

So the box is the **wrapper's** `aspect-ratio`, derived from `width` and
`height`, or from `aspectRatio` when the rendered crop is not the intrinsic one.
The attributes stay on the `<img>` regardless: they are what an unstyled render
falls back to.

The wrapper is `width: 100%` with `max-width: {width}px`, never a fixed
`width`. A fixed pixel width refuses to shrink below the intrinsic size —
overflowing every narrower viewport — and flattens the layout width `sizes`
describes to a constant, which is the input the entire candidate list is chosen
by.

### Measuring it

`useLayoutShift` reports live CLS. Two things about the metric shape the demo:

- **Shifts within 500ms of an interaction do not count.** The browser marks
  them `hadRecentInput` and CLS ignores them, because the user asked for that
  movement. A demonstration that reflows _on a button click_ therefore scores
  zero however far the page jumps — which looks exactly like a working reserved
  box. The fixture behind `/labs/images` waits 1.2 seconds before answering so
  its shift lands outside that window.
- **CLS is the worst session window, not the total.** Shifts group into windows
  that end after a 1s gap or 5s elapsed, and the score is the largest window's
  sum. A plain total would score a long-lived page worse than a short one for
  the same experience.

`useLayoutShift` reports the excluded portion alongside the score, so a zero
stays legible: "nothing moved" and "everything moved right after you clicked"
are very different pages.

`layout-shift` is Chromium-only, and asking a `PerformanceObserver` for an
unknown entry type **throws** rather than staying quiet — hence the capability
check before construction, and the honest `unsupported` readout in Firefox and
WebKit rather than a `0.0000` nobody measured.

---

## What this repository does not ship

**No AVIF or WebP binaries.** Every candidate URL under `/media/` is answered by
one 77-byte PNG, from MSW in development and from a `page.route()` fixture in
the E2E. Because format selection is decided from the `type` attribute before
any request, the selection shown on the lab page and asserted in
`e2e/image-pipeline.spec.ts` is the real algorithm on real markup. What is _not_
demonstrated is an actual AVIF decode or a real byte saving, and nothing here
quotes a number for either.

**No encoder.** `ImageTransform` is a port: it turns a (src, width, format)
triple into a URL and knows nothing about who serves it. Point it at imgix,
Cloudinary, a Next-style image route, or a build step that emits hashed
derivatives. `queryImageTransform` is the default because it is the spelling
that survives being wrong — an origin that ignores the query still returns the
original image, so a misconfigured deployment degrades to "unoptimised" rather
than to 404s across every candidate.

**No LQIP generation.** `blurDataURL` is accepted and painted; producing one is
a build-time concern this repository has no build step for.

**No `srcset` density descriptors.** `w` descriptors plus `sizes` cover the
responsive case; `1x`/`2x` is the right tool only for an image with one fixed
layout size, and mixing the two forms in one list is invalid.
