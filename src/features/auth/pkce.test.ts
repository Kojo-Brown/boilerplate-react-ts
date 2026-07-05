import { describe, it, expect } from "vitest";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe("generateCodeVerifier", () => {
  it("returns a non-empty base64url string", () => {
    const v = generateCodeVerifier();
    expect(v).toBeTruthy();
    expect(v).toMatch(BASE64URL_RE);
  });

  it("generates a new value on each call", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("produces a verifier of at least 43 characters (RFC 7636)", () => {
    expect(generateCodeVerifier().length).toBeGreaterThanOrEqual(43);
  });
});

describe("generateCodeChallenge", () => {
  it("returns a non-empty base64url string", async () => {
    const challenge = await generateCodeChallenge("test-verifier");
    expect(challenge).toBeTruthy();
    expect(challenge).toMatch(BASE64URL_RE);
  });

  it("is deterministic for the same verifier", async () => {
    const v = "deterministic-verifier-42";
    expect(await generateCodeChallenge(v)).toBe(await generateCodeChallenge(v));
  });

  it("produces different challenges for different verifiers", async () => {
    const c1 = await generateCodeChallenge("verifier-a");
    const c2 = await generateCodeChallenge("verifier-b");
    expect(c1).not.toBe(c2);
  });
});

describe("generateState", () => {
  it("returns a non-empty base64url string", () => {
    expect(generateState()).toBeTruthy();
    expect(generateState()).toMatch(BASE64URL_RE);
  });

  it("generates a new value on each call", () => {
    expect(generateState()).not.toBe(generateState());
  });
});
