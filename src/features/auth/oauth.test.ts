import { describe, it, expect, beforeEach } from "vitest";
import { buildGoogleAuthUrl, validateOAuthCallback, OAUTH_STORAGE_KEYS } from "./oauth";

describe("buildGoogleAuthUrl", () => {
  const base = {
    clientId: "my-client-id",
    redirectUri: "http://localhost:3000/auth/callback",
    codeChallenge: "challenge-abc123",
    state: "state-xyz",
  };

  it("targets Google's authorization endpoint", () => {
    expect(buildGoogleAuthUrl(base)).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
  });

  it("includes all required PKCE parameters", () => {
    const url = buildGoogleAuthUrl(base);
    expect(url).toContain("code_challenge=challenge-abc123");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain("response_type=code");
  });

  it("includes the OpenID Connect scopes", () => {
    const url = buildGoogleAuthUrl(base);
    expect(url).toContain("openid");
    expect(url).toContain("email");
    expect(url).toContain("profile");
  });

  it("encodes the redirect_uri", () => {
    const url = buildGoogleAuthUrl(base);
    expect(url).toContain(encodeURIComponent(base.redirectUri));
  });
});

describe("validateOAuthCallback", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("throws when stored state is absent", () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "verifier");
    expect(() => validateOAuthCallback({ code: "c", state: "s" })).toThrow("state mismatch");
  });

  it("throws on state mismatch", () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "expected");
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "verifier");
    expect(() => validateOAuthCallback({ code: "c", state: "wrong" })).toThrow("state mismatch");
  });

  it("throws when the code verifier is missing", () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "state");
    expect(() => validateOAuthCallback({ code: "c", state: "state" })).toThrow(
      "code verifier missing",
    );
  });

  it("returns the code and verifier on success", () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "state");
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "my-verifier");
    const result = validateOAuthCallback({ code: "auth-code", state: "state" });
    expect(result.code).toBe("auth-code");
    expect(result.codeVerifier).toBe("my-verifier");
    expect(result.redirectUri).toBeTruthy();
  });

  it("clears sessionStorage after successful validation", () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "state");
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "verifier");
    validateOAuthCallback({ code: "c", state: "state" });
    expect(sessionStorage.getItem(OAUTH_STORAGE_KEYS.STATE)).toBeNull();
    expect(sessionStorage.getItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER)).toBeNull();
  });

  it("clears sessionStorage even when validation fails", () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "expected");
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "verifier");
    expect(() => validateOAuthCallback({ code: "c", state: "wrong" })).toThrow();
    expect(sessionStorage.getItem(OAUTH_STORAGE_KEYS.STATE)).toBeNull();
    expect(sessionStorage.getItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER)).toBeNull();
  });
});
