// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_REGISTRY,
  fetchKeys,
  fetchVersionMetadata,
  mapWithConcurrency,
  type FetchLike,
} from "./registry.ts";

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

const status = (code: number) => ({
  ok: false,
  status: code,
  json: () => Promise.reject(new Error("no body")),
});

const noDelay = () => Promise.resolve();

const VERSION_DOC = {
  dist: {
    integrity: "sha512-abc==",
    signatures: [{ keyid: "SHA256:k", sig: "AAAA" }],
    attestations: {
      url: "https://registry.npmjs.org/-/npm/v1/attestations/react@19.2.7",
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
    },
  },
};

describe("fetchVersionMetadata", () => {
  it("reads integrity, signatures and provenance from the version document", async () => {
    const fetchLike: FetchLike = vi.fn(() => Promise.resolve(ok(VERSION_DOC)));
    const metadata = await fetchVersionMetadata("react", "19.2.7", { fetch: fetchLike });
    expect(metadata).toEqual({
      integrity: "sha512-abc==",
      signatures: [{ keyid: "SHA256:k", sig: "AAAA" }],
      provenance: "https://slsa.dev/provenance/v1",
    });
    expect(fetchLike).toHaveBeenCalledWith(`${DEFAULT_REGISTRY}/react/19.2.7`);
  });

  it("reports absent provenance as null rather than as an error", async () => {
    // 57% of this tree publishes no provenance. Absence is the normal case and
    // the ratchet in evaluate.ts is what gives it meaning.
    const fetchLike: FetchLike = () => Promise.resolve(ok({ dist: { integrity: "sha512-a" } }));
    const metadata = await fetchVersionMetadata("old-thing", "1.0.0", { fetch: fetchLike });
    expect(metadata).toEqual({ integrity: "sha512-a", signatures: [], provenance: null });
  });

  it("keeps a scope's slash and encodes the rest of the path", async () => {
    const fetchLike = vi.fn(() => Promise.resolve(ok(VERSION_DOC)));
    await fetchVersionMetadata("@types/react", "19.2.17", { fetch: fetchLike });
    // `%40types/react`, not `%40types%2Freact`: the registry serves the scoped
    // package at a two-segment path, and encoding the separator 404s.
    expect(fetchLike).toHaveBeenCalledWith(`${DEFAULT_REGISTRY}/%40types/react/19.2.17`);
  });

  it("fails when the response carries no dist block", async () => {
    const fetchLike: FetchLike = () => Promise.resolve(ok({ name: "react" }));
    await expect(fetchVersionMetadata("react", "19.2.7", { fetch: fetchLike })).rejects.toThrow(
      /no "dist" block/,
    );
  });

  it("ignores a malformed signature entry without dropping the good ones", async () => {
    const fetchLike: FetchLike = () =>
      Promise.resolve(
        ok({ dist: { integrity: "sha512-a", signatures: [null, 7, { keyid: "k", sig: "s" }] } }),
      );
    const metadata = await fetchVersionMetadata("react", "19.2.7", { fetch: fetchLike });
    expect(metadata.signatures).toEqual([{ keyid: "k", sig: "s" }]);
  });
});

describe("retrying", () => {
  it("retries a 5xx and succeeds on a later attempt", async () => {
    const fetchLike = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(ok(VERSION_DOC));
    const metadata = await fetchVersionMetadata("react", "19.2.7", {
      fetch: fetchLike,
      delay: noDelay,
    });
    expect(metadata.integrity).toBe("sha512-abc==");
    expect(fetchLike).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404, which is an answer rather than an outage", async () => {
    const fetchLike = vi.fn<FetchLike>().mockResolvedValue(status(404));
    await expect(
      fetchVersionMetadata("gone", "1.0.0", { fetch: fetchLike, delay: noDelay }),
    ).rejects.toThrow(/responded 404/);
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured attempts and throws", async () => {
    // The one behaviour that must never be "return nothing and carry on": a
    // registry this run could not read has to fail the gate.
    const fetchLike = vi.fn<FetchLike>().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      fetchVersionMetadata("react", "19.2.7", { fetch: fetchLike, attempts: 3, delay: noDelay }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(fetchLike).toHaveBeenCalledTimes(3);
  });
});

describe("fetchKeys", () => {
  it("parses the registry key document", async () => {
    const fetchLike: FetchLike = () =>
      Promise.resolve(
        ok({ keys: [{ keyid: "k", keytype: "t", scheme: "s", key: "AAA", expires: null }] }),
      );
    await expect(fetchKeys({ fetch: fetchLike })).resolves.toHaveLength(1);
  });

  it("honours a registry override", async () => {
    const fetchLike = vi.fn(() =>
      Promise.resolve(ok({ keys: [{ keyid: "k", keytype: "t", scheme: "s", key: "A" }] })),
    );
    await fetchKeys({ fetch: fetchLike, registry: "https://mirror.test" });
    expect(fetchLike).toHaveBeenCalledWith("https://mirror.test/-/npm/v1/keys");
  });
});

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms / 10));
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never exceeds the limit", async () => {
    // 482 packages through `Promise.all` earns a burst of 429s, and a gate
    // that rate-limits itself is one people re-run until it passes.
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      4,
      async (i) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return i;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("handles an empty list and rejects a nonsensical limit", async () => {
    await expect(mapWithConcurrency([], 4, () => Promise.resolve(1))).resolves.toEqual([]);
    await expect(mapWithConcurrency([1], 0, () => Promise.resolve(1))).rejects.toThrow(
      /at least 1/,
    );
  });

  it("propagates a rejection rather than returning a short list", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, (n) =>
        n === 2 ? Promise.reject(new Error("boom")) : Promise.resolve(n),
      ),
    ).rejects.toThrow("boom");
  });
});
