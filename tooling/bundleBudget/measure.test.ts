// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compressedSize,
  fileSize,
  isCompression,
  isDirectory,
  listFiles,
  measureFiles,
  unattributedFiles,
} from "./measure.ts";

describe("compressedSize", () => {
  const repetitive = Buffer.from("export const a = 1;\n".repeat(500));

  it("is smaller than the raw bytes for compressible input", () => {
    expect(compressedSize(repetitive, "gzip")).toBeLessThan(repetitive.byteLength);
    expect(compressedSize(repetitive, "brotli")).toBeLessThan(repetitive.byteLength);
  });

  it("returns the raw byte length for `none`", () => {
    expect(compressedSize(repetitive, "none")).toBe(repetitive.byteLength);
  });

  it("is deterministic, which is the only property a gate needs", () => {
    // The absolute number is a proxy for what a CDN sends; the comparison
    // between two builds is not, and that is what this pins.
    expect(compressedSize(repetitive, "gzip")).toBe(compressedSize(repetitive, "gzip"));
  });

  it("ranks a change the way the network does, not the way the disk does", () => {
    // 20kB of repeated JS and 20kB of random bytes cost the same on disk and
    // nothing like the same on the wire. A raw-byte budget calls them equal.
    const random = Buffer.alloc(repetitive.byteLength);
    for (let i = 0; i < random.byteLength; i += 1) random[i] = (i * 2654435761) % 256;
    expect(compressedSize(repetitive, "gzip")).toBeLessThan(compressedSize(random, "gzip"));
    expect(compressedSize(repetitive, "none")).toBe(compressedSize(random, "none"));
  });
});

describe("isCompression", () => {
  it("accepts the three supported algorithms and nothing else", () => {
    expect(isCompression("gzip")).toBe(true);
    expect(isCompression("brotli")).toBe(true);
    expect(isCompression("none")).toBe(true);
    expect(isCompression("deflate")).toBe(false);
    expect(isCompression(undefined)).toBe(false);
  });
});

describe("unattributedFiles", () => {
  const attributed = new Set(["assets/index-a.js", "assets/index-a.css"]);

  it("reports files the manifest never mentions", () => {
    // Vite builds workers in a separate Rollup pass that never reaches the
    // manifest, and `public/` is copied verbatim. Both ship. Without this the
    // gate would be blind to ~17kB of this app's real payload.
    expect(
      unattributedFiles(
        ["assets/index-a.js", "assets/csvParser.worker-b.js", "mockServiceWorker.js"],
        attributed,
      ),
    ).toEqual(["assets/csvParser.worker-b.js", "mockServiceWorker.js"]);
  });

  it("ignores sourcemaps and Vite's own metadata", () => {
    // `build.sourcemap` is on, so `dist/` is mostly `.map` files. Counting
    // them would make the budget a measurement of the debug artefacts — and
    // they are four times the size of everything a browser downloads.
    expect(
      unattributedFiles(
        ["assets/index-a.js.map", ".vite/manifest.json", "assets/index-a.js"],
        attributed,
      ),
    ).toEqual([]);
  });
});

describe("filesystem helpers", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
    mkdirSync(path.join(root, "assets"));
    writeFileSync(path.join(root, "assets", "a.js"), "a".repeat(2000));
    writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists nested files as sorted paths relative to the root", () => {
    expect(listFiles(root)).toEqual(["assets/a.js", "index.html"]);
  });

  it("measures each listed file once", () => {
    const sizes = measureFiles(root, ["assets/a.js", "assets/a.js", "index.html"], "gzip");
    expect([...sizes.keys()]).toEqual(["assets/a.js", "index.html"]);
    expect(sizes.get("assets/a.js")).toBe(fileSize(root, "assets/a.js", "gzip"));
  });

  it("throws rather than scoring a missing file as zero", () => {
    expect(() => fileSize(root, "assets/gone.js", "gzip")).toThrow();
  });

  it("recognises a directory and rejects everything else", () => {
    expect(isDirectory(root)).toBe(true);
    expect(isDirectory(path.join(root, "index.html"))).toBe(false);
    expect(isDirectory(path.join(root, "nope"))).toBe(false);
  });
});
