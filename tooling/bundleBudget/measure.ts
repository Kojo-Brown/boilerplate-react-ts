import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/**
 * Reading sizes off disk.
 *
 * Compressed, always. Every CDN and every dev server in front of this app
 * negotiates `content-encoding`, so the raw byte count is a number no user
 * pays. It also mis-ranks changes: minified JS compresses at roughly 3:1 and a
 * base64 data URI at close to 1:1, so a raw-size budget prices 30kB of new
 * component code the same as 30kB of inlined image and is wrong about both.
 *
 * The absolute number is still a proxy — a CDN picks its own compression level
 * and may serve brotli where this measures gzip. That is fine for a gate, whose
 * question is "did this pull request make it bigger", not "how many bytes will
 * Cloudflare send". What matters is that the two sides of that comparison are
 * measured identically, which is why the level is pinned here rather than left
 * to the default.
 */

export type Compression = "gzip" | "brotli" | "none";

export const COMPRESSIONS: readonly Compression[] = ["gzip", "brotli", "none"];

export function isCompression(value: unknown): value is Compression {
  return typeof value === "string" && (COMPRESSIONS as readonly string[]).includes(value);
}

/**
 * Size of `contents` under `compression`.
 *
 * Both levels are pinned at maximum. Not because a CDN necessarily uses them,
 * but because the default gzip level (6) is a moving target across zlib
 * versions in a way `Z_BEST_COMPRESSION` is not, and a budget that drifts with
 * the toolchain fails for reasons the diff cannot explain. Expect a handful of
 * bytes of movement across a Node major upgrade regardless; the headroom in
 * `bundle-budget.json` absorbs it.
 */
export function compressedSize(contents: Buffer, compression: Compression): number {
  switch (compression) {
    case "gzip":
      return gzipSync(contents, { level: constants.Z_BEST_COMPRESSION }).byteLength;
    case "brotli":
      return brotliCompressSync(contents, {
        params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
      }).byteLength;
    case "none":
      return contents.byteLength;
  }
}

/** Every file under `root`, as paths relative to it, sorted. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

/**
 * Files in `dist/` that the manifest does not account for.
 *
 * This exists because the manifest is not complete, and finding that out from
 * a production incident is worse than finding it out here. Vite builds workers
 * in a *separate* Rollup pass whose output never reaches `.vite/manifest.json`,
 * so `csvParser.worker-*.js` — a real 7.4kB asset a real user downloads — is
 * invisible to the graph walk. Anything dropped into `public/` is copied
 * verbatim and is likewise absent, including `mockServiceWorker.js`, which
 * ships to production today at 9.7kB.
 *
 * Two exclusions, both because the browser never asks for them: sourcemaps,
 * and Vite's own metadata directory.
 */
export function unattributedFiles(files: readonly string[], attributed: ReadonlySet<string>) {
  return files.filter((f) => !attributed.has(f) && !f.endsWith(".map") && !f.startsWith(".vite/"));
}

/** Compressed size of one file below `root`. */
export function fileSize(root: string, file: string, compression: Compression): number {
  return compressedSize(readFileSync(path.join(root, file)), compression);
}

/** Compressed size of every listed file, keyed by path. Missing files throw. */
export function measureFiles(
  root: string,
  files: readonly string[],
  compression: Compression,
): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const file of files) {
    if (sizes.has(file)) continue;
    sizes.set(file, fileSize(root, file, compression));
  }
  return sizes;
}

/** True when `root` exists and is a directory. */
export function isDirectory(root: string): boolean {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
}
